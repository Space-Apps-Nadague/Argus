/**
 * Deterministic per-metric trend models (specs/04-ai-backend.md §5). No LLM involved.
 *
 * TODO(Task 27): delegate baseline/drift/forecast to Sprint 7's `src/utils/driftAnalytics.ts`
 * (computeDrift / forecastMetric) and keep only `daysToRed` here.
 */

import type { BodyZoneId, GravityEnvironment, VitalSignReading } from '../../src/types/argus';
import type { MetricTrend, TrendDirection, TrendLevel } from '../../src/types/aiApi';
import { evaluateMetricStatus, getMetricThreshold } from '../../src/utils/triageEngine';

export const BASELINE_DAYS = 7;
export const EWMA_ALPHA = 0.3;
export const SLOPE_WINDOW = 10;
export const MAX_DAYS_TO_RED = 60;

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

function sampleSd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

const round = (v: number, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Ordinary least squares slope & intercept. */
export function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  if (xs.length < 3) return null;
  const xm = mean(xs);
  const ym = mean(ys);
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - xm) ** 2;
    sxy += (x - xm) * (ys[i] - ym);
  });
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: ym - slope * xm };
}

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
  const sdFloor = Math.max((t.nominalMax - t.nominalMin) / 8, 1e-6);
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
