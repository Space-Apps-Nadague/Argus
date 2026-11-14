/**
 * ARGUS — Thousand Eyes Pure Science Module
 * Ported from ARGOS_The_Thousand_Eyes.html (specs/02-ui-dashboard.md §2.4b).
 *
 * Pure & deterministic:
 * - Personal baseline (pre-flight or provisional first-3 in-mission; prior-to-latest for env)
 * - Location-expected physiological shift subtraction
 * - EWMA drift (alpha = 0.3), red-flag bounds, RMS deviation index, personal readiness (0–100)
 * - Hidden links (Pearson |r| >= 0.6, n >= 7, same-day or next-day lag)
 * - Real-data adapter from ARGUS zones (unmeasured indicators stay nodata, never fabricated)
 */

import { mean, sampleSd } from '../../../shared/analytics/stats';
import type { BodyZoneId, SpaceLocationId, VitalSignReading } from '../../types/argus';
import {
  BODY_SYSTEM_META,
  INDICATOR_MAP,
  INDICATOR_TIPS,
  THOUSAND_EYES_INDICATORS,
  getExpectedShift,
} from './indicators';
import type {
  EyePersonalBaseline,
  EyeStat,
  EyeStatus,
  HiddenLink,
  IndicatorDirection,
  MissionPhase,
  ObservationPoint,
  ThousandEyesIndicator,
  ThousandEyesIndicatorId,
  ThousandEyesSeriesMap,
} from './types';

export const EWMA_ALPHA = 0.3;
export const LINK_MIN_ABS_R = 0.6;
export const LINK_MIN_N = 7;
export const LINK_MAX_RESULTS = 8;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Directional badness: positive means drifting toward the worse direction. */
export function directionalBadness(direction: IndicatorDirection, z: number): number {
  if (direction === 'h') return z;
  if (direction === 'l') return -z;
  return Math.abs(z);
}

function sortedPoints(series: readonly ObservationPoint[] | undefined): ObservationPoint[] {
  if (!series?.length) return [];
  return [...series].sort((a, b) => a.day - b.day);
}

/**
 * Compute personal baseline for an indicator.
 * - Environment indicators (`flag === 'X'`): prior in-mission readings excluding latest (needs >= 3).
 * - Personal/behavioural indicators: pre-flight readings if present, else provisional first 3 readings.
 */
export function computePersonalBaseline(
  indicator: ThousandEyesIndicator,
  series: readonly ObservationPoint[] | undefined,
  phase: MissionPhase = 'mis'
): EyePersonalBaseline | null {
  const pts = sortedPoints(series);
  if (!pts.length) return null;

  if (indicator.flag === 'X') {
    const prior = pts
      .filter((p) => (p.phase ?? 'mis') === 'mis')
      .slice(0, -1)
      .map((p) => p.value);
    if (prior.length < 3 || phase !== 'mis') return null;
    return {
      mean: mean(prior),
      sd: Math.max(sampleSd(prior), indicator.typicalSd),
      n: prior.length,
      provisional: false,
    };
  }

  const pre = pts.filter((p) => p.phase === 'pre').map((p) => p.value);
  const provisional = pre.length === 0;
  const baseVals = provisional ? pts.slice(0, 3).map((p) => p.value) : pre;
  if (!baseVals.length) return null;

  const sd =
    baseVals.length >= 3
      ? Math.max(sampleSd(baseVals), indicator.typicalSd * 0.5)
      : indicator.typicalSd;

  return {
    mean: mean(baseVals),
    sd,
    n: baseVals.length,
    provisional,
  };
}

/** Evaluate one indicator against its personal baseline, location shift, EWMA drift, and red flags. */
export function evaluateIndicator(
  indicator: ThousandEyesIndicator,
  series: readonly ObservationPoint[] | undefined,
  locationId: SpaceLocationId,
  phase: MissionPhase = 'mis'
): EyeStat {
  const baseline = computePersonalBaseline(indicator, series, phase);
  const pts = sortedPoints(series);
  const phasePts = pts.filter((p) => (p.phase ?? 'mis') === phase);
  const activePts = phasePts.length ? phasePts : pts.slice(-1);

  if (!activePts.length || !baseline) {
    return {
      indicator,
      status: 'nodata',
      n: 0,
      currentValue: activePts.length ? activePts[activePts.length - 1].value : null,
      baseline,
      expectedShift: getExpectedShift(locationId, indicator.id),
      zCurrent: null,
      ewmaZ: null,
      bad: 0,
      red: false,
    };
  }

  const zSeries = activePts.map((p) => {
    const shift = getExpectedShift(p.locationId ?? locationId, indicator.id);
    return (p.value - baseline.mean - shift) / baseline.sd;
  });

  let ewma = 0;
  zSeries.forEach((z, idx) => {
    ewma = idx === 0 ? z : EWMA_ALPHA * z + (1 - EWMA_ALPHA) * ewma;
  });

  const lastPt = activePts[activePts.length - 1];
  const currentValue = lastPt.value;
  const expectedShift = getExpectedShift(lastPt.locationId ?? locationId, indicator.id);
  const zCurrent = zSeries[zSeries.length - 1];
  const rawBad = directionalBadness(indicator.direction, ewma);
  const bad = Math.max(0, rawBad);

  const red =
    (indicator.redLow !== null && currentValue < indicator.redLow) ||
    (indicator.redHigh !== null && currentValue > indicator.redHigh);

  let status: EyeStatus = 'nominal';
  if (red) {
    status = 'red_flag';
  } else if (phase !== 'pre') {
    const currentBad = directionalBadness(indicator.direction, zCurrent);
    if ((rawBad > 1.13 && activePts.length >= 2) || currentBad >= 2.5) {
      status = 'drifting';
    }
  }

  return {
    indicator,
    status,
    n: activePts.length,
    currentValue,
    baseline,
    expectedShift,
    zCurrent,
    ewmaZ: ewma,
    bad,
    red,
  };
}

/** Evaluate all 31 indicators in canonical body-system order. */
export function evaluateAllIndicators(
  seriesMap: ThousandEyesSeriesMap,
  locationId: SpaceLocationId,
  phase: MissionPhase = 'mis'
): EyeStat[] {
  return THOUSAND_EYES_INDICATORS.map((indicator) =>
    evaluateIndicator(indicator, seriesMap[indicator.id], locationId, phase)
  );
}

/** RMS of directional badness (σ) across measured personal (non-flagged) indicators. */
export function computeDeviationIndex(stats: readonly EyeStat[]): number | null {
  const personal = stats.filter((s) => s.status !== 'nodata' && !s.indicator.flag);
  if (!personal.length) return null;
  return Math.sqrt(mean(personal.map((s) => s.bad ** 2)));
}

/** Count of measured indicators currently breaching a hard red-flag limit. */
export function computeRedFlagCount(stats: readonly EyeStat[]): number {
  return stats.filter((s) => s.status !== 'nodata' && s.red).length;
}

/** Personal Readiness Score (0–100), or null when no personal indicators have data. */
export function computePersonalReadiness(stats: readonly EyeStat[]): number | null {
  const pdi = computeDeviationIndex(stats);
  if (pdi === null) return null;
  const reds = computeRedFlagCount(stats);
  return Math.round(clamp(100 - 22 * pdi - 15 * reds, 0, 100));
}

function pearsonR(xs: number[], ys: number[], minN: number): { r: number; n: number } | null {
  const n = xs.length;
  if (n < minN) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return { r: num / Math.sqrt(dx * dy), n };
}

/**
 * Find hidden links (|r| >= 0.6, n >= 7) across non-environment indicators,
 * testing same-day (lag 0) and next-day (lag 1) associations.
 */
export function findHiddenLinks(seriesMap: ThousandEyesSeriesMap): HiddenLink[] {
  const byDay = new Map<number, Partial<Record<ThousandEyesIndicatorId, number>>>();
  const keys = THOUSAND_EYES_INDICATORS.filter((i) => i.flag !== 'X').map((i) => i.id);

  keys.forEach((id) => {
    const pts = seriesMap[id];
    if (!pts) return;
    pts.forEach((p) => {
      const row = byDay.get(p.day) ?? {};
      row[id] = p.value;
      byDay.set(p.day, row);
    });
  });

  const days = [...byDay.keys()].sort((a, b) => a - b);
  const links: HiddenLink[] = [];

  for (const from of keys) {
    for (const to of keys) {
      if (from === to) continue;
      for (const lagDays of [0, 1] as const) {
        if (lagDays === 0 && from > to) continue;
        const xs: number[] = [];
        const ys: number[] = [];
        for (const day of days) {
          const u = byDay.get(day)?.[from];
          const v = byDay.get(day + lagDays)?.[to];
          if (u != null && v != null) {
            xs.push(u);
            ys.push(v);
          }
        }
        const corr = pearsonR(xs, ys, LINK_MIN_N);
        if (corr && Math.abs(corr.r) >= LINK_MIN_ABS_R) {
          links.push({ from, to, lagDays, r: corr.r, n: corr.n });
        }
      }
    }
  }

  return links.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, LINK_MAX_RESULTS);
}

/** Plain-language tip for an evaluated indicator, falling back to its body-system action. */
export function getTipForStat(stat: EyeStat): string {
  const pair = INDICATOR_TIPS[stat.indicator.id];
  if (pair) {
    const ref = (stat.baseline?.mean ?? 0) + stat.expectedShift;
    const isHigh = stat.currentValue === null ? true : stat.currentValue >= ref;
    const picked = pair[isHigh ? 0 : 1];
    if (picked) return picked;
  }
  return BODY_SYSTEM_META[stat.indicator.system].fallbackAction;
}

/** Format a hidden link as a concise readable string. */
export function formatHiddenLink(link: HiddenLink): string {
  const a = INDICATOR_MAP[link.from].label;
  const b = INDICATOR_MAP[link.to].label;
  const arrow = link.lagDays === 1 ? '→ next-day' : '↔ same-day';
  return `${a} ${arrow} ${b}: r = ${link.r.toFixed(2)} (n = ${link.n})`;
}

/**
 * Map ARGUS's live zone telemetry into ThousandEyesSeriesMap using real data only.
 * Unmeasured indicators are omitted so they stay in 'nodata' (never fabricated).
 */
export function zonesToSeriesMap(
  zones: Record<BodyZoneId, VitalSignReading[]>
): ThousandEyesSeriesMap {
  const byMetricId = new Map<string, VitalSignReading>();
  Object.values(zones).forEach((list) => {
    list.forEach((reading) => {
      byMetricId.set(reading.metricId, reading);
    });
  });

  const out: ThousandEyesSeriesMap = {};

  THOUSAND_EYES_INDICATORS.forEach((ind) => {
    if (!ind.argusMetricId) return;
    const reading = byMetricId.get(ind.argusMetricId);
    if (!reading?.history.length) return;

    out[ind.id] = reading.history.map((pt) => {
      let value = pt.value;
      if (ind.id === 'co2') {
        // ARGUS stores cabin ppCO2 in mmHg; prototype expects ppm at 760 mmHg.
        value = Math.round((pt.value * 1_000_000) / 760);
      } else if (ind.id === 'mood') {
        // ARGUS stores mood_index on 1–10; prototype uses 1–5.
        value = Number(clamp(pt.value / 2, 1, 5).toFixed(2));
      }
      return {
        day: pt.missionDay,
        value,
        phase: 'mis',
      };
    });
  });

  return out;
}
