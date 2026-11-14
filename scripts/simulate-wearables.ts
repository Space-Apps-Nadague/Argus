/**
 * ARGUS — Wearable simulator CLI (specs/05-data-platform.md §4)
 *
 *   npm run simulate -- --backfill 30                 # 30 days of history for every astronaut, written directly to DATABASE_URL
 *   npm run simulate -- --live                        # every 60 s, POST the last minute(s) to the ingest API as each device
 *   npm run simulate -- --live --crew crew-lindqvist --scenario solar_storm   # push a crisis now
 *
 * Options: --reset (delete earlier simulated data first), --crew <id> (repeatable), --scenario <id>, --seed <n>, --full (1-min secondary streams),
 *          --interval <s> (live), --api <url> (live, default http://127.0.0.1:8787)
 */

import { and, eq, isNull } from 'drizzle-orm';
import { type DeviceKind, SENSOR_KIT } from '../server/db/catalog';
import { openDb, sql } from '../server/db/client';
import { getProfile } from '../server/db/profiles';
import { astronauts, devices, missions } from '../server/db/schema';
import { loadEnv } from '../server/env';
import { deviceToken } from '../server/ingest/deviceTokens';
import { ingestReadings } from '../server/ingest/service';
import { simulate } from '../server/ingest/simulator';
import { runAnalytics } from '../server/jobs/analytics';
import { evaluateTriage, rollupDays } from '../server/jobs/rollup';
import type { ScenarioId } from '../src/types/argus';

loadEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const crewFilter = process.argv.flatMap((a, i) => (a === '--crew' ? [process.argv[i + 1]] : []));
const scenarioOverride = arg('scenario') as ScenarioId | undefined;
const seed = Number(arg('seed') ?? 42);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const h = openDb(url);
const db = h.db;

const DEVICE_SOURCE: Partial<Record<DeviceKind, string>> = Object.fromEntries(SENSOR_KIT.map((k) => [k.kind, k.sourceId]));

async function crewList() {
  const rows = await db
    .select({ id: astronauts.id, missionStart: missions.startAt })
    .from(astronauts)
    .leftJoin(missions, eq(missions.id, astronauts.missionId))
    .where(isNull(astronauts.archivedAt));
  return rows.filter((r) => !crewFilter.length || crewFilter.includes(r.id));
}

async function deviceMap(astronautId: string): Promise<Map<DeviceKind, string>> {
  const rows = await db
    .select({ id: devices.id, kind: devices.kind })
    .from(devices)
    .where(and(eq(devices.astronautId, astronautId), isNull(devices.retiredAt)));
  return new Map(rows.map((r) => [r.kind as DeviceKind, r.id]));
}

/** --reset: delete simulated observations and everything derived from them for the selected crew. */
async function resetSimulated(ids: string[]) {
  for (const id of ids) {
    await db.execute(sql`delete from observations where astronaut_id = ${id} and origin = 'simulated'`);
    for (const t of ['daily_metrics', 'baselines', 'anomalies', 'triage_events']) {
      await db.execute(sql`delete from ${sql.identifier(t)} where astronaut_id = ${id}`);
    }
  }
  console.log(`[simulate] reset simulated data for ${ids.length} astronaut(s)`);
}

async function backfill(days: number) {
  const now = new Date();
  if (has('reset')) await resetSimulated((await crewList()).map((c) => c.id));
  for (const { id, missionStart } of await crewList()) {
    const crew = await getProfile(db, id, null, { forceFull: true });
    if (!crew) continue;
    const templateStart = missionStart ?? new Date(now.getTime() - 29 * 86_400_000);
    const from = new Date(Math.max(templateStart.getTime(), now.getTime() - days * 86_400_000));
    const batch = simulate({
      crew,
      scenarioId: scenarioOverride ?? crew.defaultScenarioId,
      from,
      to: now,
      templateStart,
      seed,
      secondaryEveryMin: has('full') ? 1 : 5,
    });
    const devs = await deviceMap(id);
    let total = 0;
    for (const [kind, readings] of batch) {
      const r = await ingestReadings(db, {
        astronautId: id,
        deviceId: devs.get(kind) ?? null,
        readings,
        origin: 'simulated',
        kind: 'simulator_backfill',
        sourceId: DEVICE_SOURCE[kind] ?? null,
        script: 'scripts/simulate-wearables.ts --backfill',
        keepRaw: false, // bronze is skipped for bulk synthetic history; live batches keep raw
        rollup: false,
      });
      total += r.inserted;
    }
    await rollupDays(db, id, from, now);
    const triage = await evaluateTriage(db, id);
    const analytics = await runAnalytics(db, id);
    console.log(
      `[simulate] ${crew.callsign.padEnd(10)} ${total.toLocaleString()} readings, ${triage} triage events, ${analytics.baselines} baselines, ${analytics.anomalies} anomalies`
    );
  }
}

async function live() {
  const api = (arg('api') ?? `http://127.0.0.1:${process.env.ARGUS_SERVER_PORT ?? 8787}`).replace(/\/$/, '');
  const secret = process.env.ARGUS_DEVICE_SECRET;
  if (!secret) {
    console.error('ARGUS_DEVICE_SECRET is not set: devices cannot authenticate.');
    process.exit(1);
  }
  const intervalS = Number(arg('interval') ?? 60);
  let last = new Date(Date.now() - intervalS * 1000);
  const tick = async () => {
    const now = new Date();
    for (const { id, missionStart } of await crewList()) {
      const crew = await getProfile(db, id, null, { forceFull: true });
      if (!crew) continue;
      const batch = simulate({
        crew,
        scenarioId: scenarioOverride ?? crew.defaultScenarioId,
        from: last,
        to: now,
        templateStart: missionStart ?? now,
        seed: seed + Math.floor(now.getTime() / 60_000),
        secondaryEveryMin: 1,
        templateDayOverride: scenarioOverride ? 29 : undefined,
      });
      const devs = await deviceMap(id);
      for (const [kind, readings] of batch) {
        const deviceId = devs.get(kind);
        if (!deviceId || !readings.length) continue;
        const res = await fetch(`${api}/api/ingest/readings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken(secret, deviceId)}` },
          body: JSON.stringify({ origin: 'simulated', readings }),
        }).catch((err: Error) => ({ ok: false, status: 0, text: async () => err.message }) as Response);
        if (!res.ok) console.warn(`[simulate] ${crew.callsign} ${kind}: ${res.status} ${await res.text()}`);
      }
      console.log(`[simulate] ${now.toISOString()} ${crew.callsign} sent ${[...batch.values()].reduce((s, r) => s + r.length, 0)} readings`);
    }
    last = now;
  };
  await tick();
  setInterval(() => void tick().catch((e) => console.error('[simulate]', e)), intervalS * 1000);
}

if (has('live')) {
  await live();
} else {
  await backfill(Number(arg('backfill') ?? 30));
  await h.close();
}
