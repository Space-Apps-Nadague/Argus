import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../engine';
import { loadResults, removeResult, saveResults, upsertResult } from '../resultsStore';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const r = (checkId: string, outcome: CheckResult['outcome'], at = 1): CheckResult => ({ conditionId: 'infection', checkId, outcome, at });

describe('check results store', () => {
  it('saves and loads per astronaut', () => {
    const s = memory();
    saveResults('crew-a', [r('cbc', 'normal')], s);
    expect(loadResults('crew-a', s)).toEqual([r('cbc', 'normal')]);
    expect(loadResults('crew-b', s)).toEqual([]);
  });

  it('keeps one result per condition and check, and can undo it', () => {
    const once = upsertResult([r('cbc', 'normal', 1)], r('cbc', 'supports', 2));
    expect(once).toEqual([r('cbc', 'supports', 2)]);
    expect(removeResult(once, 'infection', 'cbc')).toEqual([]);
  });

  it('survives corrupt or blocked storage', () => {
    const s = memory();
    s.m.set('argus.healthChecks.v1.crew-a', '{not json');
    expect(loadResults('crew-a', s)).toEqual([]);
    s.m.set('argus.healthChecks.v1.crew-a', JSON.stringify([r('cbc', 'normal'), { bogus: true }]));
    expect(loadResults('crew-a', s)).toEqual([r('cbc', 'normal')]);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadResults('crew-a', throwing)).toEqual([]);
    expect(() => saveResults('crew-a', [r('cbc', 'normal')], throwing)).not.toThrow();
  });
});
