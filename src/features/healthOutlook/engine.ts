/**
 * ARGUS — Health outlook engine (specs/02 §2.3). Pure and deterministic; never changes triage or readiness.
 *
 * Evidence per indicator = the ring's smoothed drift (EWMA z) from the person's own baseline in the worse
 * direction, +1 beyond a red-flag limit. Source: SRC-064 (EWMA). Score = strongest primary + half the mean of
 * supporting signals. Check results then move the score: Supports +1, Normal −1.5, for 14 days.
 * The level cut-offs, check weights and the 14-day window are ARGUS working assumptions (spec §2.3).
 */

import { INDICATOR_BY_KEY } from '../thousandEyes/indicators';
import { DAY, indicatorStatus } from '../thousandEyes/science';
import type { Person } from '../thousandEyes/types';
import { CHECK_BY_ID, type HealthCheck } from './checks';
import { CONDITIONS, type Condition, type ConditionSignal } from './conditions';

export type Level = 'watch' | 'possible' | 'likely';
export type CheckOutcome = 'supports' | 'normal' | 'inconclusive';
export type HypothesisStatus = 'open' | 'confirmed' | 'ruled_out';
export type OutlookTrend = 'rising' | 'steady' | 'easing';

export interface CheckResult {
  conditionId: string;
  checkId: string;
  outcome: CheckOutcome;
  /** When it was logged (ms). */
  at: number;
  note?: string;
}

export interface SignalEvidence {
  signal: ConditionSignal;
  label: string;
  /** Evidence in σ (≥ 0); null = no data for this indicator. */
  value: number | null;
  /** The indicator is beyond a red-flag limit in the worse direction. */
  red: boolean;
  /** From a research-grade sensor-ring indicator. */
  research: boolean;
}

export interface Hypothesis {
  condition: Condition;
  /** Score from the indicators alone. */
  rawScore: number;
  /** After check results. */
  score: number;
  level: Level | null;
  status: HypothesisStatus;
  outlook: { trend: OutlookTrend; scoreIn3Days: number; levelIn3Days: Level | null; hasHistory: boolean };
  evidence: SignalEvidence[];
  checks: Array<{ check: HealthCheck; result?: CheckResult }>;
  /** Tell the astronaut to contact the flight surgeon. */
  contactSurgeon: boolean;
}

export const LEVEL_MIN: Record<Level, number> = { watch: 1, possible: 2, likely: 3 };
export const SUPPORTS_WEIGHT = 1;
export const NORMAL_WEIGHT = 1.5;
export const RESULT_WINDOW_DAYS = 14;
export const OUTLOOK_DAYS = 3;
/** Change in score over 3 days that counts as rising or easing. */
const TREND_STEP = 0.3;

export function levelOf(score: number): Level | null {
  if (score >= LEVEL_MIN.likely) return 'likely';
  if (score >= LEVEL_MIN.possible) return 'possible';
  if (score >= LEVEL_MIN.watch) return 'watch';
  return null;
}

/** The person's data as it was at `t` (check-ins up to then). */
export function personAt(p: Person, t: number): Person {
  return { ...p, checkIns: p.checkIns.filter((c) => c.t <= t) };
}

function signalEvidence(p: Person, signal: ConditionSignal, now: number): SignalEvidence {
  const ind = INDICATOR_BY_KEY[signal.key];
  const research = ind?.sensor?.readiness === 'research';
  const label = ind?.label ?? signal.key;
  if (!ind) return { signal, label, value: null, red: false, research };
  const s = indicatorStatus(p, signal.key, now);
  if (!s.n || s.ewma == null || s.current == null) return { signal, label, value: null, red: false, research };
  const sign = signal.worse === 'up' ? 1 : -1;
  const red =
    signal.worse === 'up' ? ind.redHigh != null && s.current > ind.redHigh : ind.redLow != null && s.current < ind.redLow;
  return { signal, label, value: Math.max(0, sign * s.ewma) + (red ? 1 : 0), red, research };
}

/** Primary evidence needed before supporting signals count (supporting signals never raise a condition alone). */
export const MIN_PRIMARY = 0.5;

/** Score from indicator evidence alone. */
export function evidenceScore(evidence: SignalEvidence[]): number {
  const primary = evidence.filter((e) => e.signal.role === 'primary' && e.value != null).map((e) => e.value!);
  if (!primary.length || Math.max(...primary) < MIN_PRIMARY) return 0;
  const support = evidence.filter((e) => e.signal.role === 'supporting' && e.value != null).map((e) => e.value!);
  const supportMean = support.length ? support.reduce((a, b) => a + b, 0) / support.length : 0;
  return Math.max(...primary) + 0.5 * supportMean;
}

function recentResults(results: CheckResult[], conditionId: string, now: number): Map<string, CheckResult> {
  const out = new Map<string, CheckResult>();
  results
    .filter((r) => r.conditionId === conditionId && now - r.at <= RESULT_WINDOW_DAYS * DAY && r.at <= now)
    .sort((a, b) => a.at - b.at)
    .forEach((r) => out.set(r.checkId, r)); // latest result per check wins
  return out;
}

export function evaluateCondition(p: Person, condition: Condition, now: number, results: CheckResult[] = []): Hypothesis {
  const evidence = condition.signals.map((s) => signalEvidence(p, s, now));
  const rawScore = evidenceScore(evidence);

  const byCheck = recentResults(results, condition.id, now);
  const supports = [...byCheck.values()].filter((r) => r.outcome === 'supports').length;
  const normals = [...byCheck.values()].filter((r) => r.outcome === 'normal').length;
  const score = Math.max(0, rawScore + SUPPORTS_WEIGHT * supports - NORMAL_WEIGHT * normals);

  let status: HypothesisStatus = 'open';
  if (normals > 0 && score < LEVEL_MIN.watch) status = 'ruled_out';
  else if (supports > 0 && score >= LEVEL_MIN.possible) status = 'confirmed';

  const past = condition.signals.map((s) => signalEvidence(personAt(p, now - OUTLOOK_DAYS * DAY), s, now - OUTLOOK_DAYS * DAY));
  const hasHistory = past.some((e) => e.signal.role === 'primary' && e.value != null);
  const delta = hasHistory ? rawScore - evidenceScore(past) : 0;
  const trend: OutlookTrend = delta >= TREND_STEP ? 'rising' : delta <= -TREND_STEP ? 'easing' : 'steady';
  const scoreIn3Days = Math.max(0, score + delta);

  const level = status === 'ruled_out' ? null : levelOf(score);
  return {
    condition,
    rawScore,
    score,
    level,
    status,
    outlook: { trend, scoreIn3Days, levelIn3Days: status === 'ruled_out' ? null : levelOf(scoreIn3Days), hasHistory },
    evidence,
    checks: condition.checks.map((id) => ({ check: CHECK_BY_ID[id], result: byCheck.get(id) })).filter((c) => c.check),
    contactSurgeon: level === 'likely' || status === 'confirmed',
  };
}

/**
 * Conditions worth showing, strongest first: any at `watch` or above, plus any with a logged check result
 * (so ruled-out conditions stay visible). Conditions with no evidence and no results are left out.
 */
export function evaluateHealthOutlook(p: Person, now: number, results: CheckResult[] = []): Hypothesis[] {
  return CONDITIONS.map((c) => evaluateCondition(p, c, now, results))
    .filter((h) => h.level !== null || h.status === 'ruled_out' || h.checks.some((c) => c.result))
    .sort((a, b) => rank(b) - rank(a) || b.score - a.score);
}

function rank(h: Hypothesis): number {
  if (h.status === 'ruled_out') return -1;
  return h.level ? LEVEL_MIN[h.level] + (h.status === 'confirmed' ? 10 : 0) : 0;
}

export interface NextCheck {
  check: HealthCheck;
  /** Conditions this check would test. */
  conditions: Condition[];
  weight: number;
}

/** Checks not yet done for the open conditions, de-duplicated; a check that tests several conditions ranks higher. */
export function nextChecks(hypotheses: Hypothesis[]): NextCheck[] {
  const map = new Map<string, NextCheck>();
  hypotheses
    .filter((h) => h.status === 'open' && h.level)
    .forEach((h) =>
      h.checks.forEach(({ check, result }, i) => {
        if (result) return;
        const w = LEVEL_MIN[h.level!] / (1 + 0.25 * i); // earlier checks in a condition are more decisive
        const entry = map.get(check.id) ?? { check, conditions: [], weight: 0 };
        entry.conditions.push(h.condition);
        entry.weight += w;
        map.set(check.id, entry);
      })
    );
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

export interface SharedDriver {
  key: string;
  label: string;
  /** Strongest evidence (σ) this indicator gives any of the conditions. */
  value: number;
  conditions: Condition[];
}

/** Strong signal that counts as a common thread. */
export const SHARED_DRIVER_MIN = 2;

/**
 * Indicators that drive 3 or more of the open conditions at ≥ 2σ: one cause (e.g. a cabin CO₂ rise) can explain
 * several patterns, so the UI says so instead of presenting them as independent.
 */
export function sharedDrivers(hypotheses: Hypothesis[], minConditions = 3): SharedDriver[] {
  const map = new Map<string, SharedDriver>();
  hypotheses
    .filter((h) => h.status === 'open' && h.level)
    .forEach((h) =>
      h.evidence.forEach((e) => {
        if ((e.value ?? 0) < SHARED_DRIVER_MIN) return;
        const d = map.get(e.signal.key) ?? { key: e.signal.key, label: e.label, value: 0, conditions: [] };
        d.value = Math.max(d.value, e.value!);
        d.conditions.push(h.condition);
        map.set(e.signal.key, d);
      })
    );
  return [...map.values()].filter((d) => d.conditions.length >= minConditions).sort((a, b) => b.conditions.length - a.conditions.length || b.value - a.value);
}

export const OUTLOOK_DISCLAIMER =
  'Decision support, not a diagnosis. Built only from your own baselines; it never changes triage. Confirm with the flight surgeon.';
