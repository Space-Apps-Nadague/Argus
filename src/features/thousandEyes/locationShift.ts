/**
 * ARGOS — expected adaptation per location (prototype `XM`/`XT`/`xo`).
 * A reading is judged after subtracting the shift expected where the person is.
 */

import type { LocationKey } from './types';

/** Microgravity (group 1) vs. partial gravity (group 2). Earth: no shift. */
const LOCATION_GROUP: Partial<Record<LocationKey, 1 | 2>> = {
  leo: 1,
  gate: 1,
  mtr: 1,
  moon: 2,
  mars: 2,
  rov: 2,
};

const GROUP_SHIFTS: Record<1 | 2, Partial<Record<string, number>>> = {
  1: { rhr: -3, sbp: -6, dbp: -4, height: 2, sleep: -0.8, vis: 1, diz: 2, grip: -3, wt: -1.5, back: 1 },
  2: { rhr: -1, sbp: -2, dbp: -1, height: 0.5, sleep: -0.3, diz: 1, grip: -1 },
};

export function expectedShift(env: LocationKey | undefined, key: string): number {
  const g = env ? LOCATION_GROUP[env] : undefined;
  return (g && GROUP_SHIFTS[g][key]) || 0;
}

export const LOCATION_LABEL: Record<LocationKey, string> = {
  earth: 'Earth',
  eartha: 'Earth',
  leo: 'Space station (LEO)',
  gate: 'Lunar Gateway',
  mtr: 'Mars transit',
  moon: 'Lunar surface',
  mars: 'Mars surface',
  rov: 'Mars rover',
};
