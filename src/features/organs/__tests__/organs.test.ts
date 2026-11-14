import { describe, expect, it } from 'vitest';
import { INDICATOR_BY_KEY } from '../../thousandEyes/indicators';
import { DAY } from '../../thousandEyes/science';
import type { Person } from '../../thousandEyes/types';
import { ORGANS, organStates, worstStatus } from '../organs';

const NOW = Date.UTC(2026, 10, 14, 12);

describe('organ registry', () => {
  it('maps every organ to existing indicators only, each indicator at most once', () => {
    const seen = new Set<string>();
    ORGANS.forEach((o) => {
      expect(o.indicators.length).toBeGreaterThan(0);
      o.indicators.forEach((k) => {
        expect(INDICATOR_BY_KEY[k]).toBeDefined();
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      });
    });
  });
  it('has the requested organs', () => {
    expect(ORGANS.map((o) => o.id).sort()).toEqual(
      ['bones', 'brain', 'eyes', 'heart', 'kidneys', 'liver', 'lungs', 'muscles', 'spleen'].sort()
    );
  });
});

describe('worstStatus', () => {
  it('returns the most severe status, or undefined', () => {
    expect(worstStatus([0, 2, 1])).toBe(2);
    expect(worstStatus([0, undefined, 1])).toBe(1);
    expect(worstStatus([undefined])).toBeUndefined();
  });
});

describe('organStates', () => {
  it('flags the organ whose indicator is red and leaves organs without data undefined', () => {
    const checkIns = [97, 98, 97, 91].map((v, i) => ({
      t: NOW - (4 - i) * DAY,
      phase: (i < 3 ? 'pre' : 'mis') as 'pre' | 'mis',
      env: 'leo' as const,
      values: { spo2: v, rhr: 60 },
    }));
    const p: Person = { checkIns, env: 'leo', created: NOW - 5 * DAY, launch: NOW - 1.5 * DAY };
    const s = organStates(p, NOW);
    expect(s.lungs.status).toBe(2);
    expect(s.heart.status).toBe(0);
    expect(s.kidneys.status).toBeUndefined();
  });
});
