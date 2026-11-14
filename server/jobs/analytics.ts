/**
 * ARGUS — Per-astronaut analytics job (specs/05-data-platform.md §5.2–§5.3)
 * Writes `baselines` (preflight = Earth before launch, early_flight, rolling_14d, hour_of_day) and `anomalies` (ewma, cusum, robust_z).
 * Informational only: never changes triage status (AGENTS.md §2.4).
 */

import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import {
  cusum,
  DRIFT_FROM_EARLY_FLIGHT,
  ewma,
  mergeRuns,
  PERSISTENCE_MIN,
  ROBUST_Z_LIMIT,
  robustZ,
  runs,
  severityOf,
  summarize,
} from '../../shared/analytics';
import { isMetricId, METRIC_TYPICAL_SD } from '../../src/utils/triageEngine';
import type { Db } from '../db/client';
import { anomalies, astronauts, baselines, dailyMetrics, missions, observations } from '../db/schema';

export const ANALYTICS_VERSION = 'analytics-v1';
const DAY_MS = 86_400_000;
const EARLY_FLIGHT_DAYS = 7;
const ROLLING_DAYS = 14;
/** Minute streams that get an hour-of-day (circadian) baseline and robust-z detection. */
export const CIRCADIAN_METRICS = ['heart_rate'];
const ROBUST_WINDOW_H = 48;

type BaselineRow = typeof baselines.$inferInsert;
type AnomalyRow = typeof anomalies.$inferInsert;

const dayStart = (day: string) => new Date(`${day}T00:00:00Z`);
const dayEnd = (day: string) => new Date(dayStart(day).getTime() + DAY_MS - 1);

export async function runAnalytics(db: Db, astronautId: string, now = new Date()): Promise<{ baselines: number; anomalies: number }> {
  const daily = await db
    .select({ metricId: dailyMetrics.metricId, day: dailyMetrics.day, value: dailyMetrics.value })
    .from(dailyMetrics)
    .where(eq(dailyMetrics.astronautId, astronautId))
    .orderBy(asc(dailyMetrics.day));
  const byMetric = new Map<string, Array<{ day: string; value: number }>>();
  for (const r of daily) byMetric.set(r.metricId, [...(byMetric.get(r.metricId) ?? []), { day: r.day, value: r.value }]);

  // Mission start splits Earth pre-flight days from in-flight days (spec 05 §5.2).
  const mission = (
    await db
      .select({ startAt: missions.startAt })
      .from(astronauts)
      .leftJoin(missions, eq(missions.id, astronauts.missionId))
      .where(eq(astronauts.id, astronautId))
      .limit(1)
  )[0];
  const launchDay = mission?.startAt ? mission.startAt.toISOString().slice(0, 10) : '0000-00-00';

  const baselineRows: BaselineRow[] = [];
  const anomalyRows: AnomalyRow[] = [];
  const common = { astronautId, pipelineVersion: ANALYTICS_VERSION, computedAt: now };

  // ── Daily metrics: Earth pre-flight, early-flight and rolling baselines; EWMA and CUSUM drift ──
  for (const [metricId, all] of byMetric) {
    const earthDays = all.filter((p) => p.day < launchDay);
    const series = all.filter((p) => p.day >= launchDay); // in flight
    if (series.length < 3) continue;
    const sdFloor = isMetricId(metricId) ? METRIC_TYPICAL_SD[metricId] : 1e-6;
    const summaryRow = (kind: 'preflight' | 'early_flight', pts: Array<{ day: string; value: number }>) => {
      const sum = summarize(pts.map((p) => p.value));
      return { sum, row: { ...common, metricId, kind, hour: -1, ...sum, sd: Math.max(sum.sd, sdFloor), windowStart: dayStart(pts[0].day), windowEnd: dayEnd(pts[pts.length - 1].day) } as BaselineRow };
    };
    const early = summaryRow('early_flight', series.slice(0, EARLY_FLIGHT_DAYS));
    baselineRows.push(early.row);
    // Pre-flight = measured on Earth before launch (≥ 2 days). Without Earth data, fall back to early flight.
    const pre = earthDays.length >= 2 ? summaryRow('preflight', earthDays) : { ...early, row: { ...early.row, kind: 'preflight' as const } };
    baselineRows.push(pre.row);
    const ref = DRIFT_FROM_EARLY_FLIGHT.includes(metricId) ? early : pre;
    const preSummary = ref.sum;
    const preSd = Math.max(ref.sum.sd, sdFloor);

    const rolling = series.slice(-ROLLING_DAYS);
    baselineRows.push({
      ...common,
      metricId,
      kind: 'rolling_14d',
      hour: -1,
      ...summarize(rolling.map((p) => p.value)),
      windowStart: dayStart(rolling[0].day),
      windowEnd: dayEnd(rolling[rolling.length - 1].day),
    });

    const z = series.map((p) => (p.value - preSummary.mean) / preSd);
    const e = ewma(z);
    for (const run of runs(e, (v) => Math.abs(v) >= 1, 2)) {
      const peak = e.slice(run.start, run.end + 1).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
      const severity = severityOf(peak);
      if (severity === 'steady') continue;
      anomalyRows.push({
        ...common,
        metricId,
        tsStart: dayStart(series[run.start].day),
        tsEnd: dayEnd(series[run.end].day),
        detector: 'ewma',
        score: Math.round(peak * 100) / 100,
        severity,
        detail: { baselineMean: preSummary.mean, baselineSd: preSd, reference: ref.row.kind, direction: peak > 0 ? 'up' : 'down', days: run.end - run.start + 1 },
      });
    }

    const c = cusum(z);
    for (const run of runs(c.flags, (f) => f !== 0, 1)) {
      const dir = c.flags[run.start];
      const stat = Math.max(...(dir > 0 ? c.hi : c.lo).slice(run.start, run.end + 1));
      anomalyRows.push({
        ...common,
        metricId,
        tsStart: dayStart(series[run.start].day),
        tsEnd: dayEnd(series[run.end].day),
        detector: 'cusum',
        score: Math.round(stat * 100) / 100,
        severity: stat > 8 ? 'drifting' : 'watch',
        detail: { direction: dir > 0 ? 'up' : 'down', k: 0.5, h: 4, reference: ref.row.kind, baselineMean: preSummary.mean, baselineSd: preSd },
      });
    }
  }

  // ── Minute streams: hour-of-day baseline + persistent robust-z outliers ──
  const since = new Date(now.getTime() - ROLLING_DAYS * DAY_MS);
  for (const metricId of CIRCADIAN_METRICS) {
    const rows = await db
      .select({ ts: observations.ts, value: observations.value })
      .from(observations)
      .where(and(eq(observations.astronautId, astronautId), eq(observations.metricId, metricId), eq(observations.quality, 'ok'), gte(observations.ts, since)))
      .orderBy(asc(observations.ts));
    if (rows.length < 24 * 30) continue;
    const byHour: number[][] = Array.from({ length: 24 }, () => []);
    for (const r of rows) byHour[r.ts.getUTCHours()].push(r.value);
    const hourStats = byHour.map((vals) => (vals.length >= 10 ? summarize(vals) : null));
    hourStats.forEach((s, hour) => {
      if (!s) return;
      baselineRows.push({ ...common, metricId, kind: 'hour_of_day', hour, ...s, windowStart: rows[0].ts, windowEnd: rows[rows.length - 1].ts });
    });

    const recent = rows.filter((r) => r.ts.getTime() >= now.getTime() - ROBUST_WINDOW_H * 3600_000);
    const rz = recent.map((r) => {
      const s = hourStats[r.ts.getUTCHours()];
      return s ? robustZ(r.value, s.median, s.mad, metricId === 'heart_rate' ? 1 : 0.02) : 0;
    });
    // Episodes less than 60 minutes apart are one anomaly.
    for (const run of mergeRuns(runs(rz, (v) => Math.abs(v) >= ROBUST_Z_LIMIT, PERSISTENCE_MIN), 60)) {
      const peak = rz.slice(run.start, run.end + 1).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
      anomalyRows.push({
        ...common,
        metricId,
        tsStart: recent[run.start].ts,
        tsEnd: recent[run.end].ts,
        detector: 'robust_z',
        score: Math.round(peak * 100) / 100,
        severity: Math.abs(peak) >= 6 ? 'drifting' : 'watch',
        detail: { minutes: run.end - run.start + 1, limit: ROBUST_Z_LIMIT, persistenceMin: PERSISTENCE_MIN, reference: 'hour_of_day' },
      });
    }
  }

  // Derived data is fully recomputed (raw stays untouched).
  await db.delete(baselines).where(eq(baselines.astronautId, astronautId));
  await db.delete(anomalies).where(eq(anomalies.astronautId, astronautId));
  for (let i = 0; i < baselineRows.length; i += 500) await db.insert(baselines).values(baselineRows.slice(i, i + 500));
  for (let i = 0; i < anomalyRows.length; i += 500) await db.insert(anomalies).values(anomalyRows.slice(i, i + 500)).onConflictDoNothing();
  return { baselines: baselineRows.length, anomalies: anomalyRows.length };
}

/** Runs the job for every active astronaut. */
export async function runAnalyticsForAll(db: Db): Promise<void> {
  const crew = await db.select({ id: astronauts.id }).from(astronauts).where(isNull(astronauts.archivedAt));
  for (const { id } of crew) await runAnalytics(db, id);
}

/** Starts the periodic refresh (spec 05 §5.1). `ARGUS_ANALYTICS_INTERVAL_MIN=0` disables it. */
export function startAnalyticsTimer(db: Db): NodeJS.Timeout | null {
  const minutes = Number(process.env.ARGUS_ANALYTICS_INTERVAL_MIN ?? 5);
  if (!minutes) return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAnalyticsForAll(db);
    } catch (err) {
      console.error('[ARGUS analytics] refresh failed', err);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 10_000);
  return setInterval(() => void tick(), minutes * 60_000);
}
