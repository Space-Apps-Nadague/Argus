/**
 * ARGUS — Deterministic Triage Engine & 0g Threshold Evaluator
 * Single Source of Truth: specs/01-data-schema.md (§2–§3)
 *
 * Architectural Rule (AGENTS.md):
 * Keep Green/Yellow/Red threshold evaluation 100% deterministic in TypeScript.
 * Never delegate threshold classification to an LLM.
 */

import { commDelayForEnvironment } from '../data/spaceLocations';
import {
  BodyZoneId,
  GravityEnvironment,
  MetricId,
  ThresholdRange,
  TriageStatus,
  VitalSignReading,
} from '../types/argus';

export const DEFAULT_ENVIRONMENT: GravityEnvironment = '0g_transit';

export const STATUS_COLORS: Record<TriageStatus, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};

export const STATUS_LABELS: Record<TriageStatus, string> = {
  green: 'NOMINAL',
  yellow: 'ELEVATED DRIFT',
  red: 'CRITICAL ALERT',
};

export const ENVIRONMENT_META: Record<
  GravityEnvironment,
  {
    label: string;
    shortLabel: string;
    gravityG: string;
    readonly commDelay: string;
    missionPhase: string;
    hazardOverview: string;
  }
> = {
  'iss_leo': {
    label: 'ISS Low Earth Orbit',
    shortLabel: 'ISS (LEO)',
    gravityG: '0.00g',
    get commDelay() {
      return `${commDelayForEnvironment('iss_leo')} ONE-WAY`;
    },
    missionPhase: 'EXPEDITION 72 // LEO STATION OPS',
    hazardOverview:
      'Microgravity produces cephalad fluid shifts without terrestrial hydrostatic pressure; partial geomagnetic shielding reduces radiation, with real-time ground tele-medical support.',
  },
  'lunar_base': {
    label: 'Artemis Lunar Base (1/6g)',
    shortLabel: 'Lunar Base',
    gravityG: '0.16g',
    get commDelay() {
      return `${commDelayForEnvironment('lunar_base')} ONE-WAY`;
    },
    missionPhase: 'ARTEMIS BASE CAMP // SHACKLETON RIM',
    hazardOverview:
      'Partial lunar gravity (1/6g) reduces cephalad venous pooling and preserves partial skeletal load; abrasive surface regolith and high SPE radiation present operational challenges.',
  },
  '0g_transit': {
    label: '0g Deep-Space Transit',
    shortLabel: '0g Transit',
    gravityG: '0.00g',
    get commDelay() {
      return `${commDelayForEnvironment('0g_transit')} ONE-WAY`;
    },
    missionPhase: 'TRANS-MARS CRUISE // SOL 142',
    hazardOverview:
      'Microgravity induces cephalad fluid shift toward the head, increasing intracranial & optic nerve sheath pressure (SANS), accelerating bone mineral loss, and requiring closed-loop CO₂ scrubbing.',
  },
  'mars_base': {
    label: 'Mars Surface Base (3/8g)',
    shortLabel: 'Mars Base',
    gravityG: '0.38g',
    get commDelay() {
      return `${commDelayForEnvironment('mars_base')} ONE-WAY`;
    },
    missionPhase: 'JEZERO CRATER HABITAT // SOL 204',
    hazardOverview:
      'Partial Martian gravity (3/8g) mitigates SANS risk and provides axial loading; substantial comm latency requires autonomous crew health surveillance and delayed tele-consultation.',
  },
  'earth_1g': {
    label: 'Earth Surface (1.00g)',
    shortLabel: 'Earth (1.00g)',
    gravityG: '1.00g',
    get commDelay() {
      return `${commDelayForEnvironment('earth_1g')} ONE-WAY`;
    },
    missionPhase: 'PRE/POST-FLIGHT BASELINE // TERRESTRIAL',
    hazardOverview:
      'Terrestrial 1.00g gravity provides normal hydrostatic pressure gradients and musculoskeletal loading, eliminating cephalad fluid shifts and microgravity bone deconditioning.',
  },
};

export const ENVIRONMENT_ORDER: GravityEnvironment[] = [
  'iss_leo',
  'lunar_base',
  '0g_transit',
  'mars_base',
  'earth_1g',
];

/**
 * Baseline 0g microgravity threshold lookup table matching specs/01-data-schema.md §2
 */
export const METRIC_THRESHOLDS_0G: Record<string, ThresholdRange> = {
  onsd: { nominalMin: 4.5, nominalMax: 5.5, yellowMin: 4.2, yellowMax: 5.9 },
  iop: { nominalMin: 11, nominalMax: 18, yellowMin: 9, yellowMax: 21 },
  cabin_co2: { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.0, yellowMax: 4.5 },
  resting_hr: { nominalMin: 52, nominalMax: 74, yellowMin: 46, yellowMax: 86 },
  hrv_rmssd: { nominalMin: 42, nominalMax: 85, yellowMin: 30, yellowMax: 95 },
  spo2: { nominalMin: 96, nominalMax: 100, yellowMin: 93, yellowMax: 100 },
  // Team bands (PR #20). Clinical reference: AHA categories and hypotension <90/60 (Source: SRC-070, SRC-071).
  systolic_bp: { nominalMin: 100, nominalMax: 130, yellowMin: 90, yellowMax: 140 },
  // NASA-STD-3001 Vol 2 Rev D baseline 2.5 L/day potable water & rehydration (Source: SRC-081, SRC-082).
  hydration_intake: { nominalMin: 2.5, nominalMax: 3.8, yellowMin: 2.0, yellowMax: 4.5 },
  bmd_delta: { nominalMin: -0.8, nominalMax: 0.2, yellowMin: -1.3, yellowMax: 0.5 },
  ared_load: { nominalMin: 18, nominalMax: 30, yellowMin: 12, yellowMax: 35 },
  // Team bands (PR #20). Clinical reference: ADA fasting ranges and hypoglycemia levels (Source: SRC-072, SRC-073).
  blood_glucose: { nominalMin: 70, nominalMax: 110, yellowMin: 60, yellowMax: 140 },
  // NASA-STD-3001 Vol 2 Rev D EER caloric intake with ARED countermeasures (Source: SRC-081, SRC-082).
  caloric_intake: { nominalMin: 2200, nominalMax: 3200, yellowMin: 1800, yellowMax: 3600 },
  rad_dose: { nominalMin: 0.4, nominalMax: 1.2, yellowMin: 0.0, yellowMax: 2.5 },
  wbc_lymph: { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.2, yellowMax: 4.0 },
  // Body temperature. With the watch-only kit it is estimated from overnight wrist temperature (Source: SRC-074).
  core_temp: { nominalMin: 36.5, nominalMax: 37.5, yellowMin: 36.0, yellowMax: 38.0 },
  sleep_eff: { nominalMin: 82, nominalMax: 96, yellowMin: 72, yellowMax: 100 },
  pvt_lapses: { nominalMin: 0, nominalMax: 2, yellowMin: 0, yellowMax: 4 },
  daily_sleep_hours: { nominalMin: 7.0, nominalMax: 9.0, yellowMin: 6.0, yellowMax: 10.0 },
  mood_index: { nominalMin: 7.0, nominalMax: 10.0, yellowMin: 5.0, yellowMax: 10.0 },
  // Extended panel (mock-data expansion). Clinical references: AHA diastolic categories, normal adult respiratory
  // rate, ACSM VO2max norms, WHO hemoglobin cut-offs, urine specific gravity hydration bands, NASA "space anemia"
  // (Source: SRC-009, SRC-029, SRC-081).
  diastolic_bp: { nominalMin: 60, nominalMax: 85, yellowMin: 55, yellowMax: 90 },
  sleep_resp_rate: { nominalMin: 12, nominalMax: 18, yellowMin: 10, yellowMax: 22 },
  vo2_max: { nominalMin: 38, nominalMax: 60, yellowMin: 32, yellowMax: 70 },
  hemoglobin: { nominalMin: 12.5, nominalMax: 17.0, yellowMin: 11.5, yellowMax: 18.0 },
  urine_sg: { nominalMin: 1.005, nominalMax: 1.025, yellowMin: 1.002, yellowMax: 1.030 },
  grip_strength: { nominalMin: 35, nominalMax: 60, yellowMin: 28, yellowMax: 68 },
  body_mass_delta: { nominalMin: -3.0, nominalMax: 1.0, yellowMin: -5.0, yellowMax: 2.0 },
  crp: { nominalMin: 0, nominalMax: 3, yellowMin: 0, yellowMax: 10 },
  cortisol: { nominalMin: 6, nominalMax: 18, yellowMin: 3, yellowMax: 23 },
  reaction_time: { nominalMin: 200, nominalMax: 300, yellowMin: 180, yellowMax: 360 },
  headache_severity: { nominalMin: 0, nominalMax: 2, yellowMin: 0, yellowMax: 4 },
  hyperopic_shift: { nominalMin: -0.25, nominalMax: 0.5, yellowMin: -0.5, yellowMax: 1.0 },
  // Source: SRC-109 (Teixeira et al. 2013 local vocal jitter < 1.04% normal clinical cutoff)
  vocal_jitter: { nominalMin: 0.2, nominalMax: 1.04, yellowMin: 0.0, yellowMax: 1.8 },
};

export const METRIC_THRESHOLDS = METRIC_THRESHOLDS_0G;

/**
 * Gravity- and location-adjusted thresholds matching specs/01-data-schema.md §2
 */
export const ENVIRONMENT_METRIC_THRESHOLDS: Record<
  GravityEnvironment,
  Record<string, ThresholdRange>
> = {
  '0g_transit': METRIC_THRESHOLDS_0G,
  'iss_leo': {
    ...METRIC_THRESHOLDS_0G,
    rad_dose: { nominalMin: 0.2, nominalMax: 0.6, yellowMin: 0.0, yellowMax: 1.2 },
    cabin_co2: { nominalMin: 1.2, nominalMax: 3.0, yellowMin: 0.8, yellowMax: 4.0 },
  },
  'lunar_base': {
    ...METRIC_THRESHOLDS_0G,
    onsd: { nominalMin: 4.3, nominalMax: 5.3, yellowMin: 4.0, yellowMax: 5.7 },
    iop: { nominalMin: 11, nominalMax: 19, yellowMin: 9, yellowMax: 21 },
    cabin_co2: { nominalMin: 1.2, nominalMax: 3.2, yellowMin: 0.8, yellowMax: 4.2 },
    resting_hr: { nominalMin: 54, nominalMax: 76, yellowMin: 48, yellowMax: 88 },
    systolic_bp: { nominalMin: 105, nominalMax: 135, yellowMin: 95, yellowMax: 145 },
    bmd_delta: { nominalMin: -0.6, nominalMax: 0.2, yellowMin: -1.0, yellowMax: 0.5 },
    ared_load: { nominalMin: 14, nominalMax: 26, yellowMin: 10, yellowMax: 30 },
    // Surface EVA ops (+200 kcal/hr, 0.24 L/hr) increase caloric and hydration requirements (Source: SRC-081).
    caloric_intake: { nominalMin: 2400, nominalMax: 3400, yellowMin: 2000, yellowMax: 3800 },
    hydration_intake: { nominalMin: 2.7, nominalMax: 4.0, yellowMin: 2.2, yellowMax: 4.8 },
    rad_dose: { nominalMin: 0.3, nominalMax: 0.9, yellowMin: 0.0, yellowMax: 2.0 },
  },
  'mars_base': {
    ...METRIC_THRESHOLDS_0G,
    onsd: { nominalMin: 4.1, nominalMax: 5.1, yellowMin: 3.8, yellowMax: 5.5 },
    iop: { nominalMin: 12, nominalMax: 20, yellowMin: 10, yellowMax: 22 },
    cabin_co2: { nominalMin: 1.2, nominalMax: 3.0, yellowMin: 0.8, yellowMax: 4.0 },
    resting_hr: { nominalMin: 55, nominalMax: 78, yellowMin: 50, yellowMax: 90 },
    systolic_bp: { nominalMin: 110, nominalMax: 135, yellowMin: 95, yellowMax: 145 },
    bmd_delta: { nominalMin: -0.4, nominalMax: 0.3, yellowMin: -0.8, yellowMax: 0.6 },
    ared_load: { nominalMin: 12, nominalMax: 24, yellowMin: 8, yellowMax: 28 },
    caloric_intake: { nominalMin: 2400, nominalMax: 3400, yellowMin: 2000, yellowMax: 3800 },
    hydration_intake: { nominalMin: 2.7, nominalMax: 4.0, yellowMin: 2.2, yellowMax: 4.8 },
    rad_dose: { nominalMin: 0.3, nominalMax: 0.8, yellowMin: 0.0, yellowMax: 1.8 },
  },
  // Grounding: NASA LSAH (Source: SRC-006) and Spaceflight Standard Measures (Source: SRC-009) terrestrial clinical baseline.
  'earth_1g': {
    ...METRIC_THRESHOLDS_0G,
    onsd: { nominalMin: 4.0, nominalMax: 5.0, yellowMin: 3.8, yellowMax: 5.3 },
    iop: { nominalMin: 12, nominalMax: 20, yellowMin: 10, yellowMax: 22 },
    cabin_co2: { nominalMin: 0.0, nominalMax: 1.0, yellowMin: 0.0, yellowMax: 2.0 },
    resting_hr: { nominalMin: 55, nominalMax: 80, yellowMin: 50, yellowMax: 90 },
    bmd_delta: { nominalMin: -0.2, nominalMax: 0.2, yellowMin: -0.5, yellowMax: 0.5 },
    ared_load: { nominalMin: 0, nominalMax: 16, yellowMin: 0, yellowMax: 24 },
    caloric_intake: { nominalMin: 2000, nominalMax: 3000, yellowMin: 1600, yellowMax: 3400 },
    hydration_intake: { nominalMin: 2.2, nominalMax: 3.5, yellowMin: 1.8, yellowMax: 4.2 },
    rad_dose: { nominalMin: 0.0, nominalMax: 0.05, yellowMin: 0.0, yellowMax: 0.1 },
  },
};

/**
 * Minimum day-to-day SD per metric used by personal-baseline drift
 * (specs/01-data-schema.md §2 & §5). Never affects triage status.
 */
export const METRIC_TYPICAL_SD: Record<MetricId, number> = {
  onsd: 0.1,
  iop: 1.0,
  cabin_co2: 0.3,
  resting_hr: 3,
  hrv_rmssd: 6,
  spo2: 0.7,
  systolic_bp: 4,
  hydration_intake: 0.25,
  bmd_delta: 0.15,
  ared_load: 2.5,
  blood_glucose: 5,
  caloric_intake: 180,
  rad_dose: 0.15,
  wbc_lymph: 0.2,
  core_temp: 0.15,
  sleep_eff: 3,
  pvt_lapses: 0.8,
  daily_sleep_hours: 0.5,
  mood_index: 0.5,
  diastolic_bp: 3,
  sleep_resp_rate: 0.8,
  vo2_max: 1.5,
  hemoglobin: 0.4,
  urine_sg: 0.003,
  grip_strength: 2,
  body_mass_delta: 0.4,
  crp: 0.8,
  cortisol: 2,
  reaction_time: 15,
  headache_severity: 0.7,
  hyperopic_shift: 0.1,
  vocal_jitter: 0.15,
};

export interface MetricInputRange {
  min: number;
  max: number;
  how: string;
}

/**
 * Hard physiological limits + measurement instructions (specs/01-data-schema.md §2 & §6).
 * The limits are survivable extremes: values inside can be deadly but are possible
 * (e.g. 42 °C in heat stroke). Anything outside is physically impossible for a living
 * person (e.g. 50 °C), so it is treated as a typo or sensor fault and dropped from
 * every data path (check-ins, voice, server ingest, demo/mock series).
 * Life-threatening cut-offs live in `src/utils/vitalLimits.ts`. Never affects triage status.
 */
export const METRIC_INPUT_RANGES: Record<MetricId, MetricInputRange> = {
  onsd: { min: 2.0, max: 10.0, how: 'Ocular ultrasound, transverse plane, 3 mm behind globe; average both eyes.' },
  iop: { min: 0, max: 80, how: 'Rebound tonometer, seated, average of 3 readings per eye.' },
  cabin_co2: { min: 0, max: 76, how: 'Read the nearest cabin CO₂ monitor (CDM) at crew head height.' },
  resting_hr: { min: 20, max: 250, how: 'On waking, before moving: wearable or 30 s pulse count × 2.' },
  hrv_rmssd: { min: 1, max: 300, how: 'Overnight RMSSD from your wearable.' },
  spo2: { min: 40, max: 100, how: 'Finger oximeter, warm hand, still for 30 s.' },
  systolic_bp: { min: 40, max: 300, how: 'Automatic: watch blood-pressure spot readings, seated (watch calibrated with a cuff every 28 days).' },
  hydration_intake: { min: 0.3, max: 8.0, how: 'Cumulative potable water & rehydration fluid dispenser log (L/day).' },
  bmd_delta: { min: -10, max: 5, how: 'Monthly QCT/DXA-equivalent scan result vs previous scan (%).' },
  ared_load: { min: 0, max: 60, how: 'Total from the ARED/resistance device log for today.' },
  blood_glucose: { min: 10, max: 2000, how: 'Weekly fasting finger-prick on the glucometer, then a photo of the meter screen.' },
  caloric_intake: { min: 500, max: 6000, how: 'Total daily food & beverage energy from the crew nutrition log (kcal/day).' },
  rad_dose: { min: 0, max: 20000, how: 'Personal dosimeter: last 24 h reading.' },
  wbc_lymph: { min: 0, max: 100, how: 'Point-of-care blood analyzer, finger-prick sample.' },
  core_temp: { min: 20.0, max: 46.5, how: 'Automatic: estimated from overnight watch wrist temperature vs your baseline.' },
  sleep_eff: { min: 0, max: 100, how: 'Wearable sleep efficiency for last night (%).' },
  pvt_lapses: { min: 0, max: 50, how: '3-minute Psychomotor Vigilance Test on the watch.' },
  daily_sleep_hours: { min: 0, max: 24, how: 'Automatic: sleep duration from the watch.' },
  mood_index: { min: 1, max: 10, how: 'One tap on the watch each evening (1 = lowest, 10 = optimal).' },
  diastolic_bp: { min: 30, max: 150, how: 'Automatic: watch blood-pressure spot readings, seated (diastolic).' },
  sleep_resp_rate: { min: 4, max: 40, how: 'Automatic: average breathing rate during last night\'s sleep from the watch.' },
  vo2_max: { min: 15, max: 90, how: 'Estimated from the cycle ergometer sub-maximal test (mL/kg/min).' },
  hemoglobin: { min: 6, max: 22, how: 'Point-of-care blood analyzer, finger-prick sample (g/dL).' },
  urine_sg: { min: 1.0, max: 1.05, how: 'Urine refractometer / test strip, first void of the day.' },
  grip_strength: { min: 5, max: 100, how: 'Hand dynamometer, dominant hand, best of 3 (kg).' },
  body_mass_delta: { min: -15, max: 10, how: 'Calibrated body-mass device reading vs pre-flight mass (%).' },
  crp: { min: 0, max: 100, how: 'High-sensitivity C-reactive protein on the blood analyzer (mg/L).' },
  cortisol: { min: 0.5, max: 60, how: 'Morning salivary cortisol strip, within 30 min of waking (µg/dL).' },
  reaction_time: { min: 100, max: 1000, how: 'Mean reaction time from the 3-minute Psychomotor Vigilance Test on the watch (ms).' },
  headache_severity: { min: 0, max: 10, how: 'One tap on the watch each evening (0 = none, 10 = worst).' },
  hyperopic_shift: { min: -3, max: 4, how: 'Digital near-vision acuity check vs pre-flight prescription (diopters).' },
  vocal_jitter: { min: 0, max: 10, how: 'Short sustained vowel or voice check-in on the Console mic (%).' },
};

export const METRIC_IDS = Object.keys(METRIC_TYPICAL_SD) as MetricId[];

export function isMetricId(id: string): id is MetricId {
  return Object.prototype.hasOwnProperty.call(METRIC_TYPICAL_SD, id);
}

export function getMetricThreshold(
  metricId: string,
  environment: GravityEnvironment = DEFAULT_ENVIRONMENT
): ThresholdRange {
  const envTable =
    ENVIRONMENT_METRIC_THRESHOLDS[environment] ??
    ENVIRONMENT_METRIC_THRESHOLDS[DEFAULT_ENVIRONMENT];
  return (
    envTable[metricId] ??
    METRIC_THRESHOLDS[metricId] ?? {
      nominalMin: 0,
      nominalMax: 100,
      yellowMin: 0,
      yellowMax: 120,
    }
  );
}

export function formatFlightNormBadge(
  metricId: string,
  unit: string,
  environment: GravityEnvironment = DEFAULT_ENVIRONMENT
): string {
  const range = getMetricThreshold(metricId, environment);
  const meta = ENVIRONMENT_META[environment] ?? ENVIRONMENT_META[DEFAULT_ENVIRONMENT];
  return `${meta.shortLabel} Norm: ${range.nominalMin}–${range.nominalMax} ${unit}`;
}

/**
 * Deterministically evaluates a single metric reading against gravity-specific thresholds.
 */
export function evaluateMetricStatus(
  metricId: string,
  value: number,
  environment: GravityEnvironment
): TriageStatus {
  const range = getMetricThreshold(metricId, environment);
  if (value >= range.nominalMin && value <= range.nominalMax) {
    return 'green';
  }
  if (value >= range.yellowMin && value <= range.yellowMax) {
    return 'yellow';
  }
  return 'red';
}

const SEVERITY_RANK: Record<TriageStatus, number> = {
  green: 0,
  yellow: 1,
  red: 2,
};

/**
 * Deterministically computes the overall TriageStatus for a single body zone.
 */
export function evaluateZoneStatus(
  readings: VitalSignReading[],
  environment: GravityEnvironment
): TriageStatus {
  let worst: TriageStatus = 'green';
  for (const r of readings) {
    const status = evaluateMetricStatus(r.metricId, r.currentValue, environment);
    if (SEVERITY_RANK[status] > SEVERITY_RANK[worst]) {
      worst = status;
    }
  }
  return worst;
}

/**
 * Deterministically computes the TriageStatus map for all 6 anatomical zones.
 */
export function evaluateAllZones(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  environment: GravityEnvironment
): Record<BodyZoneId, TriageStatus> {
  return {
    neuro: evaluateZoneStatus(zones.neuro, environment),
    cardio: evaluateZoneStatus(zones.cardio, environment),
    musculo: evaluateZoneStatus(zones.musculo, environment),
    metabolic: evaluateZoneStatus(zones.metabolic, environment),
    immune: evaluateZoneStatus(zones.immune, environment),
    behavioral: evaluateZoneStatus(zones.behavioral, environment),
  };
}

/**
 * Deterministic Crew Readiness Score (0–100%) per specs/01-data-schema.md §3:
 * - Base score: 98%
 * - Each metric in 'yellow' deducts 3%
 * - Each metric in 'red' deducts 8%
 * - Each completed countermeasure step adds +3% (capped at 100%, min 15%)
 */
/** Number of triage metrics the readiness penalties were originally calibrated for. */
const READINESS_REFERENCE_PANEL = 19;

export function calculateCrewReadinessScore(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  environment: GravityEnvironment,
  completedStepsCount: number = 0
): number {
  let score = 98;
  const allReadings = Object.values(zones).flat();
  // Penalties are scaled so a larger telemetry panel (31 metrics) cannot push the score lower than the
  // original 19-metric panel would for the same share of out-of-band metrics.
  const weight = allReadings.length > READINESS_REFERENCE_PANEL ? READINESS_REFERENCE_PANEL / allReadings.length : 1;

  for (const reading of allReadings) {
    const status = evaluateMetricStatus(
      reading.metricId,
      reading.currentValue,
      environment
    );
    if (status === 'yellow') {
      score -= 3 * weight;
    } else if (status === 'red') {
      score -= 8 * weight;
    }
  }

  score += completedStepsCount * 3;
  return Math.max(15, Math.min(100, Math.round(score)));
}
