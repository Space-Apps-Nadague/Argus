/**
 * ARGUS — Health outlook: logged check results, kept per astronaut on this device (specs/02 §2.3).
 * Moving them to the database is a follow-up; until then every read and write is best-effort.
 */

import type { CheckOutcome, CheckResult } from './engine';

const KEY = (crewId: string) => `argus.healthChecks.v1.${crewId}`;
const OUTCOMES: readonly CheckOutcome[] = ['supports', 'normal', 'inconclusive'];

function isResult(x: unknown): x is CheckResult {
  const r = x as CheckResult;
  return (
    !!r && typeof r.conditionId === 'string' && typeof r.checkId === 'string' &&
    OUTCOMES.includes(r.outcome) && typeof r.at === 'number' && Number.isFinite(r.at)
  );
}

export function loadResults(crewId: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): CheckResult[] {
  try {
    const raw = storage?.getItem(KEY(crewId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isResult) : [];
  } catch {
    return [];
  }
}

export function saveResults(crewId: string, results: CheckResult[], storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY(crewId), JSON.stringify(results.slice(-200)));
  } catch {
    /* storage full or blocked: the outlook still works for this session */
  }
}

/** Replaces any earlier result for the same condition + check. */
export function upsertResult(results: CheckResult[], next: CheckResult): CheckResult[] {
  return [...results.filter((r) => !(r.conditionId === next.conditionId && r.checkId === next.checkId)), next];
}

export function removeResult(results: CheckResult[], conditionId: string, checkId: string): CheckResult[] {
  return results.filter((r) => !(r.conditionId === conditionId && r.checkId === checkId));
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
