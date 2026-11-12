/**
 * ARGUS — Deterministic Triage Engine & Gravity-Adjusted Threshold Evaluator
 * Single Source of Truth: specs/01-data-schema.md (§2–§3)
 *
 * Architectural Rule (AGENTS.md):
 * Keep Green/Yellow/Red threshold evaluation 100% deterministic in TypeScript.
 * Never delegate threshold classification to an LLM.
 */

import {
  BodyZoneId,
  GravityEnvironment,
  ThresholdRange,
  TriageStatus,
  VitalSignReading,
} from '../types/argus';

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
  '1_6g_moon': {
    label: '1/6g Lunar Surface',
    shortLabel: '1/6g Moon',
    gravityG: '0.16g',
    commDelay: '1.3s ONE-WAY',
    missionPhase: 'ARTEMIS SOUTH POLE BASE // SOL 28',
    hazardOverview:
      'Partial lunar gravity provides modest hydrostatic relief compared to 0g, but introduces abrasive electrostatic lunar regolith inhalation/dermatitis, high EVA musculoskeletal exertion, and unshielded solar particle exposure.',
  },
  '3_8g_mars': {
    label: '3/8g Martian Surface',
    shortLabel: '3/8g Mars',
    gravityG: '0.38g',
    commDelay: '18m 40s ONE-WAY',
    missionPhase: 'JEZERO HABITAT ALPHA // SOL 64',
    hazardOverview:
      'Martian 0.38g gravity demands post-transit orthostatic re-adaptation, strict protection against perchlorate dust, circadian alignment to a 24h 39m Martian sol, and autonomous medical execution under 18m 40s Earth comm lag.',
  },
};

/**
 * Gravity-adjusted threshold lookup table matching specs/01-data-schema.md §2
 */
export const METRIC_THRESHOLDS: Record<
  string,
  Record<GravityEnvironment, ThresholdRange>
> = {
  onsd: {
    '0g_transit': { nominalMin: 4.5, nominalMax: 5.5, yellowMin: 4.2, yellowMax: 5.9 },
    '1_6g_moon': { nominalMin: 4.4, nominalMax: 5.3, yellowMin: 4.1, yellowMax: 5.7 },
    '3_8g_mars': { nominalMin: 4.3, nominalMax: 5.2, yellowMin: 4.0, yellowMax: 5.6 },
  },
  iop: {
    '0g_transit': { nominalMin: 11, nominalMax: 18, yellowMin: 9, yellowMax: 21 },
    '1_6g_moon': { nominalMin: 10, nominalMax: 17, yellowMin: 9, yellowMax: 20 },
    '3_8g_mars': { nominalMin: 10, nominalMax: 17, yellowMin: 9, yellowMax: 19 },
  },
  cabin_co2: {
    '0g_transit': { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.0, yellowMax: 4.5 },
    '1_6g_moon': { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.0, yellowMax: 4.5 },
    '3_8g_mars': { nominalMin: 1.5, nominalMax: 3.8, yellowMin: 1.0, yellowMax: 4.8 },
  },
  resting_hr: {
    '0g_transit': { nominalMin: 52, nominalMax: 74, yellowMin: 46, yellowMax: 86 },
    '1_6g_moon': { nominalMin: 55, nominalMax: 78, yellowMin: 48, yellowMax: 88 },
    '3_8g_mars': { nominalMin: 58, nominalMax: 82, yellowMin: 50, yellowMax: 92 },
  },
  hrv_rmssd: {
    '0g_transit': { nominalMin: 42, nominalMax: 85, yellowMin: 30, yellowMax: 95 },
    '1_6g_moon': { nominalMin: 40, nominalMax: 82, yellowMin: 28, yellowMax: 95 },
    '3_8g_mars': { nominalMin: 38, nominalMax: 80, yellowMin: 26, yellowMax: 95 },
  },
  spo2: {
    '0g_transit': { nominalMin: 96, nominalMax: 100, yellowMin: 93, yellowMax: 100 },
    '1_6g_moon': { nominalMin: 95, nominalMax: 100, yellowMin: 92, yellowMax: 100 },
    '3_8g_mars': { nominalMin: 95, nominalMax: 100, yellowMin: 92, yellowMax: 100 },
  },
  bmd_delta: {
    '0g_transit': { nominalMin: -0.8, nominalMax: 0.2, yellowMin: -1.3, yellowMax: 0.5 },
    '1_6g_moon': { nominalMin: -0.5, nominalMax: 0.2, yellowMin: -1.0, yellowMax: 0.5 },
    '3_8g_mars': { nominalMin: -0.4, nominalMax: 0.3, yellowMin: -0.8, yellowMax: 0.5 },
  },
  ared_load: {
    '0g_transit': { nominalMin: 18, nominalMax: 30, yellowMin: 12, yellowMax: 35 },
    '1_6g_moon': { nominalMin: 15, nominalMax: 28, yellowMin: 10, yellowMax: 35 },
    '3_8g_mars': { nominalMin: 14, nominalMax: 26, yellowMin: 10, yellowMax: 35 },
  },
  rad_dose: {
    '0g_transit': { nominalMin: 0.4, nominalMax: 1.2, yellowMin: 0.0, yellowMax: 2.5 },
    '1_6g_moon': { nominalMin: 0.3, nominalMax: 1.0, yellowMin: 0.0, yellowMax: 2.2 },
    '3_8g_mars': { nominalMin: 0.2, nominalMax: 0.8, yellowMin: 0.0, yellowMax: 2.0 },
  },
  wbc_lymph: {
    '0g_transit': { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.2, yellowMax: 4.0 },
    '1_6g_moon': { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.2, yellowMax: 4.0 },
    '3_8g_mars': { nominalMin: 1.5, nominalMax: 3.5, yellowMin: 1.2, yellowMax: 4.0 },
  },
  sleep_eff: {
    '0g_transit': { nominalMin: 82, nominalMax: 96, yellowMin: 72, yellowMax: 100 },
    '1_6g_moon': { nominalMin: 82, nominalMax: 96, yellowMin: 72, yellowMax: 100 },
    '3_8g_mars': { nominalMin: 80, nominalMax: 95, yellowMin: 70, yellowMax: 100 },
  },
  pvt_lapses: {
    '0g_transit': { nominalMin: 0, nominalMax: 2, yellowMin: 0, yellowMax: 4 },
    '1_6g_moon': { nominalMin: 0, nominalMax: 2, yellowMin: 0, yellowMax: 4 },
    '3_8g_mars': { nominalMin: 0, nominalMax: 3, yellowMin: 0, yellowMax: 5 },
  },
};

export function getMetricThreshold(
  metricId: string,
  environment: GravityEnvironment
): ThresholdRange {
  const entry = METRIC_THRESHOLDS[metricId];
  if (!entry) {
    return { nominalMin: 0, nominalMax: 100, yellowMin: 0, yellowMax: 120 };
  }
  return entry[environment];
}

export function formatFlightNormBadge(
  metricId: string,
  unit: string,
  environment: GravityEnvironment
): string {
  const range = getMetricThreshold(metricId, environment);
  const envPrefix =
    environment === '0g_transit'
      ? '0g'
      : environment === '1_6g_moon'
      ? '1/6g'
      : '3/8g';
  return `${envPrefix} Norm: ${range.nominalMin}–${range.nominalMax} ${unit}`;
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
