/**
 * ARGUS — Deterministic Continuous Glucose Monitoring (CGM) 5-Minute Curve Generator
 * Sources: SRC-028 (Polaris Dawn CGM precedent), SRC-083 (International Consensus on Time in Range:
 * 5-min cadence, rate-of-change trend arrows, 70–140 mg/dL tight euglycemic target), SRC-084 (ADA CGM §7).
 */

import type { ScenarioId, TriageStatus } from '../types/argus';

export const CGM_INTERVAL_MINUTES = 5;
export const CGM_POINTS_PER_DAY = 288; // 24h * 12 readings/hour
// Source: SRC-083 (International Consensus on Time in Range, tight euglycemic target 70–140 mg/dL)
export const CGM_TARGET_LOW_MG_DL = 70;
export const CGM_TARGET_HIGH_MG_DL = 140;

export type CgmEventTag = 'nocturnal' | 'postprandial' | 'ared_dip' | 'baseline';

export type CgmTrendCode =
  | 'rapid_rise'
  | 'rise'
  | 'slow_rise'
  | 'steady'
  | 'slow_fall'
  | 'fall'
  | 'rapid_fall';

export type CgmTrendArrow = '↑↑' | '↑' | '↗' | '→' | '↘' | '↓' | '↓↓';

export interface CgmReadingPoint {
  minuteOfDay: number;
  timeLabel: string;
  glucoseMgDl: number;
  eventTag: CgmEventTag;
}

export interface CgmTrendResult {
  arrow: CgmTrendArrow;
  code: CgmTrendCode;
  label: string;
  rateMgDlPerMin: number;
}

export interface CgmTimeInRange {
  lowMgDl: number;
  highMgDl: number;
  percentInRange: number;
  percentBelow: number;
  percentAbove: number;
  countInRange: number;
  totalCount: number;
  meanMgDl: number;
  minMgDl: number;
  maxMgDl: number;
  status: TriageStatus;
}

export interface CgmCurveOptions {
  crewId: string;
  scenarioId?: ScenarioId;
  missionDay?: number;
  baselineMgDl?: number;
  shiftMin?: number;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(x: number, center: number, sigma: number): number {
  const z = (x - center) / sigma;
  return Math.exp(-0.5 * z * z);
}

function formatMinuteOfDay(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

const SCENARIO_OFFSET_MG_DL: Record<ScenarioId, number> = {
  nominal: 0,
  sans_alert: 2,
  high_co2: 6,
  solar_storm: 9,
};

/**
 * Generates a pure deterministic 24-hour 5-minute CGM curve (288 readings) with
 * nocturnal baselines, postprandial meal peaks, and ARED resistive exercise dips.
 */
export function generateCgm24hCurve(options: CgmCurveOptions): CgmReadingPoint[] {
  const scenarioId: ScenarioId = options.scenarioId ?? 'nominal';
  const missionDay = options.missionDay ?? 30;
  const shiftMin = options.shiftMin ?? 0;
  const seed = hashString(`${options.crewId}:${scenarioId}:${missionDay}`);
  const rand = mulberry32(seed);

  const base = (options.baselineMgDl ?? 88) + SCENARIO_OFFSET_MG_DL[scenarioId];
  const mealScale = scenarioId === 'solar_storm' ? 1.15 : scenarioId === 'high_co2' ? 1.08 : 1.0;

  const points: CgmReadingPoint[] = [];
  for (let i = 0; i < CGM_POINTS_PER_DAY; i++) {
    const minuteOfDay = i * CGM_INTERVAL_MINUTES;
    const bodyMinute = ((minuteOfDay - shiftMin) % 1440 + 1440) % 1440;

    // Subtle dawn phenomenon (05:00–07:00)
    const dawn = 5 * gaussian(bodyMinute, 360, 55);

    // Three postprandial excursions (breakfast ~08:15, lunch ~13:20, dinner ~19:20)
    const breakfast = 38 * mealScale * gaussian(bodyMinute, 495, 42);
    const lunch = 44 * mealScale * gaussian(bodyMinute, 800, 48);
    const dinner = 40 * mealScale * gaussian(bodyMinute, 1160, 46);
    const mealBoost = breakfast + lunch + dinner;

    // Two ARED resistive exercise dips (morning ~10:25, afternoon ~17:15)
    const morningAred = -15 * gaussian(bodyMinute, 625, 28);
    const afternoonAred = -16 * gaussian(bodyMinute, 1035, 30);
    const aredDip = morningAred + afternoonAred;

    // Deterministic interstitial sensor jitter
    const noise = (rand() - 0.5) * 4.4;
    const glucoseMgDl = Math.round(Math.min(350, Math.max(45, base + dawn + mealBoost + aredDip + noise)));

    let eventTag: CgmEventTag = 'baseline';
    if (aredDip <= -6) eventTag = 'ared_dip';
    else if (mealBoost >= 12) eventTag = 'postprandial';
    else if (bodyMinute < 390 || bodyMinute >= 1380) eventTag = 'nocturnal';

    points.push({
      minuteOfDay,
      timeLabel: formatMinuteOfDay(minuteOfDay),
      glucoseMgDl,
      eventTag,
    });
  }
  return points;
}

/**
 * Maps a glucose rate of change (mg/dL/min) to standard CGM trend arrows (Source: SRC-083).
 */
export function classifyCgmRate(rateMgDlPerMin: number): CgmTrendResult {
  const rate = Math.round(rateMgDlPerMin * 100) / 100;
  if (rate >= 3.0) return { arrow: '↑↑', code: 'rapid_rise', label: 'Rising rapidly', rateMgDlPerMin: rate };
  if (rate >= 2.0) return { arrow: '↑', code: 'rise', label: 'Rising', rateMgDlPerMin: rate };
  if (rate >= 1.0) return { arrow: '↗', code: 'slow_rise', label: 'Rising slowly', rateMgDlPerMin: rate };
  if (rate <= -3.0) return { arrow: '↓↓', code: 'rapid_fall', label: 'Falling rapidly', rateMgDlPerMin: rate };
  if (rate <= -2.0) return { arrow: '↓', code: 'fall', label: 'Falling', rateMgDlPerMin: rate };
  if (rate <= -1.0) return { arrow: '↘', code: 'slow_fall', label: 'Falling slowly', rateMgDlPerMin: rate };
  return { arrow: '→', code: 'steady', label: 'Steady', rateMgDlPerMin: rate };
}

/**
 * Computes the CGM rate-of-change trend arrow from the most recent window (default 15 min).
 */
export function computeCgmTrendArrow(
  points: Pick<CgmReadingPoint, 'minuteOfDay' | 'glucoseMgDl'>[],
  windowMinutes = 15
): CgmTrendResult {
  if (points.length < 2) return classifyCgmRate(0);
  const latest = points[points.length - 1];
  const targetMinute = latest.minuteOfDay - windowMinutes;

  let earlier = points[0];
  for (let i = points.length - 2; i >= 0; i--) {
    earlier = points[i];
    if (earlier.minuteOfDay <= targetMinute) break;
  }

  const dt = latest.minuteOfDay - earlier.minuteOfDay;
  if (dt <= 0) return classifyCgmRate(0);
  return classifyCgmRate((latest.glucoseMgDl - earlier.glucoseMgDl) / dt);
}

/**
 * Computes Time-in-Range (default 70–140 mg/dL tight euglycemic target, Source: SRC-083).
 */
export function computeTimeInRange(
  points: Array<{ glucoseMgDl: number }>,
  lowMgDl = CGM_TARGET_LOW_MG_DL,
  highMgDl = CGM_TARGET_HIGH_MG_DL
): CgmTimeInRange {
  const totalCount = points.length;
  if (totalCount === 0) {
    return {
      lowMgDl,
      highMgDl,
      percentInRange: 0,
      percentBelow: 0,
      percentAbove: 0,
      countInRange: 0,
      totalCount: 0,
      meanMgDl: 0,
      minMgDl: 0,
      maxMgDl: 0,
      status: 'yellow',
    };
  }

  let countInRange = 0;
  let countBelow = 0;
  let countAbove = 0;
  let sum = 0;
  let minMgDl = Infinity;
  let maxMgDl = -Infinity;

  for (const p of points) {
    const g = p.glucoseMgDl;
    sum += g;
    if (g < minMgDl) minMgDl = g;
    if (g > maxMgDl) maxMgDl = g;
    if (g < lowMgDl) countBelow++;
    else if (g > highMgDl) countAbove++;
    else countInRange++;
  }

  const percentInRange = Math.round((countInRange / totalCount) * 100);
  const percentBelow = Math.round((countBelow / totalCount) * 100);
  const percentAbove = Math.round((countAbove / totalCount) * 100);
  const status: TriageStatus = percentInRange >= 70 ? 'green' : percentInRange >= 50 ? 'yellow' : 'red';

  return {
    lowMgDl,
    highMgDl,
    percentInRange,
    percentBelow,
    percentAbove,
    countInRange,
    totalCount,
    meanMgDl: Math.round(sum / totalCount),
    minMgDl,
    maxMgDl,
    status,
  };
}
