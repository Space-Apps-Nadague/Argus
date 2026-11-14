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
};

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
