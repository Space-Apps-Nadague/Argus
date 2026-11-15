/**
 * ARGUS — Daily cognition game schedule (specs/01-data-schema.md §12.2).
 * One game per crew member per calendar day, from a seeded "shuffle bag":
 * every game appears once per cycle, order reshuffled each cycle, no game twice in a row.
 * Deterministic, so every device shows the same game for the same astronaut and day.
 */
import { GAME_IDS } from './catalog';
import { hashString, mulberry32, shuffle } from './rng';
import type { CognitionGameId } from './types';

const DAY_MS = 86_400_000;

/** Local calendar day key `YYYY-MM-DD`. */
export function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole days since the Unix epoch for a local day key. */
export function dayIndexOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function bagFor(crewId: string, cycle: number, ids: readonly CognitionGameId[]): CognitionGameId[] {
  return shuffle(ids, mulberry32(hashString(`${crewId}:${cycle}`)));
}

/** The shuffled order for one cycle, adjusted so it never starts with the previous cycle's last game. */
export function cycleOrder(
  crewId: string,
  cycle: number,
  ids: readonly CognitionGameId[] = GAME_IDS
): CognitionGameId[] {
  const bag = bagFor(crewId, cycle, ids);
  if (ids.length < 2) return bag;
  const prevLast = bagFor(crewId, cycle - 1, ids)[ids.length - 1];
  if (bag[0] === prevLast) [bag[0], bag[1]] = [bag[1], bag[0]];
  return bag;
}

export function gameOfTheDay(
  crewId: string,
  dateKey: string,
  ids: readonly CognitionGameId[] = GAME_IDS
): CognitionGameId {
  const day = dayIndexOf(dateKey);
  const n = ids.length;
  const cycle = Math.floor(day / n);
  return cycleOrder(crewId, cycle, ids)[day - cycle * n];
}

/** Local day key for a day index (inverse of `dayIndexOf`). */
export function dateKeyOfDayIndex(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export interface CycleDay {
  dateKey: string;
  gameId: CognitionGameId;
  /** past, today or upcoming within the current 9-day cycle */
  when: 'past' | 'today' | 'upcoming';
}

/** Where today sits in the 9-day rotation, and the cycle's days (for the cycle track). */
export function cycleDays(crewId: string, dateKey: string, ids: readonly CognitionGameId[] = GAME_IDS): { position: number; days: CycleDay[] } {
  const day = dayIndexOf(dateKey);
  const n = ids.length;
  const cycle = Math.floor(day / n);
  const order = cycleOrder(crewId, cycle, ids);
  const position = day - cycle * n;
  return {
    position,
    days: order.map((gameId, k) => ({
      dateKey: dateKeyOfDayIndex(cycle * n + k),
      gameId,
      when: k < position ? 'past' : k === position ? 'today' : 'upcoming',
    })),
  };
}
