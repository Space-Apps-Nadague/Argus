/**
 * Simulated wearable history for the assumed kit (specs/05-data-platform.md §4), written straight to the DB.
 * Shared by `npm run simulate` (scripts/simulate-wearables.ts) and the hosted app's bootstrap/top-up.
 */

import { and, eq, isNull, max, min } from 'drizzle-orm';
import type { ScenarioId } from '../../src/types/argus';
import { type DeviceKind, SENSOR_KIT } from '../db/catalog';
import { sql, type Db } from '../db/client';
import { getProfile } from '../db/profiles';
import { astronauts, devices, missions, observations } from '../db/schema';
import { runAnalytics } from '../jobs/analytics';
import { evaluateTriage, rollupDays } from '../jobs/rollup';
import { ingestReadings } from './service';
import { simulate } from './simulator';

const DAY_MS = 86_400_000;
const DEVICE_SOURCE: Partial<Record<DeviceKind, string>> = Object.fromEntries(SENSOR_KIT.map((k) => [k.kind, k.sourceId]));

export interface BackfillOptions {
  days?: number;
  /** Days of Earth pre-flight data before mission start (default 14; 0 = none). */
  preflightDays?: number;
  seed?: number;
  crewIds?: string[];
  scenarioOverride?: ScenarioId;
  secondaryEveryMin?: number;
  reset?: boolean;
  /** Only fill the gap since each astronaut's latest simulated reading (no-op if none). */
  topUpOnly?: boolean;
  /**
   * Resumable first-start fill: skip astronauts whose simulated history is complete; an astronaut whose history
   * starts later than expected (a fill interrupted by a restart) is cleared and filled again.
   */
  onlyMissing?: boolean;
  script?: string;
  log?: (msg: string) => void;
}

async function crewList(db: Db, filter?: string[]) {
  const rows = await db
    .select({ id: astronauts.id, missionStart: missions.startAt })
    .from(astronauts)
    .leftJoin(missions, eq(missions.id, astronauts.missionId))
    .where(isNull(astronauts.archivedAt));
  return rows.filter((r) => !filter?.length || filter.includes(r.id));
}

async function deviceMap(db: Db, astronautId: string): Promise<Map<DeviceKind, string>> {
  const rows = await db
    .select({ id: devices.id, kind: devices.kind })
    .from(devices)
    .where(and(eq(devices.astronautId, astronautId), isNull(devices.retiredAt)));
  return new Map(rows.map((r) => [r.kind as DeviceKind, r.id]));
}

export async function resetSimulated(db: Db, ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.execute(sql`delete from observations where astronaut_id = ${id} and origin = 'simulated'`);
    for (const t of ['daily_metrics', 'baselines', 'anomalies', 'triage_events']) {
      await db.execute(sql`delete from ${sql.identifier(t)} where astronaut_id = ${id}`);
    }
  }
}

export async function backfillSimulated(db: Db, opts: BackfillOptions = {}): Promise<number> {
  const log = opts.log ?? (() => {});
  const now = new Date();
  const crew = await crewList(db, opts.crewIds);
  if (opts.reset) await resetSimulated(db, crew.map((c) => c.id));
  let grand = 0;
  for (const { id, missionStart } of crew) {
    const profile = await getProfile(db, id, null, { forceFull: true });
    if (!profile) continue;
    const templateStart = missionStart ?? new Date(now.getTime() - 29 * DAY_MS);
    let from = new Date(Math.max(templateStart.getTime(), now.getTime() - (opts.days ?? 30) * DAY_MS));
    // Include the Earth pre-flight period when the window reaches back to launch (spec 05 §5.2).
    const preflightDays = opts.preflightDays ?? 14;
    if (preflightDays > 0 && from.getTime() <= templateStart.getTime()) {
      from = new Date(templateStart.getTime() - preflightDays * DAY_MS);
    }
    if (opts.onlyMissing) {
      const [{ first }] = await db
        .select({ first: min(observations.ts) })
        .from(observations)
        .where(and(eq(observations.astronautId, id), eq(observations.origin, 'simulated')));
      if (first) {
        // A complete fill starts at `from` (heart rate is recorded every minute); allow one hour of slack.
        const complete = new Date(first).getTime() <= from.getTime() + 3_600_000;
        if (complete) continue;
        log(`${profile.callsign}: incomplete history (starts ${new Date(first).toISOString().slice(0, 10)}), refilling`);
        await resetSimulated(db, [id]);
      }
    }
    if (opts.topUpOnly) {
      const [{ last }] = await db
        .select({ last: max(observations.ts) })
        .from(observations)
        .where(and(eq(observations.astronautId, id), eq(observations.origin, 'simulated')));
      if (!last) continue;
      from = new Date(new Date(last).getTime() + 60_000);
      if (now.getTime() - from.getTime() < 5 * 60_000) continue;
    }
    const batch = simulate({
      crew: profile,
      scenarioId: opts.scenarioOverride ?? profile.defaultScenarioId,
      from,
      to: now,
      templateStart,
      seed: opts.seed ?? 42,
      secondaryEveryMin: opts.secondaryEveryMin ?? 5,
    });
    const devs = await deviceMap(db, id);
    let total = 0;
    for (const [kind, readings] of batch) {
      if (!readings.length) continue;
      const r = await ingestReadings(db, {
        astronautId: id,
        deviceId: devs.get(kind) ?? null,
        readings,
        origin: 'simulated',
        kind: 'simulator_backfill',
        sourceId: DEVICE_SOURCE[kind] ?? null,
        script: opts.script ?? 'server/ingest/backfill.ts',
        keepRaw: false, // bronze is skipped for bulk synthetic history; live device batches keep raw
        rollup: false,
      });
      total += r.inserted;
    }
    await rollupDays(db, id, from, now);
    const triage = await evaluateTriage(db, id);
    const analytics = await runAnalytics(db, id);
    log(`${profile.callsign.padEnd(10)} ${total.toLocaleString()} readings, ${triage} triage events, ${analytics.baselines} baselines, ${analytics.anomalies} anomalies`);
    grand += total;
  }
  return grand;
}
