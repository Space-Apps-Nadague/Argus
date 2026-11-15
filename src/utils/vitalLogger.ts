/**
 * ARGUS — Manual Vital Logger Helpers (`vitalLogger.ts`)
 * Single Source of Truth: specs/01-data-schema.md (§2, §6) & specs/02-ui-dashboard.md (§2.1, §2.2)
 *
 * Pure deterministic helpers for core-vital shortcuts, preset generation,
 * input validation, and live triage preview.
 */

import { BodyZoneId, GravityEnvironment, MetricId, TriageStatus } from '../types/argus';
import { validateCheckInValue } from './checkIns';
import {
  evaluateMetricStatus,
  getMetricThreshold,
  METRIC_INPUT_RANGES,
} from './triageEngine';

export interface CoreVitalShortcut {
  metricId: MetricId;
  zoneId: BodyZoneId;
  shortLabel: string;
}

/**
 * Five core spaceflight indicators highlighted in specs/03-requirements.md (REQ-05 / REQ-06).
 */
export const CORE_VITAL_SHORTCUTS: readonly CoreVitalShortcut[] = [
  { metricId: 'systolic_bp', zoneId: 'cardio', shortLabel: 'Blood Pressure' },
  { metricId: 'blood_glucose', zoneId: 'musculo', shortLabel: 'Blood Sugar' },
  { metricId: 'core_temp', zoneId: 'immune', shortLabel: 'Body Temp' },
  { metricId: 'daily_sleep_hours', zoneId: 'behavioral', shortLabel: 'Sleep Hours' },
  { metricId: 'mood_index', zoneId: 'behavioral', shortLabel: 'Mood' },
];

export type VitalPresetLevel = 'nominal' | 'yellow' | 'red';

/**
 * Computes a deterministic demo/test value for a metric that lands in the requested
 * triage band while staying within `METRIC_INPUT_RANGES`.
 */
export function computePresetValue(
  metricId: MetricId,
  preset: VitalPresetLevel,
  environment: GravityEnvironment
): number {
  const threshold = getMetricThreshold(metricId, environment);
  const range = METRIC_INPUT_RANGES[metricId];
  const clamp = (v: number) => Math.min(range.max, Math.max(range.min, v));
  const round = (v: number) => Number(v.toFixed(1));

  if (preset === 'nominal') {
    return round(clamp((threshold.nominalMin + threshold.nominalMax) / 2));
  }

  if (preset === 'yellow') {
    // Prefer the upper yellow band if there is room above nominalMax; otherwise use lower yellow band.
    if (threshold.yellowMax > threshold.nominalMax) {
      const candidate = (threshold.nominalMax + threshold.yellowMax) / 2;
      return round(clamp(candidate));
    }
    if (threshold.yellowMin < threshold.nominalMin) {
      const candidate = (threshold.yellowMin + threshold.nominalMin) / 2;
      return round(clamp(candidate));
    }
    return round(clamp(threshold.yellowMax));
  }

  // 'red' preset: step outside [yellowMin, yellowMax] within [range.min, range.max]
  const span = Math.max(threshold.yellowMax - threshold.nominalMax, 0.5);
  const upperRed = round(threshold.yellowMax + span * 0.6 + 0.5);
  if (upperRed <= range.max) {
    return upperRed;
  }
  const lowerSpan = Math.max(threshold.nominalMin - threshold.yellowMin, 0.5);
  const lowerRed = round(threshold.yellowMin - lowerSpan * 0.6 - 0.5);
  return round(clamp(lowerRed));
}

export interface VitalInputPreview {
  valid: boolean;
  value: number | null;
  error: string | null;
  status: TriageStatus | null;
}

/**
 * Validates raw user input against `METRIC_INPUT_RANGES` and computes deterministic
 * triage status via `evaluateMetricStatus`.
 */
export function evaluateVitalInputPreview(
  metricId: MetricId,
  rawValue: string,
  environment: GravityEnvironment
): VitalInputPreview {
  const validation = validateCheckInValue(metricId, rawValue);
  if (validation.ok === 'empty') {
    return { valid: false, value: null, error: null, status: null };
  }
  if (validation.ok === false) {
    return { valid: false, value: null, error: validation.error, status: null };
  }
  return {
    valid: true,
    value: validation.value,
    error: null,
    status: evaluateMetricStatus(metricId, validation.value, environment),
  };
}
