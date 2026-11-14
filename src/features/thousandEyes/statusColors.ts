/**
 * ARGOS — status -> colour / text / icon. The only place these are defined.
 * Colour is never the only signal: every status also has a word and a symbol.
 */

import type { Status } from './types';

export const STATUS_HEX = {
  ok: '#3ddc97',
  warn: '#ffb020',
  critical: '#ff4d5e',
  none: '#4a5666',
} as const;

export interface StatusStyle {
  color: string;
  text: string;
  /** Short symbol for non-colour cue. */
  symbol: string;
}

export function statusStyle(status: Status | undefined): StatusStyle {
  switch (status) {
    case 0:
      return { color: STATUS_HEX.ok, text: 'On baseline', symbol: '●' };
    case 1:
      return { color: STATUS_HEX.warn, text: 'Drifting', symbol: '▲' };
    case 2:
      return { color: STATUS_HEX.critical, text: 'RED FLAG', symbol: '!' };
    default:
      return { color: STATUS_HEX.none, text: 'No data', symbol: '–' };
  }
}

/** Readiness 0–100 -> colour (high = ok). Prototype `col`/`hexc`. */
export function readinessColor(score: number | null): string {
  if (score == null) return STATUS_HEX.none;
  if (score >= 80) return STATUS_HEX.ok;
  if (score >= 60) return STATUS_HEX.warn;
  return STATUS_HEX.critical;
}
