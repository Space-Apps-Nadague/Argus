/**
 * ARGOS — The Thousand Eyes: shared types.
 * Model ported from ARGOS_The_Thousand_Eyes.html (person `D`, indicator table `IND`).
 */

export type BodySystem =
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

/** "h" = higher is worse, "l" = lower is worse, "b" = both directions are worse. */
export type Direction = 'h' | 'l' | 'b';

/** Mission phase: before flight, in mission, recovery after return. */
export type Phase = 'pre' | 'mis' | 'rec';

/** 0 = on baseline, 1 = drifting, 2 = red flag. */
export type Status = 0 | 1 | 2;

/** Prototype location keys. */
export type LocationKey = 'earth' | 'eartha' | 'leo' | 'gate' | 'mtr' | 'moon' | 'mars' | 'rov';

export interface Indicator {
  key: string;
  label: string;
  unit: string;
  system: BodySystem;
  /** Plausible input range. */
  lo: number;
  hi: number;
  /** Typical day-to-day SD; floor for the baseline spread. */
  sd: number;
  dir: Direction;
  /** Absolute red-flag limits. */
  redLow?: number;
  redHigh?: number;
  /**
   * Prototype `x` column. "X" = mission-only (no pre-flight baseline). "B" = behaviour input
   * (exercise, food, fluid): shown on the ring but left out of the deviation index.
   */
  flag?: 'X' | 'B';
  /** How to measure it. */
  how: string;
  /** Short advice when abnormal. */
  tip?: { above?: string; below?: string };
}

export interface CheckIn {
  /** Timestamp (ms). */
  t: number;
  phase: Phase;
  /** Location at the time of the reading. */
  env?: LocationKey;
  values: Partial<Record<string, number>>;
}

export interface Person {
  checkIns: CheckIn[];
  /** Current location. */
  env: LocationKey;
  created: number;
  launch?: number;
  ret?: number;
}

export interface Baseline {
  mean: number;
  sd: number;
  n: number;
  /** Built from the first mission readings because there was no pre-flight data. */
  provisional: boolean;
}

export interface IndicatorStatus {
  key: string;
  indicator: Indicator;
  /** Number of readings used (0 = no data). */
  n: number;
  baseline?: Baseline;
  /** Shift expected at the location of the latest reading, in native units. */
  expectedShift: number;
  current?: number;
  /** Latest reading, sigma from baseline (after the expected shift). */
  z?: number;
  /** Exponentially smoothed sigma. */
  ewma?: number;
  /** Direction-aware "badness" in sigma, >= 0. */
  badness: number;
  red: boolean;
  status?: Status;
}

export interface Link {
  a: string;
  b: string;
  /** 0 = same day, 1 = a today -> b the next day. */
  lagDays: 0 | 1;
  r: number;
  n: number;
}
