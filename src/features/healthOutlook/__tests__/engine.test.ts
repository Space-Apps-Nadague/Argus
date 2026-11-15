import { describe, expect, it } from 'vitest';
import { INDICATOR_BY_KEY } from '../../thousandEyes/indicators';
import { expectedShift } from '../../thousandEyes/locationShift';
import { DAY } from '../../thousandEyes/science';
import type { CheckIn, Person } from '../../thousandEyes/types';
import { CHECK_BY_ID, CHECKS } from '../checks';
import { CONDITIONS } from '../conditions';
import { type CheckResult, evaluateCondition, evaluateHealthOutlook, levelOf, nextChecks, sharedDrivers } from '../engine';
import { CONDITION_BY_ID } from '../conditions';

const NOW = Date.UTC(2026, 10, 15, 12);

/** 10 pre-flight days of `pre`, then mission days with the given values per key. */
function person(pre: Record<string, number>, mission: Array<Record<string, number>>): Person {
  const checkIns: CheckIn[] = [];
  const total = 10 + mission.length;
  for (let i = 0; i < 10; i++) {
    const wobble = (i % 3) - 1; // small natural day-to-day spread
    const values = Object.fromEntries(Object.entries(pre).map(([k, v]) => [k, v + wobble * INDICATOR_BY_KEY[k].sd * 0.5]));
    checkIns.push({ t: NOW - (total - i) * DAY, phase: 'pre', env: 'earth', values });
  }
  // Earth-analog mission: no location shift, so "calm" values really are on baseline.
  mission.forEach((values, i) => checkIns.push({ t: NOW - (mission.length - i) * DAY + 1, phase: 'mis', env: 'earth', values }));
  return { checkIns, env: 'earth', created: NOW - (total + 1) * DAY, launch: NOW - mission.length * DAY };
}

const calm = { temp: 36.7, crp: 1, sym: 0, rhr: 60, sleep: 7.5, mood: 4 };
const days = (n: number, f: (i: number) => Record<string, number>) => Array.from({ length: n }, (_, i) => f(i));

describe('catalogue', () => {
  it('only uses real Thousand Eyes indicators, real checks and registered-style sources', () => {
    expect(CONDITIONS.length).toBe(14);
    for (const c of CONDITIONS) {
      expect(c.signals.some((s) => s.role === 'primary'), c.id).toBe(true);
      c.signals.forEach((s) => expect(INDICATOR_BY_KEY[s.key], `${c.id}:${s.key}`).toBeDefined());
      c.checks.forEach((id) => expect(CHECK_BY_ID[id], `${c.id}:${id}`).toBeDefined());
      c.sources.forEach((id) => expect(id).toMatch(/^SRC-\d{3}$/));
    }
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
  });

  it('maps scores to levels', () => {
    expect(levelOf(0.5)).toBeNull();
    expect(levelOf(1)).toBe('watch');
    expect(levelOf(2.4)).toBe('possible');
    expect(levelOf(3.2)).toBe('likely');
  });
});

describe('health outlook', () => {
  it('shows nothing when every indicator stays on baseline', () => {
    const p = person(calm, days(8, () => calm));
    expect(evaluateHealthOutlook(p, NOW)).toEqual([]);
  });

  it('does not flag normal adaptation: values that shift by the amount expected at the location', () => {
    const p = person(calm, days(8, () => calm));
    const leo: Person = {
      ...p,
      env: 'leo',
      checkIns: p.checkIns.map((c) =>
        c.phase === 'mis' ? { ...c, env: 'leo', values: { ...c.values, rhr: 60 + expectedShift('leo', 'rhr'), sleep: 7.5 + expectedShift('leo', 'sleep') } } : c
      ),
    };
    expect(evaluateHealthOutlook(leo, NOW)).toEqual([]);
  });

  it('raises a rising infection hypothesis from fever, CRP and symptoms, and says to contact the surgeon', () => {
    const p = person(calm, days(8, (i) => ({ ...calm, temp: 36.7 + Math.max(0, i - 3) * 0.35, crp: 1 + Math.max(0, i - 3) * 3, sym: Math.max(0, i - 3) * 1.5 })));
    const [top] = evaluateHealthOutlook(p, NOW);
    expect(top.condition.id).toBe('infection');
    expect(top.level).toBe('likely');
    expect(top.outlook.trend).toBe('rising');
    expect(top.contactSurgeon).toBe(true);
    expect(top.evidence.find((e) => e.signal.key === 'temp')!.red).toBe(true);
    // Indicators without data are listed as such.
    expect(top.evidence.find((e) => e.signal.key === 'svoc')!.value).toBeNull();
  });

  it('rules a hypothesis out after normal check results, and confirms it after supporting ones', () => {
    const p = person(calm, days(8, (i) => ({ ...calm, sleep: 7.5 - Math.max(0, i - 4) * 0.6 })));
    const base = evaluateCondition(p, CONDITION_BY_ID.sleep, NOW);
    expect(base.level).not.toBeNull();
    expect(base.level).not.toBe('likely');

    const normal: CheckResult[] = ['pvt', 'sleep_log'].map((checkId) => ({ conditionId: 'sleep', checkId, outcome: 'normal', at: NOW - DAY }));
    const ruledOut = evaluateCondition(p, CONDITION_BY_ID.sleep, NOW, normal);
    expect(ruledOut.status).toBe('ruled_out');
    expect(ruledOut.level).toBeNull();

    const supports: CheckResult[] = [{ conditionId: 'sleep', checkId: 'pvt', outcome: 'supports', at: NOW - DAY }];
    const confirmed = evaluateCondition(p, CONDITION_BY_ID.sleep, NOW, supports);
    expect(confirmed.score).toBeCloseTo(base.score + 1);
    if (confirmed.score >= 2) expect(confirmed.status).toBe('confirmed');

    // Results older than 14 days no longer count.
    const stale = evaluateCondition(p, CONDITION_BY_ID.sleep, NOW, normal.map((r) => ({ ...r, at: NOW - 20 * DAY })));
    expect(stale.status).toBe('open');
  });

  it('lists each pending check once, ranking checks that test several conditions higher', () => {
    const p = person({ ...calm, dose: 0.5 }, days(8, (i) => ({ ...calm, dose: 0.5 + Math.max(0, i - 3) * 0.4, temp: 36.7 + Math.max(0, i - 3) * 0.3, sym: Math.max(0, i - 3) * 1.5 })));
    const hyps = evaluateHealthOutlook(p, NOW);
    const ids = hyps.map((h) => h.condition.id);
    expect(ids).toEqual(expect.arrayContaining(['infection', 'radiation']));
    const next = nextChecks(hyps);
    expect(new Set(next.map((n) => n.check.id)).size).toBe(next.length);
    const cbc = next.find((n) => n.check.id === 'cbc')!;
    expect(cbc.conditions.map((c) => c.id)).toEqual(expect.arrayContaining(['infection', 'radiation']));
  });

  it('never raises a condition from supporting signals alone, and labels research-sensor evidence', () => {
    const p = person({ mood: 4, stress: 2, cort: 40 }, days(8, (i) => ({ mood: 4, stress: 2, cort: 40 + Math.max(0, i - 2) * 25 })));
    const h = evaluateCondition(p, CONDITION_BY_ID.behavioral, NOW);
    const cort = h.evidence.find((e) => e.signal.key === 'cort')!;
    expect(cort.value!).toBeGreaterThan(2);
    expect(cort.research).toBe(true);
    expect(h.rawScore).toBe(0);
    expect(h.level).toBeNull();
  });

  it('names a strongly drifting indicator that drives 3+ patterns as a common thread', () => {
    const pre = { ...calm, spo2: 98, resp: 14, hrv: 60, temp: 36.7 };
    const p = person(pre, days(8, (i) => ({ ...pre, rhr: 60 + Math.max(0, i - 3) * 6, spo2: 98 - Math.max(0, i - 3) * 1.5, hrv: 60 - Math.max(0, i - 3) * 6, temp: 36.7 + Math.max(0, i - 3) * 0.3 })));
    const hyps = evaluateHealthOutlook(p, NOW);
    const rhr = sharedDrivers(hyps).find((d) => d.key === 'rhr');
    expect(rhr).toBeDefined();
    expect(rhr!.conditions.map((c) => c.id)).toEqual(expect.arrayContaining(['cardio', 'infection', 'hypoxemia']));
    expect(sharedDrivers(evaluateHealthOutlook(person(calm, days(8, () => calm)), NOW))).toEqual([]);
  });
});
