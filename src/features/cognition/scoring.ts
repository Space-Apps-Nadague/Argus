/**
 * ARGUS — Cognition scoring, personal baseline and leaderboard (specs/01-data-schema.md §12.3).
 * Deterministic. Each score is compared with the same astronaut's recent sessions of the same game,
 * never with other crew. A rolling baseline absorbs the practice effect seen with repeated testing.
 * Source: SRC-063 (robust z with MAD), SRC-091 (practice effects on repeated Cognition administration)
 */
import { ROBUST_Z_LIMIT, robustZ } from '../../../shared/analytics/detectors';
import { GAME_BY_ID } from './catalog';
import { dayIndexOf } from './schedule';
import type { CognitionEvaluation, CognitionGameId, CognitionSession } from './types';

/** Prior sessions of a game needed before scores are judged. */
export const MIN_BASELINE_SESSIONS = 3;
/** Rolling window of prior sessions forming the personal baseline (absorbs learning). */
export const BASELINE_WINDOW = 5;
/** Decline z at or below this → Caution. Assumption (spec §12.3), matches the 2σ "drifting" band [SRC-064]. */
export const YELLOW_DECLINE_Z = -2;
/** Decline z at or below this → Alert. Robust-z outlier limit [SRC-063]. */
export const RED_DECLINE_Z = -ROBUST_Z_LIMIT;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function priorSessions(
  history: CognitionSession[],
  gameId: CognitionGameId,
  beforeIso: string
): CognitionSession[] {
  return history
    .filter((s) => s.gameId === gameId && s.timestampIso < beforeIso)
    .sort((a, b) => a.timestampIso.localeCompare(b.timestampIso));
}

/** Evaluate one metric value against the astronaut's prior sessions of the same game. */
export function evaluateScore(
  gameId: CognitionGameId,
  value: number,
  prior: CognitionSession[]
): CognitionEvaluation {
  const window = prior.slice(-BASELINE_WINDOW).map((s) => s.metric);
  if (window.length < MIN_BASELINE_SESSIONS) {
    return { status: 'calibrating', declineZ: null, baselineMedian: null, baselineN: window.length };
  }
  const def = GAME_BY_ID[gameId];
  const med = median(window);
  const mad = median(window.map((x) => Math.abs(x - med)));
  const z = robustZ(value, med, mad, def.madFloor);
  const declineZ = def.direction === 'higher' ? z : def.direction === 'lower' ? -z : -Math.abs(z);
  const status = declineZ <= RED_DECLINE_Z ? 'red' : declineZ <= YELLOW_DECLINE_Z ? 'yellow' : 'green';
  return { status, declineZ, baselineMedian: med, baselineN: window.length };
}

export function evaluateSession(session: CognitionSession, history: CognitionSession[]): CognitionEvaluation {
  return evaluateScore(session.gameId, session.metric, priorSessions(history, session.gameId, session.timestampIso));
}

/** Consecutive daily games played, ending today or yesterday. */
export function dailyStreak(history: CognitionSession[], todayKey: string): number {
  const days = new Set(history.filter((s) => s.daily).map((s) => dayIndexOf(s.dateKey)));
  let d = dayIndexOf(todayKey);
  if (!days.has(d)) d -= 1;
  let streak = 0;
  while (days.has(d)) {
    streak++;
    d--;
  }
  return streak;
}

export function personalBest(history: CognitionSession[], gameId: CognitionGameId): number {
  return history.filter((s) => s.gameId === gameId).reduce((m, s) => Math.max(m, s.points), 0);
}

export interface LeaderboardRow {
  crewId: string;
  points: number;
  games: number;
  streak: number;
}

/** Leaderboard over the last `days` calendar days: daily-game points only (retests do not score). */
export function leaderboard(
  sessionsByCrew: Record<string, CognitionSession[]>,
  crewIds: string[],
  todayKey: string,
  days = 7
): LeaderboardRow[] {
  const from = dayIndexOf(todayKey) - days + 1;
  return crewIds
    .map((crewId) => {
      const list = sessionsByCrew[crewId] ?? [];
      const recent = list.filter((s) => s.daily && dayIndexOf(s.dateKey) >= from);
      return {
        crewId,
        points: recent.reduce((t, s) => t + s.points, 0),
        games: recent.length,
        streak: dailyStreak(list, todayKey),
      };
    })
    .sort((a, b) => b.points - a.points || b.streak - a.streak);
}
