import { describe, expect, it } from 'vitest';
import { earthClock, missionAreaClock } from '../dualClock';
import { SPACE_LOCATIONS } from '../spaceLocations';

const NOW = new Date(Date.UTC(2026, 10, 14, 18, 30, 0)); // 12:30 in Houston (CST, UTC-6)

describe('earthClock', () => {
  it('shows Houston time', () => {
    const e = earthClock(NOW);
    expect(e.label).toBe('Earth · Houston');
    expect(e.time.startsWith('12:30:00')).toBe(true);
  });
});

describe('missionAreaClock', () => {
  it('is hidden on Earth', () => {
    expect(missionAreaClock(SPACE_LOCATIONS.earth_pre, NOW)).toBeNull();
    expect(missionAreaClock(SPACE_LOCATIONS.earth_post, NOW)).toBeNull();
  });
  it('shows Mars time on Mars and in the rover', () => {
    for (const id of ['mars_surface', 'rover'] as const) {
      const m = missionAreaClock(SPACE_LOCATIONS[id], NOW)!;
      expect(m.label).toBe('Mars');
      expect(m.time).toMatch(/^MTC \d{2}:\d{2}$/);
      expect(m.detail).toMatch(/^Sol /);
    }
  });
  it('shows Moon time on the Moon and at the Gateway', () => {
    for (const id of ['lunar_surface', 'gateway'] as const) {
      const m = missionAreaClock(SPACE_LOCATIONS[id], NOW)!;
      expect(m.label).toBe('Moon');
      expect(m.time).toMatch(/^Day \d+\.\d \/ 29\.5$/);
    }
  });
  it('shows station time in LEO and ship time in transit', () => {
    expect(missionAreaClock(SPACE_LOCATIONS.leo, NOW)!.label).toBe('Station');
    expect(missionAreaClock(SPACE_LOCATIONS.mars_transit, NOW)!.label).toBe('Ship');
  });
});
