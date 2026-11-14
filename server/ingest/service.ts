/**
 * Ingest pipeline (specs/05-data-platform.md §3.4, §4): bronze (raw_readings) → silver (observations)
 * → gold (daily_metrics, triage_events). Shared by the HTTP API, the simulator backfill and check-ins.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ingestRuns, observations, rawReadings } from '../db/schema';
import { evaluateTriage, rollupDays } from '../jobs/rollup';
import { type IncomingReading, normalizeReadings } from './normalize';

export type IngestOrigin = 'wearable' | 'check_in' | 'clinical' | 'simulated';
export type IngestKind = 'wearable_batch' | 'simulator_backfill' | 'check_in' | 'import';

export interface IngestInput {
  astronautId: string;
  deviceId?: string | null;
  readings: IncomingReading[];
  origin: IngestOrigin;
  kind: IngestKind;
  sourceId?: string | null;
  script?: string;
  /** Store the raw batch in `raw_readings` (bronze). Default true. */
  keepRaw?: boolean;
  /** Recompute daily values and triage afterwards. Default true. */
  rollup?: boolean;
}

export interface IngestResult {
  runId: string;
  inserted: number;
  flagged: number;
  unknownMetrics: string[];
  from: string | null;
  to: string | null;
  triageEvents: number;
}

const CHUNK = 2000;

export async function ingestReadings(db: Db, input: IngestInput): Promise<IngestResult> {
  const [run] = await db
    .insert(ingestRuns)
    .values({ kind: input.kind, sourceId: input.sourceId ?? null, script: input.script ?? null })
    .returning({ id: ingestRuns.id });
  try {
    if (input.keepRaw !== false) {
      await db.insert(rawReadings).values({ deviceId: input.deviceId ?? null, payload: { origin: input.origin, readings: input.readings }, ingestRunId: run.id });
    }
    const { rows, unknown } = normalizeReadings(input.readings);
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(observations)
        .values(
          rows.slice(i, i + CHUNK).map((r) => ({
            astronautId: input.astronautId,
            metricId: r.metricId,
            ts: r.ts,
            value: r.value,
            deviceId: input.deviceId ?? null,
            quality: r.quality,
            origin: input.origin,
            ingestRunId: run.id,
          }))
        )
        .onConflictDoUpdate({
          target: [observations.astronautId, observations.metricId, observations.ts],
          set: {
            value: sql`excluded.value`,
            quality: sql`excluded.quality`,
            origin: sql`excluded.origin`,
            deviceId: sql`excluded.device_id`,
            ingestRunId: sql`excluded.ingest_run_id`,
          },
        });
    }
    const times = rows.map((r) => r.ts.getTime());
    const from = times.length ? new Date(Math.min(...times)) : null;
    const to = times.length ? new Date(Math.max(...times) + 1) : null;
    let triage = 0;
    if (input.rollup !== false && from && to) {
      await rollupDays(db, input.astronautId, from, to);
      triage = await evaluateTriage(db, input.astronautId);
    }
    await db
      .update(ingestRuns)
      .set({
        rowCount: rows.length,
        status: 'succeeded',
        finishedAt: new Date(),
        detail: { origin: input.origin, flagged: rows.filter((r) => r.quality !== 'ok').length, unknownMetrics: unknown },
      })
      .where(eq(ingestRuns.id, run.id));
    return {
      runId: run.id,
      inserted: rows.length,
      flagged: rows.filter((r) => r.quality !== 'ok').length,
      unknownMetrics: unknown,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      triageEvents: triage,
    };
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: 'failed', finishedAt: new Date(), detail: { error: String(err) } })
      .where(eq(ingestRuns.id, run.id));
    throw err;
  }
}
