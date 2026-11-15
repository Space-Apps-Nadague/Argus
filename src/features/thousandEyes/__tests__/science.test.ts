import { describe, expect, it } from 'vitest';
import { INDICATOR_BY_KEY, INDICATORS, RING_ORDER } from '../indicators';
import { expectedShift } from '../locationShift';
import {
  badness,
  baseline,
  DAY,
  deviationIndex,
  findLinks,
  indicatorStatus,
  phaseAt,
  readiness,
  sdv,
} from '../science';
import { buildPerson, indicatorKeyFor } from '../adapter';
import type { CheckIn, Person } from '../types';

const NOW = Date.UTC(2026, 10, 14, 12);

/** A person with `pre` pre-flight days and the given mission values for one indicator. */
function personWith(key: string, pre: number[], mis: number[], env: Person['env'] = 'earth'): Person {
  const checkIns: CheckIn[] = [];
  const total = pre.length + mis.length;
  pre.forEach((v, i) => checkIns.push({ t: NOW - (total - i) * DAY, phase: 'pre', env: 'earth', values: { [key]: v } }));
  mis.forEach((v, i) => checkIns.push({ t: NOW - (mis.length - i) * DAY + 1, phase: 'mis', env, values: { [key]: v } }));
  return { checkIns, env, created: NOW - (total + 1) * DAY, launch: NOW - mis.length * DAY };
}

describe('indicator table', () => {
  it('has the 31 prototype indicators, ring-ordered by body system', () => {
    expect(INDICATORS).toHaveLength(31);
    expect(RING_ORDER[0].system).toBe('Cardio');
    expect(RING_ORDER[RING_ORDER.length - 1].system).toBe('Habitat');
    expect(INDICATOR_BY_KEY.rhr).toMatchObject({ unit: 'bpm', dir: 'b', redLow: 40, redHigh: 110, sd: 5 });
    expect(INDICATOR_BY_KEY.dose.flag).toBe('X');
  });
});

describe('badness', () => {
  it('respects the direction that is worse', () => {
    expect(badness(INDICATOR_BY_KEY.stress, 2)).toBe(2); // h: higher is worse
    expect(badness(INDICATOR_BY_KEY.hrv, 2)).toBe(-2); // l: lower is worse
    expect(badness(INDICATOR_BY_KEY.rhr, -2)).toBe(2); // b: both
  });
});

describe('location shift', () => {
  it('uses group 1 in microgravity, group 2 on Moon/Mars, none on Earth', () => {
    expect(expectedShift('gate', 'rhr')).toBe(-3);
    expect(expectedShift('moon', 'rhr')).toBe(-1);
    expect(expectedShift('earth', 'rhr')).toBe(0);
    expect(expectedShift('leo', 'spo2')).toBe(0);
  });
});

describe('phase & baseline', () => {
  it('derives the phase from launch and return', () => {
    const p: Person = { checkIns: [], env: 'earth', created: 0, launch: 10, ret: 20 };
    expect(phaseAt(p, 5)).toBe('pre');
    expect(phaseAt(p, 15)).toBe('mis');
    expect(phaseAt(p, 25)).toBe('rec');
  });
  it('builds the baseline from pre-flight values with an SD floor', () => {
    const b = baseline(personWith('rhr', [60, 60, 60, 60], [60]), 'rhr', NOW)!;
    expect(b.mean).toBe(60);
    expect(b.sd).toBe(2.5); // sdv = 0 -> floor sd * 0.5
    expect(b.provisional).toBe(false);
  });
  it('falls back to a provisional baseline from the first mission days', () => {
    const b = baseline(personWith('rhr', [], [60, 62, 64, 70]), 'rhr', NOW)!;
    expect(b.provisional).toBe(true);
    expect(b.n).toBe(3);
  });
  it('sample SD uses n-1', () => {
    expect(sdv([1, 2, 3])).toBe(1);
  });
});

describe('indicatorStatus', () => {
  it('is on baseline when mission values match the baseline', () => {
    const s = indicatorStatus(personWith('rhr', [60, 61, 59, 60], [60, 61]), 'rhr', NOW);
    expect(s.status).toBe(0);
  });
  it('flags drift when the smoothed sigma passes the threshold', () => {
    const s = indicatorStatus(personWith('rhr', [60, 61, 59, 60], [66, 68, 70]), 'rhr', NOW);
    expect(s.status).toBe(1);
    expect(s.red).toBe(false);
  });
  it('raises a red flag on absolute limits', () => {
    const s = indicatorStatus(personWith('spo2', [97, 98, 97], [91]), 'spo2', NOW);
    expect(s.red).toBe(true);
    expect(s.status).toBe(2);
  });
  it('subtracts the shift expected at the location before judging', () => {
    // 3 bpm lower at the Gateway is expected adaptation, not drift.
    const s = indicatorStatus(personWith('rhr', [60, 60, 60, 60], [57, 57, 57], 'gate'), 'rhr', NOW);
    expect(s.expectedShift).toBe(-3);
    expect(s.z).toBeCloseTo(0);
    expect(s.status).toBe(0);
  });
  it('shows only red flags before flight', () => {
    const p: Person = {
      checkIns: [60, 60, 60, 80].map((v, i) => ({ t: NOW - (4 - i) * DAY, phase: 'pre' as const, env: 'earth' as const, values: { rhr: v } })),
      env: 'earth',
      created: NOW - 5 * DAY,
      launch: NOW + DAY,
    };
    expect(indicatorStatus(p, 'rhr', NOW).status).toBe(0);
  });
  it('returns n = 0 when there is no data', () => {
    expect(indicatorStatus(personWith('rhr', [60], [60]), 'hrv', NOW).n).toBe(0);
  });
});

/** A person with a clear same-day link between sleep and HRV over 10 days. */
function linkedPerson(): Person {
  const checkIns: CheckIn[] = Array.from({ length: 10 }, (_, i) => ({
    t: NOW - (10 - i) * DAY,
    phase: 'mis' as const,
    env: 'leo' as const,
    values: { sleep: 6 + (i % 4) * 0.5, hrv: 40 + (i % 4) * 5, rhr: 60 + (i % 2) },
  }));
  return { checkIns, env: 'leo', created: NOW - 12 * DAY, launch: NOW - 11 * DAY };
}

describe('readiness & links', () => {
  it('stays within 0–100 and grows the deviation index with drift', () => {
    const calm = INDICATORS.map((i) => indicatorStatus(personWith('rhr', [60, 61, 59, 60], [60, 61]), i.key, NOW)).filter((s) => s.n);
    const off = INDICATORS.map((i) => indicatorStatus(personWith('rhr', [60, 61, 59, 60], [75, 80, 85]), i.key, NOW)).filter((s) => s.n);
    expect(readiness(calm)).toBeGreaterThan(readiness(off)!);
    expect(deviationIndex(off)).toBeGreaterThan(deviationIndex(calm));
    expect(readiness([])).toBeNull();
  });
  it('finds strong links only (|r| >= 0.6, n >= 7)', () => {
    const links = findLinks(linkedPerson());
    expect(links.some((l) => [l.a, l.b].sort().join() === 'hrv,sleep' && l.lagDays === 0)).toBe(true);
    links.forEach((l) => {
      expect(Math.abs(l.r)).toBeGreaterThanOrEqual(0.6);
      expect(l.n).toBeGreaterThanOrEqual(7);
    });
  });
});

describe('adapter (real data only)', () => {
  it('maps HUD metric ids and indicator keys, ignores unknown ids', () => {
    expect(indicatorKeyFor('resting_hr')).toBe('rhr');
    expect(indicatorKeyFor('daily_sleep_hours')).toBe('sleep');
    expect(indicatorKeyFor('systolic_bp')).toBe('sbp');
    expect(indicatorKeyFor('core_temp')).toBe('temp');
    expect(indicatorKeyFor('sbp')).toBe('sbp');
    expect(indicatorKeyFor('onsd')).toBeNull();
  });
  it('builds check-ins only from supplied history (no demo values)', () => {
    const p = buildPerson({
      locationId: 'gateway',
      now: NOW,
      metrics: [
        { metricId: 'resting_hr', history: [{ missionDay: 1, value: 60 }, { missionDay: 2, value: 62 }] },
        { metricId: 'onsd', history: [{ missionDay: 1, value: 5 }] },
      ],
    });
    expect(p.env).toBe('gate');
    expect(p.checkIns).toHaveLength(2);
    expect(p.checkIns.flatMap((c) => Object.keys(c.values))).toEqual(['rhr', 'rhr']);
  });
  it('marks pre-flight readings as the baseline phase', () => {
    const p = buildPerson({ locationId: 'earth_pre', now: NOW, metrics: [{ metricId: 'spo2', history: [{ missionDay: 1, value: 97 }] }] });
    expect(p.checkIns[0].phase).toBe('pre');
  });
});
