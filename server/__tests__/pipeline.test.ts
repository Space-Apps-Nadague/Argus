/**
 * Wearable pipeline + analytics (specs/05-data-platform.md §4–§5): device tokens, normalization,
 * detectors, and simulator → ingest → rollup → triage → analytics against in-memory PGlite.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cusum, ewma, mergeRuns, robustZ, runs, summarize } from '../../shared/analytics';
import { DEFAULT_CREW_ROSTER } from '../../src/data/telemetryScenarios';
import { createApp } from '../app';
import { type DbHandle, openDb, setDbHandle } from '../db/client';
import { anomalies, baselines, dailyMetrics, devices, triageEvents } from '../db/schema';
import { seedDatabase } from '../db/seed';
import { deviceToken, verifyDeviceToken } from '../ingest/deviceTokens';
import { normalizeReadings } from '../ingest/normalize';
import { ingestReadings } from '../ingest/service';
import { simulate } from '../ingest/simulator';
import { ACTIVE_DEVICE_KINDS, SENSOR_KIT } from '../db/catalog';
import { runAnalytics } from '../jobs/analytics';
import { evaluateTriage, rollupDays } from '../jobs/rollup';

describe('device tokens', () => {
  it('verifies only tokens signed with the secret', () => {
    const t = deviceToken('s3cret', 'dev-1');
    expect(verifyDeviceToken('s3cret', t)).toBe('dev-1');
    expect(verifyDeviceToken('other', t)).toBeNull();
    expect(verifyDeviceToken('s3cret', 'dev-2.' + t.split('.')[1])).toBeNull();
    expect(verifyDeviceToken(undefined, t)).toBeNull();
  });
});

describe('normalization', () => {
  it('flags implausible values and heart-rate jumps, drops unknown metrics', () => {
    const { rows, unknown } = normalizeReadings([
      { metric: 'heart_rate', ts: '2026-11-14T10:00:00Z', value: 60 },
      { metric: 'heart_rate', ts: '2026-11-14T10:01:00Z', value: 100 }, // +67 % in 1 min
      { metric: 'heart_rate', ts: '2026-11-14T10:02:00Z', value: 62 },
      { metric: 'spo2', ts: '2026-11-14T10:00:00Z', value: 140 },
      { metric: 'mystery', ts: '2026-11-14T10:00:00Z', value: 1 },
    ]);
    expect(rows.map((r) => r.quality)).toEqual(['ok', 'out_of_range', 'artifact', 'ok']);
    expect(unknown).toEqual(['mystery']);
  });
});

describe('detectors', () => {
  it('summarizes and computes robust z', () => {
    const s = summarize([1, 2, 3, 4, 100]);
    expect(s.median).toBe(3);
    expect(s.mad).toBe(1);
    expect(robustZ(100, s.median, s.mad)).toBeGreaterThan(3.5);
  });

  it('EWMA smooths and CUSUM flags a sustained small shift', () => {
    const z = [...Array(10).fill(0), ...Array(15).fill(0.9)];
    expect(ewma([0, 1])[1]).toBeCloseTo(0.3);
    const c = cusum(z);
    expect(c.flags.slice(0, 10).every((f) => f === 0)).toBe(true);
    expect(c.flags[c.flags.length - 1]).toBe(1);
  });

  it('finds persistent runs and merges close episodes', () => {
    const flags = [0, 1, 1, 1, 0, 1, 0, 1, 1, 1].map(Boolean);
    expect(runs(flags, (f) => f, 3)).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 9 },
    ]);
    expect(mergeRuns([{ start: 1, end: 3 }, { start: 7, end: 9 }], 5)).toEqual([{ start: 1, end: 9 }]);
  });
});

describe('two-device kit (spec 05 §4)', () => {
  it('only the smartwatch and the dosimeter are worn; every simulated stream comes from the active kit', () => {
    const worn = SENSOR_KIT.filter((k) => k.kind === 'smartwatch' || k.kind === 'dosimeter');
    expect(worn).toHaveLength(2);
    const crew = DEFAULT_CREW_ROSTER[0];
    const start = new Date('2026-11-01T00:00:00Z');
    const batch = simulate({ crew, scenarioId: 'nominal', from: start, to: new Date(start.getTime() + 8 * 86_400_000), templateStart: start });
    for (const kind of batch.keys()) expect(ACTIVE_DEVICE_KINDS).toContain(kind);
    const metrics = new Set([...batch.values()].flat().map((r) => r.metric));
    for (const m of ['systolic_bp', 'diastolic_bp', 'blood_glucose', 'core_temp', 'daily_sleep_hours', 'mood_index', 'dose_rate', 'heart_rate']) expect(metrics.has(m)).toBe(true);
  });
});

describe('simulator → database pipeline', () => {
  let h: DbHandle;
  const app = createApp();
  const solaris = DEFAULT_CREW_ROSTER.find((c) => c.id === 'crew-lindqvist')!;
  const now = new Date();
  const missionStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 29 * 86_400_000);

  beforeAll(async () => {
    process.env.ARGUS_DEVICE_SECRET = 'test-device-secret';
    h = openDb('pglite:memory');
    await h.migrate();
    await seedDatabase(h.db, { missionStart, demoPassword: 'demo-password-123' });
    setDbHandle(h);
    const batch = simulate({ crew: solaris, scenarioId: 'solar_storm', from: new Date(missionStart.getTime() - 10 * 86_400_000), to: now, templateStart: missionStart, seed: 7, secondaryEveryMin: 30 });
    for (const [, readings] of batch) {
      await ingestReadings(h.db, { astronautId: solaris.id, readings, origin: 'simulated', kind: 'simulator_backfill', keepRaw: false, rollup: false });
    }
    await rollupDays(h.db, solaris.id, new Date(missionStart.getTime() - 10 * 86_400_000), now);
    await evaluateTriage(h.db, solaris.id);
    await runAnalytics(h.db, solaris.id);
  }, 120_000);

  afterAll(async () => {
    setDbHandle(null);
    await h.close();
  });

  it('rolls minute data up to daily triage metrics', async () => {
    const rows = await h.db.select().from(dailyMetrics).where(eq(dailyMetrics.astronautId, solaris.id));
    const metrics = new Set(rows.map((r) => r.metricId));
    for (const m of ['resting_hr', 'spo2', 'rad_dose', 'sleep_eff', 'hrv_rmssd', 'onsd', 'systolic_bp', 'blood_glucose', 'core_temp', 'daily_sleep_hours', 'mood_index']) expect(metrics.has(m)).toBe(true);
    const dose = rows.filter((r) => r.metricId === 'rad_dose').sort((a, b) => a.day.localeCompare(b.day));
    expect(dose[dose.length - 1].value).toBeGreaterThan(dose[0].value * 2); // solar storm builds up
  });

  it('writes a red immune triage event for the solar storm', async () => {
    const events = await h.db.select().from(triageEvents).where(eq(triageEvents.astronautId, solaris.id));
    expect(events.find((e) => e.zone === 'immune')?.status).toBe('red');
  });

  it('stores personal baselines and flags radiation drift', async () => {
    const base = await h.db.select().from(baselines).where(eq(baselines.astronautId, solaris.id));
    const pre = base.find((b) => b.kind === 'preflight' && b.metricId === 'resting_hr')!;
    expect(pre.windowEnd.getTime()).toBeLessThan(missionStart.getTime()); // measured on Earth
    expect(Math.abs(pre.mean - solaris.restingHrBaselineBpm)).toBeLessThan(2);
    expect(base.some((b) => b.kind === 'early_flight' && b.metricId === 'resting_hr')).toBe(true);
    expect(base.some((b) => b.kind === 'hour_of_day' && b.metricId === 'heart_rate')).toBe(true);
    const found = await h.db.select().from(anomalies).where(eq(anomalies.astronautId, solaris.id));
    expect(found.some((a) => a.metricId === 'rad_dose' && a.severity === 'drifting')).toBe(true);
  });

  it('serves zones and analytics to the astronaut, not to other crew', async () => {
    const login = async (username: string) => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 200)}` },
        body: JSON.stringify({ username, password: 'demo-password-123' }),
      });
      return /argus_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![0];
    };
    const own = await login('solaris');
    const zonesRes = await app.request('/api/astronauts/crew-lindqvist/zones', { headers: { Cookie: own } });
    expect(zonesRes.status).toBe(200);
    const { zones, hasData } = await zonesRes.json();
    expect(hasData).toBe(true);
    const rad = zones.immune.find((r: { metricId: string }) => r.metricId === 'rad_dose');
    expect(rad.history.length).toBeGreaterThanOrEqual(28);
    expect(rad.history[0].source).toBe('wearable');

    const analytics = await (await app.request('/api/astronauts/crew-lindqvist/analytics', { headers: { Cookie: own } })).json();
    expect(analytics.current.find((c: { metricId: string }) => c.metricId === 'rad_dose').zVsPreflight).toBeGreaterThan(2);

    const other = await login('apex');
    expect((await app.request('/api/astronauts/crew-lindqvist/zones', { headers: { Cookie: other } })).status).toBe(403);
  });

  it('accepts device batches with a valid token only', async () => {
    const [shirt] = await h.db.select().from(devices).where(eq(devices.astronautId, solaris.id)).limit(1);
    const body = JSON.stringify({ readings: [{ metric: 'heart_rate', ts: new Date().toISOString(), value: 70 }] });
    const bad = await app.request('/api/ingest/readings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope.nope' }, body });
    expect(bad.status).toBe(401);
    const ok = await app.request('/api/ingest/readings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken('test-device-secret', shirt.id)}` },
      body,
    });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ inserted: 1, flagged: 0 });
  });
});

describe('Earth pre-flight baseline (spec 05 §5.2)', () => {
  it('baselinePoints prefers Earth days, except for exposure metrics', async () => {
    const { baselinePoints } = await import('../../shared/analytics');
    const series = [-2, -1, 0, 1, 2, 3].map((missionDay) => ({ missionDay, value: missionDay }));
    expect(baselinePoints('resting_hr', series).map((p) => p.missionDay)).toEqual([-2, -1, 0]);
    expect(baselinePoints('rad_dose', series).map((p) => p.missionDay)).toEqual([1, 2, 3]);
    expect(baselinePoints('resting_hr', series.slice(3)).map((p) => p.missionDay)).toEqual([1, 2, 3]);
  });

  it('simulates Earth days with the crew member’s pre-flight values and Earth radiation', () => {
    const crew = DEFAULT_CREW_ROSTER[1];
    const start = new Date('2026-11-01T00:00:00Z');
    const batch = simulate({ crew, scenarioId: 'sans_alert', from: new Date(start.getTime() - 7 * 86_400_000), to: start, templateStart: start });
    const all = [...batch.values()].flat();
    const rest = all.filter((r) => r.metric === 'resting_hr').map((r) => r.value);
    expect(Math.abs(rest.reduce((a, b) => a + b, 0) / rest.length - crew.restingHrBaselineBpm)).toBeLessThan(2);
    const dose = all.filter((r) => r.metric === 'dose_rate').map((r) => r.value);
    expect(Math.max(...dose)).toBeLessThan(1); // µGy/h on Earth, vs ~25+ in flight
    expect(all.some((r) => r.metric === 'cabin_co2' || r.metric === 'ared_load')).toBe(false);
  });
});
