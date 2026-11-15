import { describe, expect, it } from 'vitest';
import { dailyStreak, evaluateScore, leaderboard } from '../scoring';
import type { CognitionSession } from '../types';

const s = (over: Partial<CognitionSession>): CognitionSession => ({
  id: Math.random().toString(36),
  crewId: 'a',
  gameId: 'dsst',
  dateKey: '2026-11-10',
  timestampIso: '2026-11-10T08:00:00Z',
  daily: true,
  points: 500,
  metric: 50,
  ...over,
});

const prior = (metrics: number[], gameId: CognitionSession['gameId'] = 'dsst') =>
  metrics.map((m, i) => s({ gameId, metric: m, timestampIso: `2026-11-0${i + 1}T08:00:00Z`, dateKey: `2026-11-0${i + 1}` }));

describe('cognition scoring', () => {
  it('calibrates until 3 prior sessions exist', () => {
    expect(evaluateScore('dsst', 40, prior([50, 52])).status).toBe('calibrating');
  });

  it('is green near baseline, yellow and red for growing declines (higher-is-better game)', () => {
    const p = prior([50, 52, 51, 49, 50]);
    expect(evaluateScore('dsst', 50, p).status).toBe('green');
    expect(evaluateScore('dsst', 44, p).status).toBe('yellow');
    expect(evaluateScore('dsst', 30, p).status).toBe('red');
  });

  it('treats a better score as green even when far from baseline', () => {
    expect(evaluateScore('dsst', 90, prior([50, 52, 51, 49, 50])).status).toBe('green');
  });

  it('flags higher error as decline for lower-is-better games', () => {
    const p = prior([4, 5, 4.5, 4, 5], 'line_orientation');
    expect(evaluateScore('line_orientation', 4.5, p).status).toBe('green');
    expect(evaluateScore('line_orientation', 20, p).status).toBe('red');
  });

  it('flags change in either direction for risk taking (BART)', () => {
    const p = prior([10, 11, 10, 12, 11], 'bart');
    expect(evaluateScore('bart', 25, p).status).toBe('red');
    expect(evaluateScore('bart', 1, p).status).not.toBe('green');
  });

  it('uses a rolling window so steady improvement (practice) does not cause alerts', () => {
    const p = prior([40, 44, 47, 50, 52, 54]);
    expect(evaluateScore('dsst', 55, p).status).toBe('green');
  });

  it('counts streaks ending today or yesterday', () => {
    const h = ['2026-11-12', '2026-11-13', '2026-11-14'].map((d) => s({ dateKey: d }));
    expect(dailyStreak(h, '2026-11-14')).toBe(3);
    expect(dailyStreak(h, '2026-11-15')).toBe(3);
    expect(dailyStreak(h, '2026-11-16')).toBe(0);
  });

  it('leaderboard ignores retests and old games', () => {
    const byCrew = {
      a: [s({ dateKey: '2026-11-14', points: 300 }), s({ dateKey: '2026-11-14', points: 900, daily: false })],
      b: [s({ crewId: 'b', dateKey: '2026-11-14', points: 500 }), s({ crewId: 'b', dateKey: '2026-10-01', points: 999 })],
    };
    const rows = leaderboard(byCrew, ['a', 'b'], '2026-11-15');
    expect(rows.map((r) => [r.crewId, r.points])).toEqual([
      ['b', 500],
      ['a', 300],
    ]);
  });
});
