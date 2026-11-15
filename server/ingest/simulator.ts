/**
 * ARGUS — Assumed sensor kit simulator (specs/05-data-platform.md §4)
 *
 * Generates minute-level wearable data per astronaut whose DAILY values follow the scenario template
 * (`getCrewAdjustedZones`), so the database-backed HUD tells the same story as the offline demo, while
 * the minute data is realistic enough for baselines and anomaly detection.
 *
 * Kit (spec 05 §4.1): smartwatch + personal dosimeter + CGM patch are worn; habitat CO₂, the exercise-device
 * log and periodic exams arrive automatically; glucometer photo remains as backup.
 * - Watch: 1-min heart rate, activity, sleep state; SpO₂ and breathing rate every few minutes; nightly HRV,
 *   resting HR, sleep efficiency, sleep hours and body-temperature estimate; spot blood pressure 3×/day; PVT app
 *   (Source: SRC-027, SRC-074, SRC-075, SRC-023, SRC-029)
 * - The circadian rhythm drifts ~2 h later over the mission and body temperature rises (Source: SRC-025)
 * - Personal dosimeter dose rate, 1-min (Source: SRC-026)
 * Pure and deterministic for a given seed.
 */

import type { CrewMemberProfile, MetricId, ScenarioId } from '../../src/types/argus';
import { getCrewAdjustedZones } from '../../src/data/telemetryScenarios';
import type { DeviceKind } from '../db/catalog';
import type { IncomingReading } from './normalize';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const TEMPLATE_DAYS = 30;
/** Secondary streams (SpO₂, breathing, skin temperature, dose rate) every 2 min by default; the CGM stays 5-min. */
export const DEFAULT_SECONDARY_EVERY_MIN = 2;
const CGM_EVERY_MIN = 5;

export interface SimulationOptions {
  crew: CrewMemberProfile;
  scenarioId: ScenarioId;
  /** First simulated instant (inclusive) and last (exclusive). */
  from: Date;
  to: Date;
  /** Day 0 of the scenario template (normally the mission start). */
  templateStart: Date;
  seed?: number;
  /** Minutes between secondary-stream samples (SpO₂, breathing rate, dose). 1 = full resolution. */
  secondaryEveryMin?: number;
  /** Force template day (e.g. 29 = "crisis now" in live mode). */
  templateDayOverride?: number;
}

export type SimulatedBatch = Map<DeviceKind, IncomingReading[]>;

/** mulberry32 PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Template daily targets: metric → 30 daily values. */
export function dailyTargets(scenarioId: ScenarioId, crew: CrewMemberProfile): Record<string, number[]> {
  const zones = getCrewAdjustedZones(scenarioId, crew);
  const out: Record<string, number[]> = {};
  for (const readings of Object.values(zones)) {
    for (const r of readings) out[r.metricId] = r.history.map((p) => p.value);
  }
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function simulate(opts: SimulationOptions): SimulatedBatch {
  const rand = rng(hashString(opts.crew.id) ^ (opts.seed ?? 42));
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const targets = dailyTargets(opts.scenarioId, opts.crew);
  const target = (metric: MetricId, day: number) => {
    const series = targets[metric];
    return series ? series[clamp(day, 0, series.length - 1)] : NaN;
  };
  // Days before mission start are on Earth (pre-flight baseline collection, Source: SRC-024, SRC-009):
  // the crew member's recorded pre-flight values, natural background radiation (≈3.1 mSv/yr, Source: SRC-080),
  // no habitat CO₂ monitor or flight exercise device.
  const EARTH: Partial<Record<MetricId, number>> = {
    resting_hr: opts.crew.restingHrBaselineBpm,
    onsd: opts.crew.preFlightOnsdMm,
    rad_dose: 3.1 / 365,
    bmd_delta: 0,
    body_mass_delta: 0,
    hyperopic_shift: 0,
    cabin_co2: NaN,
    ared_load: NaN,
  };
  const targetFor = (metric: MetricId, day: number, earth: boolean) =>
    earth && metric in EARTH ? (EARTH[metric] as number) : target(metric, day);
  const every = Math.max(1, opts.secondaryEveryMin ?? DEFAULT_SECONDARY_EVERY_MIN);
  const out: SimulatedBatch = new Map();
  const push = (kind: DeviceKind, metric: string, ts: number, value: number) => {
    const list = out.get(kind) ?? [];
    list.push({ metric, ts: new Date(ts).toISOString(), value });
    out.set(kind, list);
  };

  const fromMs = Math.floor(opts.from.getTime() / MIN_MS) * MIN_MS;
  const toMs = opts.to.getTime();
  let currentDay = -1;
  let dayPlan: { awakeMinutes: Set<number>; shiftMin: number; tDay: number; progress: number; earth: boolean } | null = null;

  for (let ts = fromMs; ts < toMs; ts += MIN_MS) {
    const dayIndex = Math.floor((ts - opts.templateStart.getTime()) / DAY_MS);
    const tDay = opts.templateDayOverride ?? clamp(dayIndex, 0, TEMPLATE_DAYS - 1);
    const minuteOfDay = Math.floor((ts % DAY_MS) / MIN_MS);

    if (dayIndex !== currentDay) {
      currentDay = dayIndex;
      const earth = dayIndex < 0 && opts.templateDayOverride === undefined;
      const T = (m: MetricId) => targetFor(m, tDay, earth);
      const progress = clamp(dayIndex / (TEMPLATE_DAYS - 1), 0, 1);
      // Circadian drift: up to +2 h later by mission day 30 (Source: SRC-025).
      const shiftMin = Math.round(120 * progress);
      // Sleep efficiency target → number of awake minutes inside the 8 h in-bed window (Source: SRC-023).
      const eff = T('sleep_eff');
      const awakeCount = Math.round((1 - (Number.isFinite(eff) ? eff : 90) / 100) * 480);
      const awakeMinutes = new Set<number>();
      while (awakeMinutes.size < awakeCount) {
        const startBout = Math.floor(rand() * 470);
        const len = 3 + Math.floor(rand() * 12);
        for (let k = 0; k < len && awakeMinutes.size < awakeCount; k++) awakeMinutes.add(startBout + k);
      }
      dayPlan = { awakeMinutes, shiftMin, tDay, progress, earth };

      // Nightly summaries at wake time, 07:00 + shift (ring + actigraph) (Source: SRC-023, SRC-029).
      const wakeTs = Date.UTC(new Date(ts).getUTCFullYear(), new Date(ts).getUTCMonth(), new Date(ts).getUTCDate()) + (420 + shiftMin) * MIN_MS;
      if (wakeTs >= fromMs && wakeTs < toMs) {
        push('smartwatch', 'resting_hr', wakeTs, Math.round(T('resting_hr') + gauss() * 0.8));
        push('smartwatch', 'hrv_rmssd', wakeTs, Math.round(T('hrv_rmssd') + gauss() * 2));
        push('smartwatch', 'sleep_eff', wakeTs, r1(clamp(100 * (1 - awakeCount / 480), 0, 100)));
        // Overnight wrist temperature → body-temperature estimate (Source: SRC-074);
        // body temperature drifts up slightly over the mission (Source: SRC-025).
        const body = T('core_temp') + 0.15 * progress + gauss() * 0.07;
        push('smartwatch', 'core_temp', wakeTs, r2(body));
        push('smartwatch', 'wrist_temp', wakeTs, r2(body - 2.6));
        push('smartwatch', 'daily_sleep_hours', wakeTs, r1(T('daily_sleep_hours') + gauss() * 0.25));
        // Average overnight breathing rate (Source: SRC-074).
        push('smartwatch', 'sleep_resp_rate', wakeTs, r1(T('sleep_resp_rate') + gauss() * 0.3));
      }
      // Daily automatic feeds, watch apps, and periodic exams. CGM streams 5-min glucose below.
      const midnight = wakeTs - (420 + shiftMin) * MIN_MS;
      const daily: Array<[DeviceKind, string, number, number, number]> = [
        ['smartwatch', 'pvt_lapses', 8 * 60 + 30, Math.max(0, Math.round(T('pvt_lapses'))), 1],
        ['smartwatch', 'reaction_time', 8 * 60 + 33, Math.round(T('reaction_time') + gauss() * 8), 1],
        ['smartwatch', 'mood_index', 21 * 60, clamp(Math.round(T('mood_index') + gauss() * 0.5), 1, 10), 1],
        ['smartwatch', 'headache_severity', 21 * 60 + 5, clamp(r1(T('headache_severity') + gauss() * 0.3), 0, 10), 1],
        ['exercise_device', 'vo2_max', 18 * 60 + 15, r1(T('vo2_max') + gauss() * 0.6), 3],
        ['habitat_sensor', 'cabin_co2', 12 * 60, r1(T('cabin_co2') + gauss() * 0.1), 1],
        ['habitat_sensor', 'hydration_intake', 20 * 60, r1(T('hydration_intake') + gauss() * 0.1), 1],
        ['manual', 'caloric_intake', 21 * 60 + 30, Math.round(T('caloric_intake') + gauss() * 40), 1],
        ['exercise_device', 'ared_load', 18 * 60 + 45, r1(T('ared_load') + gauss() * 0.8), 1],
        ['clinical_exam', 'onsd', 9 * 60, r2(T('onsd') + gauss() * 0.03), 3],
        ['clinical_exam', 'iop', 9 * 60 + 5, Math.round(T('iop') + gauss() * 0.5), 3],
        ['clinical_exam', 'wbc_lymph', 9 * 60 + 10, r2(T('wbc_lymph') + gauss() * 0.05), 3],
        ['clinical_exam', 'bmd_delta', 9 * 60 + 15, r2(T('bmd_delta')), 7],
        ['clinical_exam', 'hemoglobin', 9 * 60 + 20, r1(T('hemoglobin') + gauss() * 0.15), 3],
        ['clinical_exam', 'crp', 9 * 60 + 22, r1(Math.max(0, T('crp') + gauss() * 0.3)), 3],
        ['clinical_exam', 'cortisol', 7 * 60 + 30 + shiftMin, r1(Math.max(0.5, T('cortisol') + gauss() * 0.8)), 3],
        ['clinical_exam', 'urine_sg', 7 * 60 + 40 + shiftMin, Math.round((T('urine_sg') + gauss() * 0.0015) * 1000) / 1000, 1],
        ['clinical_exam', 'grip_strength', 9 * 60 + 30, r1(T('grip_strength') + gauss() * 1), 3],
        ['clinical_exam', 'body_mass_delta', 7 * 60 + 45 + shiftMin, r1(T('body_mass_delta') + gauss() * 0.1), 1],
        ['clinical_exam', 'hyperopic_shift', 9 * 60 + 40, r2(T('hyperopic_shift') + gauss() * 0.03), 7],
      ];
      const isLastDay = midnight + DAY_MS >= toMs;
      for (const [kind, metric, minute, value, everyDays] of daily) {
        const at = midnight + minute * MIN_MS;
        if (!Number.isFinite(value) || at < fromMs || at >= toMs) continue;
        const cadence = earth && kind === 'clinical_exam' ? 7 : everyDays; // pre-flight exams are weekly
        if (dayIndex % cadence === 0 || isLastDay) push(kind, metric, at, value);
      }
    }
    const plan = dayPlan!;

    // Shifted local "body clock" minute; in bed 23:00–07:00 (+shift).
    const bodyMinute = (minuteOfDay - plan.shiftMin + 1440) % 1440;
    const inBedMinute = (bodyMinute - 23 * 60 + 1440) % 1440; // 0..479 while in bed
    const inBed = inBedMinute < 480;
    const asleep = inBed && !plan.awakeMinutes.has(inBedMinute);
    const exercising = (bodyMinute >= 600 && bodyMinute < 645) || (bodyMinute >= 1020 && bodyMinute < 1065);
    const hourAngle = (2 * Math.PI * bodyMinute) / 1440;

    const resting = targetFor('resting_hr', plan.tDay, plan.earth);
    let hr = asleep
      ? resting - 2 + gauss() * 1.5
      : resting + 12 + 4 * Math.sin(hourAngle - Math.PI / 2) + gauss() * 3;
    if (exercising) hr = resting + 55 + gauss() * 6;
    if (rand() < 0.001) hr *= 1.6; // contact/motion artifact, flagged by normalization
    push('smartwatch', 'heart_rate', ts, Math.round(clamp(hr, 30, 210)));

    const activity = asleep ? 0.02 + rand() * 0.02 : exercising ? 1.2 + gauss() * 0.25 : 0.15 + rand() * 0.1;
    push('smartwatch', 'activity', ts, r2(Math.max(0, activity)));
    push('smartwatch', 'sleep_state', ts, asleep ? 1 : 0);

    if (minuteOfDay % every === 0) {
      const spo2 = targetFor('spo2', plan.tDay, plan.earth) - (asleep ? 0.4 : 0) + gauss() * 0.5;
      push('smartwatch', 'spo2', ts, r1(clamp(spo2, 80, 100)));
      push('smartwatch', 'resp_rate', ts, r1(asleep ? 13 + gauss() : exercising ? 28 + gauss() * 3 : 16 + gauss() * 1.5));
      // Dose rate (µGy/h) from the daily mSv target, ±8 % (Source: SRC-026).
      const dose = (targetFor('rad_dose', plan.tDay, plan.earth) * 1000) / 24;
      push('dosimeter', 'dose_rate', ts, r1(Math.max(0, dose * (1 + gauss() * 0.08))));
      // Skin temperature from the watch, a little lower than core and warmer when exercising (Source: SRC-021).
      push('smartwatch', 'skin_temp', ts, r2(clamp(targetFor('core_temp', plan.tDay, plan.earth) - 2.9 + (exercising ? 0.9 : 0) + (asleep ? -0.2 : 0) + gauss() * 0.1, 25, 42)));
    }
    if (minuteOfDay % CGM_EVERY_MIN === 0) {
      // CGM 5-minute interstitial glucose stream with postprandial peaks and exercise dips (Source: SRC-028, SRC-072, SRC-073).
      const baseGlucose = targetFor('blood_glucose', plan.tDay, plan.earth);
      if (Number.isFinite(baseGlucose)) {
        const mealPeak =
          32 * Math.exp(-((bodyMinute - 485) ** 2) / (2 * 38 * 38)) +
          34 * Math.exp(-((bodyMinute - 785) ** 2) / (2 * 42 * 42)) +
          30 * Math.exp(-((bodyMinute - 1175) ** 2) / (2 * 45 * 45));
        const exerciseDip = exercising ? -10 : 0;
        const cgmGlucose = clamp(Math.round(baseGlucose + mealPeak + exerciseDip + gauss() * 2.5), 40, 400);
        push('cgm', 'blood_glucose', ts, cgmGlucose);
      }
    }
    // Watch blood pressure: spot readings morning, afternoon, evening while seated (Source: SRC-075).
    if (bodyMinute === 8 * 60 || bodyMinute === 14 * 60 || bodyMinute === 20 * 60) {
      const sys = targetFor('systolic_bp', plan.tDay, plan.earth) + gauss() * 4;
      push('smartwatch', 'systolic_bp', ts, Math.round(sys));
      push('smartwatch', 'diastolic_bp', ts, Math.round(targetFor('diastolic_bp', plan.tDay, plan.earth) + gauss() * 3));
    }
  }
  return out;
}
