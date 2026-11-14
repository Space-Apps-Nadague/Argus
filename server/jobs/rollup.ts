/**
 * Gold layer: daily values of the 12 triage metrics from observations (specs/05-data-platform.md §5.1),
 * then deterministic triage events on status changes (§3.4).
 */

import { and, desc, eq } from 'drizzle-orm';
import type { BodyZoneId, TriageStatus } from '../../src/types/argus';
import { evaluateAllZones } from '../../src/utils/triageEngine';
import { queryRows, sql, type Db } from '../db/client';
import { getProfile } from '../db/profiles';
import { triageEvents } from '../db/schema';
import { buildZonesFromDb } from '../db/zones';

export const ROLLUP_VERSION = 'rollup-v1';
export const TRIAGE_ENGINE_VERSION = 'triageEngine-spec01-v1';

/** Metrics whose daily value is the last good reading of the day (nightly summaries, exams, check-ins). */
export const LAST_OF_DAY_METRICS = [
  'resting_hr',
  'hrv_rmssd',
  'sleep_eff',
  'onsd',
  'iop',
  'bmd_delta',
  'wbc_lymph',
  'pvt_lapses',
  'ared_load',
  'cabin_co2',
  'blood_glucose',
  'core_temp',
  'daily_sleep_hours',
  'mood_index',
];

/** Metrics whose daily value is the mean of the day's spot readings (watch blood pressure). */
export const MEAN_OF_DAY_METRICS = ['systolic_bp', 'diastolic_bp'];

const DAY_MS = 86_400_000;

/** Recomputes `daily_metrics` for one astronaut over [from, to) (UTC days). */
export async function rollupDays(db: Db, astronautId: string, from: Date, to: Date): Promise<number> {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Math.max(to.getTime(), start.getTime() + DAY_MS));
  const upsert = sql`on conflict (astronaut_id, metric_id, day) do update set
    value = excluded.value, n = excluded.n, method = excluded.method, origin = excluded.origin,
    pipeline_version = excluded.pipeline_version, computed_at = now()`;
  const window = sql`o.astronaut_id = ${astronautId} and o.quality = 'ok' and o.ts >= ${start.toISOString()}::timestamptz and o.ts < ${end.toISOString()}::timestamptz`;
  const day = sql`((o.ts at time zone 'UTC')::date)`;

  // 1. Last good reading of the day.
  await db.execute(sql`
    insert into daily_metrics (astronaut_id, metric_id, day, value, n, method, origin, pipeline_version)
    select distinct on (o.metric_id, ${day}) o.astronaut_id, o.metric_id, ${day}, o.value,
      count(*) over (partition by o.metric_id, ${day}), 'last_of_day', o.origin, ${ROLLUP_VERSION}
    from observations o
    where ${window} and o.metric_id in (${sql.join(LAST_OF_DAY_METRICS.map((m) => sql`${m}`), sql`, `)})
    order by o.metric_id, ${day}, o.ts desc
    ${upsert}`);

  // 2. SpO₂: median of minute values.
  await db.execute(sql`
    insert into daily_metrics (astronaut_id, metric_id, day, value, n, method, origin, pipeline_version)
    select o.astronaut_id, 'spo2', ${day}, percentile_cont(0.5) within group (order by o.value), count(*),
      'median_minute', (array_agg(o.origin))[1], ${ROLLUP_VERSION}
    from observations o where ${window} and o.metric_id = 'spo2'
    group by o.astronaut_id, ${day}
    ${upsert}`);

  // 2b. Blood pressure: mean of the day's watch readings.
  await db.execute(sql`
    insert into daily_metrics (astronaut_id, metric_id, day, value, n, method, origin, pipeline_version)
    select o.astronaut_id, o.metric_id, ${day}, avg(o.value), count(*), 'mean_of_day', (array_agg(o.origin))[1], ${ROLLUP_VERSION}
    from observations o where ${window} and o.metric_id in (${sql.join(MEAN_OF_DAY_METRICS.map((m) => sql`${m}`), sql`, `)})
    group by o.astronaut_id, o.metric_id, ${day}
    ${upsert}`);

  // 3. Radiation: mean dose rate (µGy/h) × 24 h → mSv/day (1 mGy ≈ 1 mSv for display, spec 05 §4.2).
  await db.execute(sql`
    insert into daily_metrics (astronaut_id, metric_id, day, value, n, method, origin, pipeline_version)
    select o.astronaut_id, 'rad_dose', ${day}, avg(o.value) * 24 / 1000, count(*),
      'mean_rate_x24h', (array_agg(o.origin))[1], ${ROLLUP_VERSION}
    from observations o where ${window} and o.metric_id = 'dose_rate'
    group by o.astronaut_id, ${day}
    ${upsert}`);

  // 4. Resting HR fallback when no nightly ring value exists: 5th percentile of minute heart rate.
  await db.execute(sql`
    insert into daily_metrics (astronaut_id, metric_id, day, value, n, method, origin, pipeline_version)
    select o.astronaut_id, 'resting_hr', ${day}, percentile_cont(0.05) within group (order by o.value), count(*),
      'p05_minute_hr', (array_agg(o.origin))[1], ${ROLLUP_VERSION}
    from observations o where ${window} and o.metric_id = 'heart_rate'
    group by o.astronaut_id, ${day}
    on conflict (astronaut_id, metric_id, day) do nothing`);

  const [{ n }] = await queryRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from daily_metrics where astronaut_id = ${astronautId}
        and day >= ${start.toISOString().slice(0, 10)}::date and day < ${end.toISOString().slice(0, 10)}::date`
  );
  return n;
}

/** Writes a triage event for each zone whose deterministic status changed since the last event. */
export async function evaluateTriage(db: Db, astronautId: string, at = new Date()): Promise<number> {
  const crew = await getProfile(db, astronautId, null, { forceFull: true });
  if (!crew) return 0;
  const built = await buildZonesFromDb(db, crew);
  if (!built.hasData) return 0;
  const statuses = evaluateAllZones(built.zones, '0g_transit');
  let written = 0;
  for (const zone of Object.keys(statuses) as BodyZoneId[]) {
    const last = (
      await db
        .select({ status: triageEvents.status })
        .from(triageEvents)
        .where(and(eq(triageEvents.astronautId, astronautId), eq(triageEvents.zone, zone)))
        .orderBy(desc(triageEvents.ts))
        .limit(1)
    )[0];
    const status: TriageStatus = statuses[zone];
    if (last?.status === status) continue;
    await db.insert(triageEvents).values({
      astronautId,
      ts: at,
      zone,
      status,
      previousStatus: last?.status ?? null,
      metrics: built.zones[zone].map((r) => ({ metricId: r.metricId, value: r.currentValue, unit: r.unit })),
      engineVersion: TRIAGE_ENGINE_VERSION,
    });
    written++;
  }
  return written;
}
