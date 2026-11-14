/**
 * Health data routes (specs/05-data-platform.md §8): device ingest, zones, series, check-ins, wellbeing.
 */

import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WellbeingCheckIn } from '../../src/types/aiApi';
import { METRIC_IDS } from '../../src/utils/triageEngine';
import { validateCheckInValue } from '../../src/utils/checkIns';
import { canReadAstronaut } from '../auth/access';
import { audit } from '../auth/audit';
import { requireAuth } from '../auth/session';
import type { AppEnv } from '../auth/types';
import { queryRows, sql } from '../db/client';
import { getProfile, missionDayAt } from '../db/profiles';
import { anomalies, baselines, devices, wellbeingCheckIns } from '../db/schema';
import { buildZonesFromDb } from '../db/zones';
import { verifyDeviceToken } from '../ingest/deviceTokens';
import { ingestReadings } from '../ingest/service';
import { ScenarioIdSchema } from '../schemas';
import { parseBody } from './util';

export const dataRoutes = new Hono<AppEnv>();

// ── Device ingest (Bearer device token, no session) ─────────────────────────
const ReadingsSchema = z.object({
  origin: z.enum(['wearable', 'simulated']).default('wearable'),
  readings: z
    .array(z.object({ metric: z.string().max(40), ts: z.string().max(40), value: z.number() }))
    .min(1)
    .max(5000),
});

dataRoutes.post('/ingest/readings', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const deviceId = verifyDeviceToken(process.env.ARGUS_DEVICE_SECRET, token);
  if (!deviceId) return c.json({ error: 'Invalid device token' }, 401);
  const device = (await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1))[0];
  if (!device || device.retiredAt) return c.json({ error: 'Unknown or retired device' }, 401);
  const body = await parseBody(c, ReadingsSchema);
  if (!body.ok) return body.response;
  const result = await ingestReadings(db, {
    astronautId: device.astronautId,
    deviceId: device.id,
    readings: body.data.readings,
    origin: body.data.origin,
    kind: 'wearable_batch',
    sourceId: device.sourceId,
    script: `device:${device.kind}`,
  });
  return c.json(result, 201);
});

// ── Signed-in data access ────────────────────────────────────────────────────
dataRoutes.use('/astronauts/:id/zones', requireAuth());
dataRoutes.use('/astronauts/:id/series', requireAuth());
dataRoutes.use('/astronauts/:id/check-ins', requireAuth());
dataRoutes.use('/astronauts/:id/wellbeing', requireAuth());

dataRoutes.get('/astronauts/:id/zones', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const user = c.get('user');
  const id = c.req.param('id');
  if (!canReadAstronaut(user, id)) return c.json({ error: 'Not allowed' }, 403);
  const crew = await getProfile(db, id, user);
  if (!crew) return c.json({ error: 'Crew member not found' }, 404);
  const scenario = ScenarioIdSchema.safeParse(c.req.query('scenario'));
  const built = await buildZonesFromDb(db, crew, scenario.success ? scenario.data : crew.defaultScenarioId);
  return c.json({ zones: built.zones, hasData: built.hasData, missionDay: missionDayAt(built.missionStart) });
});

const BUCKETS = { minute: '1 minute', hour: '1 hour', day: '1 day' } as const;

dataRoutes.get('/astronauts/:id/series', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const metric = c.req.query('metric') ?? '';
  const bucket = (c.req.query('bucket') ?? 'hour') as keyof typeof BUCKETS;
  if (!/^[a-z0-9_]{2,40}$/.test(metric) || !(bucket in BUCKETS)) return c.json({ error: 'metric and bucket=minute|hour|day required' }, 400);
  const to = c.req.query('to') ? new Date(c.req.query('to')!) : new Date();
  const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(to.getTime() - 2 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return c.json({ error: 'Invalid from/to' }, 400);
  if (bucket === 'minute' && to.getTime() - from.getTime() > 3 * 86_400_000) return c.json({ error: 'Minute data is limited to 3 days per request' }, 400);
  const points = await queryRows<{ ts: string; value: number; min: number; max: number; n: number }>(
    db,
    sql`select date_bin(${BUCKETS[bucket]}::interval, ts, '2000-01-01'::timestamptz) as ts,
          avg(value)::float8 as value, min(value)::float8 as min, max(value)::float8 as max, count(*)::int as n
        from observations
        where astronaut_id = ${id} and metric_id = ${metric} and quality = 'ok'
          and ts >= ${from.toISOString()}::timestamptz and ts < ${to.toISOString()}::timestamptz
        group by 1 order by 1`
  );
  return c.json({ metric, bucket, points: points.map((p) => ({ ...p, ts: new Date(p.ts).toISOString() })) });
});

const CheckInSchema = z.object({
  values: z.record(z.string(), z.number()),
  note: z.string().max(500).optional(),
});

/** Manual readings (spec 01 §6) → observations with origin `check_in` (clinical exams: `clinical`). */
dataRoutes.post('/astronauts/:id/check-ins', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const body = await parseBody(c, CheckInSchema);
  if (!body.ok) return body.response;
  const errors: Record<string, string> = {};
  const readings = [];
  const now = new Date().toISOString();
  for (const [metric, value] of Object.entries(body.data.values)) {
    if (!(METRIC_IDS as string[]).includes(metric)) {
      errors[metric] = 'Unknown metric';
      continue;
    }
    const v = validateCheckInValue(metric as (typeof METRIC_IDS)[number], value);
    if (v.ok === true) readings.push({ metric, ts: now, value: v.value });
    else if (v.ok === false) errors[metric] = v.error;
  }
  if (Object.keys(errors).length || !readings.length) return c.json({ error: 'Invalid check-in', errors }, 400);
  const result = await ingestReadings(db, { astronautId: id, readings, origin: 'check_in', kind: 'check_in', script: 'hud:check-in' });
  await audit(c, { action: 'check_in', targetType: 'astronaut', targetId: id, detail: { metrics: readings.map((r) => r.metric) } });
  return c.json(result, 201);
});

const scale = z.number().int().min(1).max(5);
const WellbeingSchema = z.object({
  mood: scale,
  stress: scale,
  energy: scale,
  sleepQuality: scale,
  cohesion: scale,
  motivation: scale,
  note: z.string().max(500).optional(),
});

dataRoutes.get('/astronauts/:id/wellbeing', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const crew = await getProfile(db, id, c.get('user'));
  const since = new Date(Date.now() - 60 * 86_400_000);
  const rows = await db
    .select()
    .from(wellbeingCheckIns)
    .where(and(eq(wellbeingCheckIns.astronautId, id), gte(wellbeingCheckIns.ts, since), lte(wellbeingCheckIns.ts, new Date())))
    .orderBy(asc(wellbeingCheckIns.ts));
  const days = crew?.missionDaysLogged ?? 1;
  const checkIns: WellbeingCheckIn[] = rows.map((r) => ({
    id: r.id,
    crewId: id,
    missionDay: Math.max(1, days - Math.floor((Date.now() - r.ts.getTime()) / 86_400_000)),
    timestampIso: r.ts.toISOString(),
    mood: r.mood,
    stress: r.stress,
    energy: r.energy,
    sleepQuality: r.sleepQuality,
    cohesion: r.cohesion,
    motivation: r.motivation,
    note: r.note ?? undefined,
  }));
  return c.json({ checkIns });
});

dataRoutes.post('/astronauts/:id/wellbeing', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const body = await parseBody(c, WellbeingSchema);
  if (!body.ok) return body.response;
  const [row] = await db.insert(wellbeingCheckIns).values({ astronautId: id, ...body.data }).returning({ id: wellbeingCheckIns.id });
  return c.json({ id: row.id }, 201);
});


/** Personal baselines and recent anomalies (spec 05 §5). Informational: never changes triage. */
dataRoutes.use('/astronauts/:id/analytics', requireAuth());
dataRoutes.get('/astronauts/:id/analytics', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const base = await db.select().from(baselines).where(eq(baselines.astronautId, id));
  const since = new Date(Date.now() - 30 * 86_400_000);
  const recent = await db
    .select()
    .from(anomalies)
    .where(and(eq(anomalies.astronautId, id), gte(anomalies.tsEnd, since)))
    .orderBy(desc(anomalies.tsEnd));
  const latest = await queryRows<{ metric_id: string; day: string; value: number }>(
    db,
    sql`select distinct on (metric_id) metric_id, day::text as day, value from daily_metrics
        where astronaut_id = ${id} order by metric_id, day desc`
  );
  const current = latest.map((l) => {
    const pre = base.find((b) => b.metricId === l.metric_id && b.kind === 'preflight');
    const roll = base.find((b) => b.metricId === l.metric_id && b.kind === 'rolling_14d');
    return {
      metricId: l.metric_id,
      day: l.day,
      value: l.value,
      preflight: pre ? { mean: pre.mean, sd: pre.sd, n: pre.n } : null,
      normal: roll ? { median: roll.median, p05: roll.p05, p95: roll.p95, mean: roll.mean, n: roll.n } : null,
      zVsPreflight: pre ? Math.round(((l.value - pre.mean) / pre.sd) * 100) / 100 : null,
    };
  });
  return c.json({
    computedAt: base[0]?.computedAt ?? null,
    current,
    circadian: base.filter((b) => b.kind === 'hour_of_day').map((b) => ({ metricId: b.metricId, hour: b.hour, median: b.median, p05: b.p05, p95: b.p95, n: b.n })),
    anomalies: recent.map((a) => ({
      metricId: a.metricId,
      detector: a.detector,
      severity: a.severity,
      score: a.score,
      tsStart: a.tsStart.toISOString(),
      tsEnd: a.tsEnd.toISOString(),
      detail: a.detail,
    })),
  });
});
