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
  '0g_transit': {
    label: '0g Deep-Space Transit',
    shortLabel: '0g Transit',
    gravityG: '0.00g',
    commDelay: '14m 22s ONE-WAY',
    missionPhase: 'TRANS-MARS CRUISE // SOL 142',
    hazardOverview:
      'Microgravity induces cephalad fluid shift toward the head, increasing intracranial & optic nerve sheath pressure (SANS), accelerating bone mineral loss, and requiring closed-loop CO₂ scrubbing.',
  },
};

/**
 * 0g microgravity threshold lookup table matching specs/01-data-schema.md §2
 */
export const METRIC_THRESHOLDS: Record<string, ThresholdRange> = {
  onsd: { nominalMin: 4.5, nominalMax: 5.5, yellowMin: 4.2, yellowMax: 5.9 },
  iop: { nominalMin: 11, nominalMax: 18, yellowMin: 9, yellowMax: 21 },
  cabin_co2: { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.0, yellowMax: 4.5 },
  resting_hr: { nominalMin: 52, nominalMax: 74, yellowMin: 46, yellowMax: 86 },
  hrv_rmssd: { nominalMin: 42, nominalMax: 85, yellowMin: 30, yellowMax: 95 },
  spo2: { nominalMin: 96, nominalMax: 100, yellowMin: 93, yellowMax: 100 },
  bmd_delta: { nominalMin: -0.8, nominalMax: 0.2, yellowMin: -1.3, yellowMax: 0.5 },
  ared_load: { nominalMin: 18, nominalMax: 30, yellowMin: 12, yellowMax: 35 },
  rad_dose: { nominalMin: 0.4, nominalMax: 1.2, yellowMin: 0.0, yellowMax: 2.5 },
  wbc_lymph: { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.2, yellowMax: 4.0 },
  sleep_eff: { nominalMin: 82, nominalMax: 96, yellowMin: 72, yellowMax: 100 },
  pvt_lapses: { nominalMin: 0, nominalMax: 2, yellowMin: 0, yellowMax: 4 },
  // Challenge core indicators (specs/01-data-schema.md §2, specs/05-data-platform.md §4).
  // Source: SRC-070 (AHA categories: normal <120/<80, elevated 120–129, stage 1 130–139/80–89, stage 2 ≥140/≥90)
  // Source: SRC-071 (AHA: hypotension <90/60). Lower red bounds (80 / 50 mmHg) are an ARGUS assumption.
  bp_sys: { nominalMin: 90, nominalMax: 119, yellowMin: 80, yellowMax: 139 },
  bp_dia: { nominalMin: 60, nominalMax: 79, yellowMin: 50, yellowMax: 89 },
  // Source: SRC-072 (ADA fasting glucose: normal <100, prediabetes 100–125, diabetes ≥126 mg/dL)
  // Source: SRC-073 (ADA hypoglycemia: level 1 54–69, level 2 <54 mg/dL)
  glucose: { nominalMin: 70, nominalMax: 99, yellowMin: 54, yellowMax: 125 },
  // Nightly wrist temperature vs the person's own baseline (Source: SRC-074). No clinical cut-offs exist for
  // wrist deviation: ±0.5 / ±1.0 °C bands are an ARGUS assumption for fever / illness screening.
  wrist_temp_dev: { nominalMin: -0.5, nominalMax: 0.5, yellowMin: -1.0, yellowMax: 1.0 },
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
  bmd_delta: 0.15,
  ared_load: 2.5,
  rad_dose: 0.15,
  wbc_lymph: 0.2,
  sleep_eff: 3,
  pvt_lapses: 0.8,
  bp_sys: 5,
  bp_dia: 4,
  glucose: 6,
  wrist_temp_dev: 0.15,
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
  bmd_delta: { min: -5, max: 3, how: 'Monthly QCT/DXA-equivalent scan result vs previous scan (%).' },
  ared_load: { min: 0, max: 60, how: 'Total from the ARED/resistance device log for today.' },
  rad_dose: { min: 0, max: 50, how: 'Personal dosimeter: last 24 h reading.' },
  wbc_lymph: { min: 0.1, max: 10, how: 'Point-of-care blood analyzer, finger-prick sample.' },
  sleep_eff: { min: 0, max: 100, how: 'Wearable sleep efficiency for last night (%).' },
  pvt_lapses: { min: 0, max: 50, how: '3-minute Psychomotor Vigilance Test on the watch.' },
  bp_sys: { min: 60, max: 250, how: 'Watch blood-pressure reading: sit still, arm at heart level (watch calibrated with a cuff every 28 days).' },
  bp_dia: { min: 30, max: 150, how: 'Watch blood-pressure reading: sit still, arm at heart level (watch calibrated with a cuff every 28 days).' },
  glucose: { min: 20, max: 600, how: 'Fasting finger-prick on the glucometer, then photograph the meter screen.' },
  wrist_temp_dev: { min: -5, max: 5, how: 'Automatic: overnight wrist temperature vs your own baseline (wear the watch to bed).' },
};

export const METRIC_IDS = Object.keys(METRIC_TYPICAL_SD) as MetricId[];

export function isMetricId(id: string): id is MetricId {
  return Object.prototype.hasOwnProperty.call(METRIC_TYPICAL_SD, id);
}

export function getMetricThreshold(
  metricId: string,
  _environment: GravityEnvironment = DEFAULT_ENVIRONMENT
): ThresholdRange {
  return (
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
  return `0g Norm: ${range.nominalMin}–${range.nominalMax} ${unit}`;
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
