/**
 * ARGUS — Metric catalog & assumed sensor kit (specs/05-data-platform.md §4)
 * The 12 triage metrics reuse spec 01 thresholds/ranges; passive streams are new.
 */

import { METRIC_INPUT_RANGES } from '../../src/utils/triageEngine';
import type { MetricId } from '../../src/types/argus';

export type MetricKind = 'passive' | 'clinical' | 'self_report' | 'environment' | 'derived';
export type DeviceKind = 'smart_shirt' | 'bp_cuff' | 'wrist_actigraph' | 'ring' | 'core_temp_patch' | 'dosimeter' | 'manual';

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  zone: string | null;
  kind: MetricKind;
  plausibleMin: number;
  plausibleMax: number;
  sourceId: string | null;
}

const triage = (
  id: MetricId,
  label: string,
  unit: string,
  zone: string,
  kind: MetricKind,
  sourceId: string | null = 'SRC-001'
): MetricDef => ({
  id,
  label,
  unit,
  zone,
  kind,
  plausibleMin: METRIC_INPUT_RANGES[id].min,
  plausibleMax: METRIC_INPUT_RANGES[id].max,
  sourceId,
});

/** Daily triage metrics (spec 01 §2). `derived` = computed from passive minute streams. */
export const TRIAGE_METRICS: MetricDef[] = [
  triage('onsd', 'Optic Nerve Sheath Diam.', 'mm', 'neuro', 'clinical'),
  triage('iop', 'Intraocular Pressure', 'mmHg', 'neuro', 'clinical'),
  triage('cabin_co2', 'Inspired ppCO₂', 'mmHg', 'neuro', 'environment'),
  triage('resting_hr', 'Resting Heart Rate', 'bpm', 'cardio', 'derived', 'SRC-029'),
  triage('hrv_rmssd', 'Heart Rate Variability', 'ms', 'cardio', 'derived', 'SRC-029'),
  triage('spo2', 'Arterial SpO₂', '%', 'cardio', 'passive', 'SRC-021'),
  triage('bmd_delta', 'Femoral BMD Monthly Δ', '%', 'musculo', 'clinical'),
  triage('ared_load', 'Daily ARED Resistance Load', 'kN·reps', 'musculo', 'self_report'),
  triage('rad_dose', '24h Radiation Dose Rate', 'mSv/d', 'immune', 'derived', 'SRC-026'),
  triage('wbc_lymph', 'Lymphocyte Count', 'k/µL', 'immune', 'clinical'),
  triage('sleep_eff', 'Circadian Sleep Efficiency', '%', 'behavioral', 'derived', 'SRC-023'),
  triage('pvt_lapses', 'Psychomotor Vigilance Lapses', 'lapses', 'behavioral', 'self_report', 'SRC-009'),
];

/** Minute-level passive streams from the assumed sensor kit (spec 05 §4.2). */
export const PASSIVE_METRICS: MetricDef[] = [
  { id: 'heart_rate', label: 'Heart Rate', unit: 'bpm', zone: 'cardio', kind: 'passive', plausibleMin: 25, plausibleMax: 220, sourceId: 'SRC-021' },
  { id: 'resp_rate', label: 'Respiration Rate', unit: 'breaths/min', zone: 'cardio', kind: 'passive', plausibleMin: 4, plausibleMax: 60, sourceId: 'SRC-021' },
  { id: 'skin_temp', label: 'Skin Temperature', unit: '°C', zone: 'immune', kind: 'passive', plausibleMin: 25, plausibleMax: 42, sourceId: 'SRC-021' },
  { id: 'core_temp', label: 'Core Body Temperature', unit: '°C', zone: 'behavioral', kind: 'passive', plausibleMin: 34, plausibleMax: 41.5, sourceId: 'SRC-025' },
  { id: 'activity', label: 'Activity', unit: 'g', zone: 'musculo', kind: 'passive', plausibleMin: 0, plausibleMax: 8, sourceId: 'SRC-023' },
  { id: 'sleep_state', label: 'Sleep State', unit: '0=awake 1=asleep', zone: 'behavioral', kind: 'passive', plausibleMin: 0, plausibleMax: 1, sourceId: 'SRC-023' },
  { id: 'bp_sys', label: 'Systolic Blood Pressure', unit: 'mmHg', zone: 'cardio', kind: 'passive', plausibleMin: 60, plausibleMax: 250, sourceId: 'SRC-020' },
  { id: 'bp_dia', label: 'Diastolic Blood Pressure', unit: 'mmHg', zone: 'cardio', kind: 'passive', plausibleMin: 30, plausibleMax: 150, sourceId: 'SRC-020' },
  { id: 'dose_rate', label: 'Radiation Dose Rate', unit: 'µGy/h', zone: 'immune', kind: 'passive', plausibleMin: 0, plausibleMax: 10000, sourceId: 'SRC-026' },
];

export const ALL_METRICS: MetricDef[] = [...TRIAGE_METRICS, ...PASSIVE_METRICS];
export const METRIC_BY_ID = new Map(ALL_METRICS.map((m) => [m.id, m]));

/** Assumed per-astronaut sensor kit (spec 05 §4.1). */
export const SENSOR_KIT: Array<{ kind: DeviceKind; model: string; streams: string[]; sourceId: string }> = [
  { kind: 'smart_shirt', model: 'Astroskin-class smart shirt', streams: ['heart_rate', 'resp_rate', 'spo2', 'skin_temp', 'activity'], sourceId: 'SRC-020' },
  { kind: 'bp_cuff', model: 'Shirt-integrated BP', streams: ['bp_sys', 'bp_dia'], sourceId: 'SRC-020' },
  { kind: 'wrist_actigraph', model: 'Actiwatch-class actigraph', streams: ['activity', 'sleep_state', 'sleep_eff'], sourceId: 'SRC-023' },
  { kind: 'ring', model: 'Oura-class ring', streams: ['hrv_rmssd', 'resting_hr'], sourceId: 'SRC-029' },
  { kind: 'core_temp_patch', model: 'Double Sensor-class core temp patch', streams: ['core_temp'], sourceId: 'SRC-025' },
  { kind: 'dosimeter', model: 'Crew Active Dosimeter-class', streams: ['dose_rate'], sourceId: 'SRC-026' },
  { kind: 'manual', model: 'Crew tablet (check-ins, clinical exams)', streams: ['onsd', 'iop', 'bmd_delta', 'wbc_lymph', 'pvt_lapses', 'ared_load', 'cabin_co2'], sourceId: 'SRC-009' },
];
