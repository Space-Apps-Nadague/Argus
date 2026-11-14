import { describe, expect, it } from 'vitest';
import { earthMarsDistanceKm, earthMoonDistanceKm, lightSeconds } from '../lightTime';
import { commDelayAt, formatCommDelay, SPACE_LOCATIONS } from '../spaceLocations';

describe('Earth–Mars distance', () => {
  it('matches the 12 Jan 2025 close approach (≈96.1 million km)', () => {
    const km = earthMarsDistanceKm(new Date(Date.UTC(2025, 0, 12)));
    expect(Math.abs(km - 96.1e6)).toBeLessThan(1.5e6);
  });
  it('is near its maximum around the 9 Jan 2026 solar conjunction', () => {
    const km = earthMarsDistanceKm(new Date(Date.UTC(2026, 0, 9)));
    expect(km).toBeGreaterThan(3.4e8);
    expect(km).toBeLessThan(4.0e8);
  });
});

describe('Earth–Moon distance', () => {
  it('matches the 4 Dec 2025 perigee (≈356,960 km)', () => {
    const km = earthMoonDistanceKm(new Date(Date.UTC(2025, 11, 4, 11)));
    expect(Math.abs(km - 356_960)).toBeLessThan(1500);
  });
  it('always stays within the perigee/apogee range', () => {
    for (let d = 0; d < 60; d++) {
      const km = earthMoonDistanceKm(new Date(Date.UTC(2026, 10, 1 + d)));
      expect(km).toBeGreaterThan(355_000);
      expect(km).toBeLessThan(407_500);
    }
  });
});

describe('comm delay', () => {
  const NOW = new Date(Date.UTC(2026, 10, 14, 12));
  it('is a single live value, not a range', () => {
    expect(formatCommDelay(SPACE_LOCATIONS.mars_surface, NOW)).toMatch(/^\d+m \d{2}s$/);
    expect(formatCommDelay(SPACE_LOCATIONS.lunar_surface, NOW)).toMatch(/^1\.\d{2} s$/);
    expect(formatCommDelay(SPACE_LOCATIONS.leo, NOW)).toBe('240 ms');
    expect(formatCommDelay(SPACE_LOCATIONS.earth_pre, NOW)).toBe('0.000 s');
  });
  it('marks Mars transit as an upper bound', () => {
    expect(commDelayAt(SPACE_LOCATIONS.mars_transit, NOW).upTo).toBe(true);
    expect(formatCommDelay(SPACE_LOCATIONS.mars_transit, NOW).startsWith('up to ')).toBe(true);
  });
  it('equals distance / c', () => {
    expect(commDelayAt(SPACE_LOCATIONS.rover, NOW).seconds).toBeCloseTo(lightSeconds(earthMarsDistanceKm(NOW)), 6);
  });
});
