import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../catalog';
import { cycleOrder, dayIndexOf, gameOfTheDay } from '../schedule';

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

describe('cognition schedule', () => {
  it('is deterministic per crew and day', () => {
    expect(gameOfTheDay('crew-a', '2026-11-15')).toBe(gameOfTheDay('crew-a', '2026-11-15'));
  });

  it('plays every game exactly once per cycle', () => {
    for (let c = 0; c < 20; c++) {
      expect(new Set(cycleOrder('crew-a', c)).size).toBe(GAME_IDS.length);
    }
  });

  it('never repeats a game on consecutive days', () => {
    const start = '2026-01-01';
    let prev = gameOfTheDay('crew-b', start);
    for (let i = 1; i < 400; i++) {
      const g = gameOfTheDay('crew-b', addDays(start, i));
      expect(g).not.toBe(prev);
      prev = g;
    }
  });

  it('shuffles differently for different crew', () => {
    const a = Array.from({ length: 9 }, (_, i) => gameOfTheDay('crew-a', addDays('2026-11-01', i))).join();
    const b = Array.from({ length: 9 }, (_, i) => gameOfTheDay('crew-z', addDays('2026-11-01', i))).join();
    expect(a).not.toBe(b);
  });

  it('day index advances by one per calendar day', () => {
    expect(dayIndexOf('2026-11-16') - dayIndexOf('2026-11-15')).toBe(1);
  });
});
