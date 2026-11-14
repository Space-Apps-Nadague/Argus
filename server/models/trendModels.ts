/**
 * Deterministic per-metric trend models (specs/04-ai-backend.md §5). No LLM involved.
 * Statistics come from `shared/analytics` (also used by the HUD's `driftAnalytics.ts`), and the baseline
 * SD floor is `METRIC_TYPICAL_SD`, the same as the HUD, so server and HUD agree (spec 05 §5).
 */

import type { BodyZoneId, GravityEnvironment, VitalSignReading } from '../../src/types/argus';
import type { MetricTrend, TrendDirection, TrendLevel } from '../../src/types/aiApi';
import { EWMA_ALPHA, linearRegression, mean, sampleSd } from '../../shared/analytics';
import { evaluateMetricStatus, getMetricThreshold, isMetricId, METRIC_TYPICAL_SD } from '../../src/utils/triageEngine';

export { linearRegression };

export const BASELINE_DAYS = 7;
export const SLOPE_WINDOW = 10;
export const MAX_DAYS_TO_RED = 60;


const round = (v: number, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};


export function trendLevel(ewmaZ: number): TrendLevel {
  const a = Math.abs(ewmaZ);
  if (a >= 2) return 'drifting';
  if (a >= 1) return 'watch';
  return 'steady';
}

/**
 * Mission days until the value crosses into the red band at the current slope.
 * 0 = already red; null = moving away from red, flat, or beyond MAX_DAYS_TO_RED.
 */
export function daysUntilRed(metricId: string, current: number, slopePerDay: number): number | null {
  const t = getMetricThreshold(metricId);
  if (current > t.yellowMax || current < t.yellowMin) return 0;
  if (Math.abs(slopePerDay) < 1e-9) return null;
  const boundary = slopePerDay > 0 ? t.yellowMax : t.yellowMin;
  const days = (boundary - current) / slopePerDay;
  if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS_TO_RED) return null;
  return Math.ceil(days);
}

export function analyzeMetricTrend(
  reading: VitalSignReading,
  zoneId: BodyZoneId,
  environment: GravityEnvironment
): MetricTrend {
  const history = [...reading.history].sort((a, b) => a.missionDay - b.missionDay);
  const values = history.map((p) => p.value);
  const t = getMetricThreshold(reading.metricId, environment);

  const baselinePts = values.slice(0, BASELINE_DAYS);
  const baselineMean = baselinePts.length ? mean(baselinePts) : reading.currentValue;
  const sdFloor = isMetricId(reading.metricId) ? METRIC_TYPICAL_SD[reading.metricId] : Math.max((t.nominalMax - t.nominalMin) / 8, 1e-6);
  const sd = Math.max(sampleSd(baselinePts), sdFloor);

  const zSeries = values.length ? values.map((v) => (v - baselineMean) / sd) : [0];
  let ewma = 0;
  zSeries.forEach((z, i) => {
    ewma = i === 0 ? z : EWMA_ALPHA * z + (1 - EWMA_ALPHA) * ewma;
  });
  const zScore = (reading.currentValue - baselineMean) / sd;

  const window = history.slice(-SLOPE_WINDOW);
  const fit = linearRegression(
    window.map((p) => p.missionDay),
    window.map((p) => p.value)
  );
  const slopePerDay = fit?.slope ?? 0;
  const lastDay = window.length ? window[window.length - 1].missionDay : 0;
  const forecast3d = fit ? fit.intercept + fit.slope * (lastDay + 3) : null;

  const direction: TrendDirection = ewma >= 0.5 ? 'up' : ewma <= -0.5 ? 'down' : 'flat';

  return {
    metricId: reading.metricId,
    label: reading.label,
    unit: reading.unit,
    zoneId,
    currentValue: reading.currentValue,
    status: evaluateMetricStatus(reading.metricId, reading.currentValue, environment),
    slopePerDay: round(slopePerDay, 4),
    zScore: round(zScore, 2),
    ewmaZ: round(ewma, 2),
    level: trendLevel(ewma),
    direction,
    daysToRed: daysUntilRed(reading.metricId, reading.currentValue, slopePerDay),
    forecast3d: forecast3d === null ? null : round(forecast3d, 3),
  };
}

export function analyzeAllTrends(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  environment: GravityEnvironment
): MetricTrend[] {
  return (Object.keys(zones) as BodyZoneId[]).flatMap((zoneId) =>
    zones[zoneId].map((r) => analyzeMetricTrend(r, zoneId, environment))
  );
}

/** A trend worth surfacing: off-nominal now, drifting from baseline, or heading to red within 14 days. */
export function isFlagged(trend: MetricTrend): boolean {
  return (
    trend.status !== 'green' ||
    trend.level !== 'steady' ||
    (trend.daysToRed !== null && trend.daysToRed <= 14)
  );
}
