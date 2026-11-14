/**
 * ARGUS — Personal-Baseline Drift, Short-Range Forecast & Metric Links
 * Single Source of Truth: specs/01-data-schema.md §5
 *
 * Ported from the ARGOS prototype (ARGOS_The_Thousand_Eyes.html: base/stat/fcast/links).
 * Pure + deterministic. Informational only: NEVER changes a TriageStatus
 * (status always comes from triageEngine.evaluateMetricStatus).
 */

import {
  BodyZoneId,
  DriftDirection,
  DriftLevel,
  DriftResult,
  ForecastPoint,
  MetricId,
  MetricLink,
  PersonalBaseline,
  TelemetryHistoryPoint,
  VitalSignReading,
} from '../types/argus';
import { METRIC_TYPICAL_SD, isMetricId } from './triageEngine';
import { mean, sampleSd } from '../../shared/analytics/stats';
import { baselinePoints } from '../../shared/analytics/detectors';

export const BASELINE_DAYS = 7;
export const EWMA_ALPHA = 0.3;
export const FORECAST_WINDOW = 10;
export const FORECAST_HORIZONS = [1, 2, 3] as const;
export const LINK_MIN_ABS_R = 0.6;
export const LINK_MIN_N = 7;
export const LINK_MAX_RESULTS = 5;

/** Two-sided 90% Student-t critical values t(0.95, df) for df = 1..30. */
const T_95: number[] = [
  6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812,
  1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.74, 1.734, 1.729, 1.725,
  1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697,
];

function tCritical(df: number): number {
  if (df <= 0) return T_95[0];
  return T_95[Math.min(df, T_95.length) - 1];
}


function typicalSd(metricId: string): number {
  return isMetricId(metricId) ? METRIC_TYPICAL_SD[metricId] : 1;
}

function sortedHistory(history: TelemetryHistoryPoint[]): TelemetryHistoryPoint[] {
  return [...history].sort((a, b) => a.missionDay - b.missionDay);
}

/** Baseline = Earth pre-flight days when present (else the first 7 mission days), SD floored by METRIC_TYPICAL_SD. */
export function computeBaseline(
  metricId: string,
  history: TelemetryHistoryPoint[]
): PersonalBaseline | null {
  const pts = baselinePoints(metricId, sortedHistory(history), BASELINE_DAYS).map((p) => p.value);
  if (!pts.length) return null;
  return {
    mean: mean(pts),
    sd: Math.max(sampleSd(pts), typicalSd(metricId)),
    n: pts.length,
  };
}

export function driftLevel(ewmaZ: number): DriftLevel {
  const a = Math.abs(ewmaZ);
  if (a >= 2) return 'drifting';
  if (a >= 1) return 'watch';
  return 'steady';
}

export function computeDrift(
  metricId: string,
  history: TelemetryHistoryPoint[]
): DriftResult | null {
  const baseline = computeBaseline(metricId, history);
  if (!baseline) return null;
  const z = sortedHistory(history).map((p) => (p.value - baseline.mean) / baseline.sd);
  let e = 0;
  z.forEach((zi, i) => {
    e = i === 0 ? zi : EWMA_ALPHA * zi + (1 - EWMA_ALPHA) * e;
  });
  const zScore = z[z.length - 1];
  const direction: DriftDirection = e >= 0.5 ? 'up' : e <= -0.5 ? 'down' : 'flat';
  return { baseline, zScore, ewmaZ: e, direction, level: driftLevel(e) };
}

/** OLS on the last 10 points with a 90% prediction interval; null if n < 4. */
export function forecastMetric(
  metricId: string,
  history: TelemetryHistoryPoint[],
  horizons: readonly number[] = FORECAST_HORIZONS
): ForecastPoint[] | null {
  const pts = sortedHistory(history).slice(-FORECAST_WINDOW);
  const n = pts.length;
  if (n < 4) return null;
  const xs = pts.map((p) => p.missionDay);
  const ys = pts.map((p) => p.value);
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
  const intercept = ym - slope * xm;
  let ss = 0;
  xs.forEach((x, i) => {
    ss += (ys[i] - (intercept + slope * x)) ** 2;
  });
  const s = Math.max(Math.sqrt(ss / (n - 2)), 0.4 * typicalSd(metricId));
  const t = tCritical(n - 2);
  const lastDay = xs[n - 1];
  return horizons.map((h) => {
    const x = lastDay + h;
    const yhat = intercept + slope * x;
    const half = t * s * Math.sqrt(1 + 1 / n + (x - xm) ** 2 / sxx);
    return {
      missionDay: x,
      dateLabel: `MD-${x}`,
      mean: yhat,
      lower: yhat - half,
      upper: yhat + half,
    };
  });
}

/** Physiologically plausible candidate pairs grounded in NASA HRP hazards (SOURCES.md). */
export const CANDIDATE_METRIC_LINKS: ReadonlyArray<{
  from: MetricId;
  to: MetricId;
  expectedSign: 1 | -1;
  mechanism: string;
}> = [
  { from: 'cabin_co2', to: 'onsd', expectedSign: 1, mechanism: 'CO₂ dilates cerebral vessels, raising intracranial pressure' },
  { from: 'cabin_co2', to: 'pvt_lapses', expectedSign: 1, mechanism: 'Elevated CO₂ impairs alertness' },
  { from: 'onsd', to: 'iop', expectedSign: 1, mechanism: 'Headward fluid shift loads the eye' },
  { from: 'sleep_eff', to: 'hrv_rmssd', expectedSign: 1, mechanism: 'Poor sleep lowers recovery (HRV)' },
  { from: 'sleep_eff', to: 'pvt_lapses', expectedSign: -1, mechanism: 'Sleep loss increases attention lapses' },
  { from: 'daily_sleep_hours', to: 'mood_index', expectedSign: 1, mechanism: 'Sleep duration directly supports affective stability and mood' },
  { from: 'systolic_bp', to: 'onsd', expectedSign: 1, mechanism: 'Elevated arterial pressure amplifies cephalad vascular pressure' },
  { from: 'core_temp', to: 'resting_hr', expectedSign: 1, mechanism: 'Elevated core temp drives thermoregulatory tachycardia' },
  { from: 'resting_hr', to: 'hrv_rmssd', expectedSign: -1, mechanism: 'Stress raises heart rate and lowers HRV' },
  { from: 'rad_dose', to: 'wbc_lymph', expectedSign: -1, mechanism: 'Radiation suppresses lymphocytes' },
  { from: 'ared_load', to: 'bmd_delta', expectedSign: 1, mechanism: 'Resistance loading protects bone' },
];

export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const xm = mean(x.slice(0, n));
  const ym = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - xm) * (y[i] - ym);
    sxx += (x[i] - xm) ** 2;
    syy += (y[i] - ym) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function pairedSeries(
  a: TelemetryHistoryPoint[],
  b: TelemetryHistoryPoint[],
  lag: 0 | 1
): [number[], number[]] {
  const byDay = new Map(b.map((p) => [p.missionDay, p.value]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of a) {
    const v = byDay.get(p.missionDay + lag);
    if (v !== undefined) {
      xs.push(p.value);
      ys.push(v);
    }
  }
  return [xs, ys];
}

/** Evidence-backed links: candidate pairs confirmed in this crew member's own series. */
export function findMetricLinks(
  zones: Record<BodyZoneId, VitalSignReading[]>
): MetricLink[] {
  const byMetric = new Map<string, TelemetryHistoryPoint[]>();
  Object.values(zones)
    .flat()
    .forEach((r) => byMetric.set(r.metricId, r.history));
  const out: MetricLink[] = [];
  for (const c of CANDIDATE_METRIC_LINKS) {
    const a = byMetric.get(c.from);
    const b = byMetric.get(c.to);
    if (!a || !b) continue;
    let best: MetricLink | null = null;
    for (const lag of [0, 1] as const) {
      const [xs, ys] = pairedSeries(a, b, lag);
      const r = pearson(xs, ys);
      if (r === null || xs.length < LINK_MIN_N || Math.abs(r) < LINK_MIN_ABS_R) continue;
      if (Math.sign(r) !== c.expectedSign) continue;
      if (!best || Math.abs(r) > Math.abs(best.r)) {
        best = { fromMetricId: c.from, toMetricId: c.to, lagDays: lag, r, n: xs.length, expectedSign: c.expectedSign, mechanism: c.mechanism };
      }
    }
    if (best) out.push(best);
  }
  return out.sort((p, q) => Math.abs(q.r) - Math.abs(p.r)).slice(0, LINK_MAX_RESULTS);
}

/** Display helper: "+1.8σ" / "−0.4σ". */
export function formatSigma(z: number): string {
  const sign = z > 0 ? '+' : z < 0 ? '−' : '';
  return `${sign}${Math.abs(z).toFixed(1)}σ`;
}
