/**
 * ARGUS — Wearable simulator CLI (specs/05-data-platform.md §4)
 *
 *   npm run simulate -- --backfill 30                 # 30 days of history for every astronaut, written directly to DATABASE_URL
 *   npm run simulate -- --live                        # every 60 s, POST the last minute(s) to the ingest API as each device
 *   npm run simulate -- --live --crew crew-lindqvist --scenario solar_storm   # push a crisis now
 *
 * Options: --preflight-days <n> (Earth days before launch, default 14), --reset (delete earlier simulated data first), --crew <id> (repeatable), --scenario <id>, --seed <n>, --full (1-min secondary streams),
 *          --interval <s> (live), --api <url> (live, default http://127.0.0.1:8787)
 */

import { and, eq, isNull } from 'drizzle-orm';
import { resolveDatabaseUrl } from '../server/db/connectionString';
import type { DeviceKind } from '../server/db/catalog';
import { openDb } from '../server/db/client';
import { getProfile } from '../server/db/profiles';
import { astronauts, devices, missions } from '../server/db/schema';
import { loadEnv } from '../server/env';
import { deviceToken } from '../server/ingest/deviceTokens';
import { backfillSimulated } from '../server/ingest/backfill';
import { simulate } from '../server/ingest/simulator';
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

const url = resolveDatabaseUrl();
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const h = openDb(url);
const db = h.db;


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

async function backfill(days: number) {
  await backfillSimulated(db, {
    days,
    preflightDays: arg('preflight-days') !== undefined ? Number(arg('preflight-days')) : undefined,
    seed,
    crewIds: crewFilter,
    scenarioOverride,
    reset: has('reset'),
    secondaryEveryMin: has('full') ? 1 : 5,
    script: 'scripts/simulate-wearables.ts --backfill',
    log: (m) => console.log(`[simulate] ${m}`),
  });
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
