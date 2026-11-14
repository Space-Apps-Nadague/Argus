/**
 * ARGUS — Thousand Eyes Pure Science Types
 * Ported from ARGOS_The_Thousand_Eyes.html (specs/02-ui-dashboard.md §2.4b).
 */

import type { MetricId, SpaceLocationId } from '../../types/argus';

export type BodySystemId =
  | 'Cardio'
  | 'Respiratory'
  | 'Sleep'
  | 'Mind'
  | 'Muscle'
  | 'Bone'
  | 'Eye'
  | 'Vestibular'
  | 'Immune'
  | 'Metabolic'
  | 'Radiation'
  | 'Habitat';

export type ThousandEyesIndicatorId =
  | 'rhr'
  | 'hrv'
  | 'sbp'
  | 'dbp'
  | 'spo2'
  | 'resp'
  | 'sleep'
  | 'slq'
  | 'mood'
  | 'stress'
  | 'energy'
  | 'cohes'
  | 'priv'
  | 'motiv'
  | 'grip'
  | 'resist'
  | 'aero'
  | 'back'
  | 'height'
  | 'vis'
  | 'diz'
  | 'temp'
  | 'crp'
  | 'sym'
  | 'wt'
  | 'kcal'
  | 'fluid'
  | 'urine'
  | 'dose'
  | 'co2'
  | 'noise';

/** 'h' = higher is worse, 'l' = lower is worse, 'b' = both directions are worse */
export type IndicatorDirection = 'h' | 'l' | 'b';

/** '' = personal physiological, 'B' = behavioural, 'X' = habitat/environment */
export type IndicatorFlag = '' | 'B' | 'X';

export type MissionPhase = 'pre' | 'mis' | 'rec';

export type EyeStatus = 'nodata' | 'nominal' | 'drifting' | 'red_flag';

export interface ThousandEyesIndicator {
  id: ThousandEyesIndicatorId;
  label: string;
  unit: string;
  system: BodySystemId;
  lo: number;
  hi: number;
  typicalSd: number;
  direction: IndicatorDirection;
  redLow: number | null;
  redHigh: number | null;
  flag: IndicatorFlag;
  how: string;
  /** Optional link to an ARGUS canonical metric for Trends navigation. */
  argusMetricId?: MetricId;
}

export interface ObservationPoint {
  day: number;
  value: number;
  phase?: MissionPhase;
  locationId?: SpaceLocationId;
}

export type ThousandEyesSeriesMap = Partial<Record<ThousandEyesIndicatorId, ObservationPoint[]>>;

export interface EyePersonalBaseline {
  mean: number;
  sd: number;
  n: number;
  provisional: boolean;
}

export interface EyeStat {
  indicator: ThousandEyesIndicator;
  status: EyeStatus;
  n: number;
  currentValue: number | null;
  baseline: EyePersonalBaseline | null;
  expectedShift: number;
  zCurrent: number | null;
  ewmaZ: number | null;
  bad: number;
  red: boolean;
}

export interface HiddenLink {
  from: ThousandEyesIndicatorId;
  to: ThousandEyesIndicatorId;
  lagDays: 0 | 1;
  r: number;
  n: number;
}
