/**
 * ARGUS — Deterministic Triage Engine & 0g Threshold Evaluator
 * Single Source of Truth: specs/01-data-schema.md (§2–§3)
 *
 * Architectural Rule (AGENTS.md):
 * Keep Green/Yellow/Red threshold evaluation 100% deterministic in TypeScript.
 * Never delegate threshold classification to an LLM.
 */

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
    commDelay: string;
    missionPhase: string;
    hazardOverview: string;
  }
> = {
  'iss_leo': {
    label: 'ISS Low Earth Orbit',
    shortLabel: 'ISS (LEO)',
    gravityG: '0.00g',
    commDelay: 'Real-time ONE-WAY',
    missionPhase: 'EXPEDITION 72 // LEO STATION OPS',
    hazardOverview:
      'Microgravity produces cephalad fluid shifts without terrestrial hydrostatic pressure; partial geomagnetic shielding reduces radiation, with real-time ground tele-medical support.',
  },
  'lunar_base': {
    label: 'Artemis Lunar Base (1/6g)',
    shortLabel: 'Lunar Base',
    gravityG: '0.16g',
    commDelay: '1.3s ONE-WAY',
    missionPhase: 'ARTEMIS BASE CAMP // SHACKLETON RIM',
    hazardOverview:
      'Partial lunar gravity (1/6g) reduces cephalad venous pooling and preserves partial skeletal load; abrasive surface regolith and high SPE radiation present operational challenges.',
  },
  '0g_transit': {
    label: '0g Deep-Space Transit',
    shortLabel: '0g Transit',
    gravityG: '0.00g',
    commDelay: '14m 22s ONE-WAY',
    missionPhase: 'TRANS-MARS CRUISE // SOL 142',
    hazardOverview:
      'Microgravity induces cephalad fluid shift toward the head, increasing intracranial & optic nerve sheath pressure (SANS), accelerating bone mineral loss, and requiring closed-loop CO₂ scrubbing.',
  },
  'mars_base': {
    label: 'Mars Surface Base (3/8g)',
    shortLabel: 'Mars Base',
    gravityG: '0.38g',
    commDelay: '18m 10s ONE-WAY',
    missionPhase: 'JEZERO CRATER HABITAT // SOL 204',
    hazardOverview:
      'Partial Martian gravity (3/8g) mitigates SANS risk and provides axial loading; substantial comm latency requires autonomous crew health surveillance and delayed tele-consultation.',
  },
};

export const ENVIRONMENT_ORDER: GravityEnvironment[] = [
  'iss_leo',
  'lunar_base',
  '0g_transit',
  'mars_base',
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
  systolic_bp: { nominalMin: 100, nominalMax: 130, yellowMin: 90, yellowMax: 140 },
  bmd_delta: { nominalMin: -0.8, nominalMax: 0.2, yellowMin: -1.3, yellowMax: 0.5 },
  ared_load: { nominalMin: 18, nominalMax: 30, yellowMin: 12, yellowMax: 35 },
  blood_glucose: { nominalMin: 70, nominalMax: 110, yellowMin: 60, yellowMax: 140 },
  rad_dose: { nominalMin: 0.4, nominalMax: 1.2, yellowMin: 0.0, yellowMax: 2.5 },
  wbc_lymph: { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.2, yellowMax: 4.0 },
  core_temp: { nominalMin: 36.5, nominalMax: 37.5, yellowMin: 36.0, yellowMax: 38.0 },
  sleep_eff: { nominalMin: 82, nominalMax: 96, yellowMin: 72, yellowMax: 100 },
  pvt_lapses: { nominalMin: 0, nominalMax: 2, yellowMin: 0, yellowMax: 4 },
  daily_sleep_hours: { nominalMin: 7.0, nominalMax: 9.0, yellowMin: 6.0, yellowMax: 10.0 },
  mood_index: { nominalMin: 7.0, nominalMax: 10.0, yellowMin: 5.0, yellowMax: 10.0 },
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
    rad_dose: { nominalMin: 0.3, nominalMax: 0.8, yellowMin: 0.0, yellowMax: 1.8 },
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
  bmd_delta: 0.15,
  ared_load: 2.5,
  blood_glucose: 5,
  rad_dose: 0.15,
  wbc_lymph: 0.2,
  core_temp: 0.15,
  sleep_eff: 3,
  pvt_lapses: 0.8,
  daily_sleep_hours: 0.5,
  mood_index: 0.5,
};

export interface MetricInputRange {
  min: number;
  max: number;
  how: string;
}

/**
 * Hard plausibility limits + measurement instructions for manual check-in
 * entry (specs/01-data-schema.md §2 & §6). Never affects triage status.
 */
export const METRIC_INPUT_RANGES: Record<MetricId, MetricInputRange> = {
  onsd: { min: 3.0, max: 8.0, how: 'Ocular ultrasound, transverse plane, 3 mm behind globe; average both eyes.' },
  iop: { min: 5, max: 40, how: 'Rebound tonometer, seated, average of 3 readings per eye.' },
  cabin_co2: { min: 0, max: 15, how: 'Read the nearest cabin CO₂ monitor (CDM) at crew head height.' },
  resting_hr: { min: 30, max: 180, how: 'On waking, before moving: wearable or 30 s pulse count × 2.' },
  hrv_rmssd: { min: 5, max: 250, how: 'Overnight RMSSD from your wearable.' },
  spo2: { min: 70, max: 100, how: 'Finger oximeter, warm hand, still for 30 s.' },
  systolic_bp: { min: 60, max: 240, how: 'Automated arm cuff at heart level, seated/rested 5 min.' },
  bmd_delta: { min: -5, max: 3, how: 'Monthly QCT/DXA-equivalent scan result vs previous scan (%).' },
  ared_load: { min: 0, max: 60, how: 'Total from the ARED/resistance device log for today.' },
  blood_glucose: { min: 40, max: 400, how: 'Fasting or pre-meal glucometer fingerstick capillary test.' },
  rad_dose: { min: 0, max: 50, how: 'Personal dosimeter: last 24 h reading.' },
  wbc_lymph: { min: 0.1, max: 10, how: 'Point-of-care blood analyzer, finger-prick sample.' },
  core_temp: { min: 34.0, max: 42.0, how: 'Tympanic or double-sensor forehead heat-flux thermometer.' },
  sleep_eff: { min: 0, max: 100, how: 'Wearable sleep efficiency for last night (%).' },
  pvt_lapses: { min: 0, max: 50, how: '3-minute Psychomotor Vigilance Test on the crew tablet.' },
  daily_sleep_hours: { min: 0, max: 24, how: 'Actigraphy sleep duration log or smart sleep-band summary.' },
  mood_index: { min: 1, max: 10, how: 'Daily behavioral self-assessment visual analog scale (1=Lowest, 10=Optimal).' },
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
 * Deterministically computes the TriageStatus map for all 5 anatomical zones.
 */
export function evaluateAllZones(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  environment: GravityEnvironment
): Record<BodyZoneId, TriageStatus> {
  return {
    neuro: evaluateZoneStatus(zones.neuro, environment),
    cardio: evaluateZoneStatus(zones.cardio, environment),
    musculo: evaluateZoneStatus(zones.musculo, environment),
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
export function calculateCrewReadinessScore(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  environment: GravityEnvironment,
  completedStepsCount: number = 0
): number {
  let score = 98;
  const allReadings = Object.values(zones).flat();

  for (const reading of allReadings) {
    const status = evaluateMetricStatus(
      reading.metricId,
      reading.currentValue,
      environment
    );
    if (status === 'yellow') {
      score -= 3;
    } else if (status === 'red') {
      score -= 8;
    }
  }

  score += completedStepsCount * 3;
  return Math.max(15, Math.min(100, Math.round(score)));
}
