/**
 * ARGUS — Cognition games: shared types (specs/01-data-schema.md §12).
 */
import type { TriageStatus } from '../../types/argus';

export type CognitionGameId =
  | 'pvt'
  | 'motor_praxis'
  | 'fractal_2back'
  | 'volt'
  | 'dsst'
  | 'bart'
  | 'line_orientation'
  | 'abstract_matching'
  | 'matrix_reasoning';

/** Which way of the primary metric means better performance. `both`: any large change is notable (risk taking). */
export type MetricDirection = 'higher' | 'lower' | 'both';

export interface CognitionGameDef {
  id: CognitionGameId;
  /** Game-style name shown to the crew. */
  title: string;
  /** The NASA Cognition test it implements. */
  nasaTest: string;
  domain: string;
  /** One line: how to play. */
  howTo: string;
  /** Approximate play time in seconds. */
  seconds: number;
  primaryMetricLabel: string;
  primaryMetricUnit: string;
  direction: MetricDirection;
  /** Smallest meaningful spread of the primary metric; floors the MAD so tiny noise is not flagged. */
  madFloor: number;
}

/** What a finished game reports. */
export interface GameResult {
  /** Game points (gamified, 0–1000). Drives the leaderboard only. */
  points: number;
  /** Primary efficiency metric used for anomaly detection. */
  metric: number;
  /** 0–1 where meaningful. */
  accuracy?: number;
  meanRtMs?: number;
  /** Game-specific extras (e.g. PVT lapses). */
  extra?: Record<string, number>;
}

export interface CognitionSession extends GameResult {
  id: string;
  crewId: string;
  gameId: CognitionGameId;
  /** Local calendar day `YYYY-MM-DD` the session was played. */
  dateKey: string;
  timestampIso: string;
  /** False for a retest after an alert: does not count as the daily game. */
  daily: boolean;
}

export type CognitionStatus = TriageStatus | 'calibrating';

export interface CognitionEvaluation {
  status: CognitionStatus;
  /** Robust z of the decline (negative = worse than baseline). Null while calibrating. */
  declineZ: number | null;
  baselineMedian: number | null;
  baselineN: number;
}

export type CareRoute = 'none' | 'onboard' | 'earth';

export interface CareDecision {
  route: CareRoute;
  severity: TriageStatus;
  headline: string;
  reasons: string[];
  /** Steps the crew (Crew Medical Officer) can take on board. */
  onboardSteps: string[];
  /** True when the Flight Surgeon on Earth should get a packet now. */
  notifyEarth: boolean;
  /** Neuro zone is red: the crew should start the medical emergency procedure now. */
  openMedicalProtocol: boolean;
}
