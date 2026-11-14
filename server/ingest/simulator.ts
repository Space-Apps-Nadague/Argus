/**
 * ARGUS — Assumed sensor kit simulator (specs/05-data-platform.md §4)
 *
 * Generates minute-level wearable data per astronaut whose DAILY values follow the scenario template
 * (`getCrewAdjustedZones`), so the database-backed HUD tells the same story as the offline demo, while
 * the minute data is realistic enough for baselines and anomaly detection.
 *
 * Built-in spaceflight effects (cited):
 * - Smart-shirt vitals at 1 Hz on device, uploaded as 1-min values (Source: SRC-020, SRC-021)
 * - Actigraphy sleep/wake and nightly sleep efficiency (Source: SRC-023)
 * - Core body temperature rises over the mission and the circadian rhythm drifts ~2 h later (Source: SRC-025)
 * - Nightly HRV and resting HR from a ring (Source: SRC-029)
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

export interface SimulationOptions {
  crew: CrewMemberProfile;
  scenarioId: ScenarioId;
  /** First simulated instant (inclusive) and last (exclusive). */
  from: Date;
  to: Date;
  /** Day 0 of the scenario template (normally the mission start). */
  templateStart: Date;
  seed?: number;
  /** Minutes between secondary-stream samples (resp, skin/core temp, SpO₂, dose). 1 = full resolution. */
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
  const every = Math.max(1, opts.secondaryEveryMin ?? 5);
  const out: SimulatedBatch = new Map();
  const push = (kind: DeviceKind, metric: string, ts: number, value: number) => {
    const list = out.get(kind) ?? [];
    list.push({ metric, ts: new Date(ts).toISOString(), value });
    out.set(kind, list);
  };

  const fromMs = Math.floor(opts.from.getTime() / MIN_MS) * MIN_MS;
  const toMs = opts.to.getTime();
  let currentDay = -1;
  let dayPlan: { awakeMinutes: Set<number>; shiftMin: number; tDay: number; progress: number } | null = null;

  for (let ts = fromMs; ts < toMs; ts += MIN_MS) {
    const dayIndex = Math.floor((ts - opts.templateStart.getTime()) / DAY_MS);
    const tDay = opts.templateDayOverride ?? clamp(dayIndex, 0, TEMPLATE_DAYS - 1);
    const minuteOfDay = Math.floor((ts % DAY_MS) / MIN_MS);

    if (dayIndex !== currentDay) {
      currentDay = dayIndex;
      const progress = clamp(dayIndex / (TEMPLATE_DAYS - 1), 0, 1);
      // Circadian drift: up to +2 h later by mission day 30 (Source: SRC-025).
      const shiftMin = Math.round(120 * progress);
      // Sleep efficiency target → number of awake minutes inside the 8 h in-bed window (Source: SRC-023).
      const eff = target('sleep_eff', tDay);
      const awakeCount = Math.round((1 - (Number.isFinite(eff) ? eff : 90) / 100) * 480);
      const awakeMinutes = new Set<number>();
      while (awakeMinutes.size < awakeCount) {
        const startBout = Math.floor(rand() * 470);
        const len = 3 + Math.floor(rand() * 12);
        for (let k = 0; k < len && awakeMinutes.size < awakeCount; k++) awakeMinutes.add(startBout + k);
      }
      dayPlan = { awakeMinutes, shiftMin, tDay, progress };

      // Nightly summaries at wake time, 07:00 + shift (ring + actigraph) (Source: SRC-023, SRC-029).
      const wakeTs = Date.UTC(new Date(ts).getUTCFullYear(), new Date(ts).getUTCMonth(), new Date(ts).getUTCDate()) + (420 + shiftMin) * MIN_MS;
      if (wakeTs >= fromMs && wakeTs < toMs) {
        push('ring', 'resting_hr', wakeTs, Math.round(target('resting_hr', tDay) + gauss() * 0.8));
        push('ring', 'hrv_rmssd', wakeTs, Math.round(target('hrv_rmssd', tDay) + gauss() * 2));
        push('wrist_actigraph', 'sleep_eff', wakeTs, r1(clamp(100 * (1 - awakeCount / 480), 0, 100)));
      }
      // Daily manual entries and periodic clinical exams on the crew tablet.
      const midnight = wakeTs - (420 + shiftMin) * MIN_MS;
      const manual: Array<[string, number, number, number]> = [
        ['pvt_lapses', 8 * 60 + 30, Math.max(0, Math.round(target('pvt_lapses', tDay))), 1],
        ['cabin_co2', 12 * 60, r1(target('cabin_co2', tDay) + gauss() * 0.1), 1],
        ['ared_load', 18 * 60 + 45, r1(target('ared_load', tDay) + gauss() * 0.8), 1],
        ['onsd', 9 * 60, r2(target('onsd', tDay) + gauss() * 0.03), 3],
        ['iop', 9 * 60 + 5, Math.round(target('iop', tDay) + gauss() * 0.5), 3],
        ['wbc_lymph', 9 * 60 + 10, r2(target('wbc_lymph', tDay) + gauss() * 0.05), 3],
        ['bmd_delta', 9 * 60 + 15, r2(target('bmd_delta', tDay)), 7],
      ];
      const isLastDay = midnight + DAY_MS >= toMs;
      for (const [metric, minute, value, everyDays] of manual) {
        const at = midnight + minute * MIN_MS;
        if (!Number.isFinite(value) || at < fromMs || at >= toMs) continue;
        if (dayIndex % everyDays === 0 || isLastDay) push('manual', metric, at, value);
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

    const resting = target('resting_hr', plan.tDay);
    let hr = asleep
      ? resting - 2 + gauss() * 1.5
      : resting + 12 + 4 * Math.sin(hourAngle - Math.PI / 2) + gauss() * 3;
    if (exercising) hr = resting + 55 + gauss() * 6;
    if (rand() < 0.001) hr *= 1.6; // contact/motion artifact, flagged by normalization
    push('smart_shirt', 'heart_rate', ts, Math.round(clamp(hr, 30, 210)));

    const activity = asleep ? 0.02 + rand() * 0.02 : exercising ? 1.2 + gauss() * 0.25 : 0.15 + rand() * 0.1;
    push('wrist_actigraph', 'activity', ts, r2(Math.max(0, activity)));
    push('wrist_actigraph', 'sleep_state', ts, asleep ? 1 : 0);

    if (minuteOfDay % every === 0) {
      const spo2 = target('spo2', plan.tDay) - (asleep ? 0.4 : 0) + gauss() * 0.5;
      push('smart_shirt', 'spo2', ts, r1(clamp(spo2, 80, 100)));
      push('smart_shirt', 'resp_rate', ts, r1(asleep ? 13 + gauss() : exercising ? 28 + gauss() * 3 : 16 + gauss() * 1.5));
      push('smart_shirt', 'skin_temp', ts, r1(33.4 + 0.6 * Math.sin(hourAngle - Math.PI / 2) + (exercising ? 0.8 : 0) + gauss() * 0.15));
      // Core temp: circadian ±0.35 °C, +0.4 °C rise over the mission, exercise +0.6 °C (Source: SRC-025).
      const core = 36.8 + 0.35 * Math.sin(hourAngle - (17 / 24) * 2 * Math.PI + Math.PI / 2) + 0.4 * plan.progress + (exercising ? 0.6 : 0) + gauss() * 0.06;
      push('core_temp_patch', 'core_temp', ts, r2(core));
      // Dose rate (µGy/h) from the daily mSv target, ±8 % (Source: SRC-026).
      const dose = (target('rad_dose', plan.tDay) * 1000) / 24;
      push('dosimeter', 'dose_rate', ts, r1(Math.max(0, dose * (1 + gauss() * 0.08))));
    }
    if (!asleep && bodyMinute % 30 === 0) {
      push('bp_cuff', 'bp_sys', ts, Math.round(114 + (resting - 61) * 0.5 + (exercising ? 25 : 0) + gauss() * 5));
      push('bp_cuff', 'bp_dia', ts, Math.round(74 + gauss() * 4));
    }
  }
  return out;
}
