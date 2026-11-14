import { describe, expect, it } from 'vitest';
import { readinessColor, STATUS_HEX, statusStyle } from '../statusColors';

describe('statusStyle', () => {
  it('maps every status to colour, text and a non-colour symbol', () => {
    expect(statusStyle(0)).toEqual({ color: STATUS_HEX.ok, text: 'On baseline', symbol: '●' });
    expect(statusStyle(1)).toEqual({ color: STATUS_HEX.warn, text: 'Drifting', symbol: '▲' });
    expect(statusStyle(2)).toEqual({ color: STATUS_HEX.critical, text: 'RED FLAG', symbol: '!' });
  });
  it('treats missing status as no data (grey)', () => {
    expect(statusStyle(undefined)).toEqual({ color: '#4a5666', text: 'No data', symbol: '–' });
  });
  it('uses the prototype hex values', () => {
    expect(STATUS_HEX).toEqual({ ok: '#3ddc97', warn: '#ffb020', critical: '#ff4d5e', none: '#4a5666' });
  });
});

describe('readinessColor', () => {
  it('follows the prototype thresholds (>=80 ok, >=60 warn, else critical)', () => {
    expect(readinessColor(null)).toBe(STATUS_HEX.none);
    expect(readinessColor(100)).toBe(STATUS_HEX.ok);
    expect(readinessColor(80)).toBe(STATUS_HEX.ok);
    expect(readinessColor(79)).toBe(STATUS_HEX.warn);
    expect(readinessColor(60)).toBe(STATUS_HEX.warn);
    expect(readinessColor(59)).toBe(STATUS_HEX.critical);
  });
});
