/**
 * ARGUS — Metric catalog & assumed sensor kit (specs/05-data-platform.md §4)
 * The 12 triage metrics reuse spec 01 thresholds/ranges; passive streams are new.
 */

import { METRIC_INPUT_RANGES } from '../../src/utils/triageEngine';
import type { MetricId } from '../../src/types/argus';

export type MetricKind = 'passive' | 'clinical' | 'self_report' | 'environment' | 'derived';
export type DeviceKind =
  | 'smartwatch'
  | 'dosimeter'
  | 'habitat_sensor'
  | 'exercise_device'
  | 'clinical_exam'
  | 'manual'
  // retired kit (kept so historic rows stay valid)
  | 'smart_shirt'
  | 'bp_cuff'
  | 'wrist_actigraph'
  | 'ring'
  | 'core_temp_patch';

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
  // Challenge core indicators (spec 03 §2, metric ids from PR #20): watch, glucometer photo, watch tap-survey.
  triage('systolic_bp', 'Systolic Blood Pressure', 'mmHg', 'cardio', 'passive', 'SRC-075'),
  triage('blood_glucose', 'Blood Glucose', 'mg/dL', 'musculo', 'self_report', 'SRC-077'),
  triage('core_temp', 'Body Temperature (watch estimate)', '°C', 'immune', 'derived', 'SRC-074'),
  triage('daily_sleep_hours', 'Daily Sleep Duration', 'hours', 'behavioral', 'passive', 'SRC-074'),
  triage('mood_index', 'Mood Index (watch tap)', '/10', 'behavioral', 'self_report', 'SRC-009'),
];

/** Minute-level passive streams from the assumed sensor kit (spec 05 §4.2). */
export const PASSIVE_METRICS: MetricDef[] = [
  { id: 'heart_rate', label: 'Heart Rate', unit: 'bpm', zone: 'cardio', kind: 'passive', plausibleMin: 25, plausibleMax: 220, sourceId: 'SRC-021' },
  { id: 'resp_rate', label: 'Respiration Rate', unit: 'breaths/min', zone: 'cardio', kind: 'passive', plausibleMin: 4, plausibleMax: 60, sourceId: 'SRC-021' },
  { id: 'skin_temp', label: 'Skin Temperature', unit: '°C', zone: 'immune', kind: 'passive', plausibleMin: 25, plausibleMax: 42, sourceId: 'SRC-021' },
  { id: 'diastolic_bp', label: 'Diastolic Blood Pressure', unit: 'mmHg', zone: 'cardio', kind: 'passive', plausibleMin: 30, plausibleMax: 150, sourceId: 'SRC-075' },
  { id: 'activity', label: 'Activity', unit: 'g', zone: 'musculo', kind: 'passive', plausibleMin: 0, plausibleMax: 8, sourceId: 'SRC-023' },
  { id: 'sleep_state', label: 'Sleep State', unit: '0=awake 1=asleep', zone: 'behavioral', kind: 'passive', plausibleMin: 0, plausibleMax: 1, sourceId: 'SRC-023' },
  { id: 'wrist_temp', label: 'Wrist Skin Temperature (overnight)', unit: '°C', zone: 'immune', kind: 'passive', plausibleMin: 25, plausibleMax: 42, sourceId: 'SRC-074' },
  { id: 'dose_rate', label: 'Radiation Dose Rate', unit: 'µGy/h', zone: 'immune', kind: 'passive', plausibleMin: 0, plausibleMax: 10000, sourceId: 'SRC-026' },
];

export const ALL_METRICS: MetricDef[] = [...TRIAGE_METRICS, ...PASSIVE_METRICS];
export const METRIC_BY_ID = new Map(ALL_METRICS.map((m) => [m.id, m]));

/**
 * Assumed per-astronaut kit (spec 05 §4.1): only TWO worn devices, a smartwatch and a personal dosimeter.
 * Everything else arrives automatically from the habitat and exercise equipment, from periodic exams, or as
 * a photo (glucometer). No metric needs typing.
 */
export const SENSOR_KIT: Array<{ kind: DeviceKind; model: string; streams: string[]; sourceId: string }> = [
  {
    kind: 'smartwatch',
    model: 'Smartwatch (optical HR/SpO₂, ECG, cuff-calibrated BP, skin temperature, accelerometer)',
    streams: ['heart_rate', 'resp_rate', 'spo2', 'activity', 'sleep_state', 'sleep_eff', 'daily_sleep_hours', 'hrv_rmssd', 'resting_hr', 'wrist_temp', 'core_temp', 'systolic_bp', 'diastolic_bp', 'pvt_lapses', 'mood_index'],
    sourceId: 'SRC-027',
  },
  { kind: 'dosimeter', model: 'Personal active dosimeter (Crew Active Dosimeter-class)', streams: ['dose_rate'], sourceId: 'SRC-026' },
  { kind: 'habitat_sensor', model: 'Cabin CO₂ monitor (habitat, not worn)', streams: ['cabin_co2'], sourceId: 'SRC-001' },
  { kind: 'exercise_device', model: 'Resistive exercise device log (ARED-class, not worn)', streams: ['ared_load'], sourceId: 'SRC-001' },
  { kind: 'clinical_exam', model: 'Periodic exams: ocular ultrasound, tonometer, blood analyzer, bone scan', streams: ['onsd', 'iop', 'wbc_lymph', 'bmd_delta'], sourceId: 'SRC-009' },
  { kind: 'manual', model: 'Glucometer read from a photo (camera)', streams: ['blood_glucose'], sourceId: 'SRC-077' },
];

export const ACTIVE_DEVICE_KINDS = SENSOR_KIT.map((k) => k.kind);
