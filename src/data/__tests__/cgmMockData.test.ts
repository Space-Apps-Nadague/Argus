import { describe, expect, it } from 'vitest';
import { DEFAULT_CREW_ROSTER } from '../telemetryScenarios';
import {
  CREW_CGM_MOCK_DATA,
  getAllCrewCgmMockData,
  getCrewCgmMockData,
} from '../cgmMockData';

describe('cgmMockData', () => {
  it('provides 24h 5-minute CGM datasets (288 readings) for every default crew member', () => {
    const all = getAllCrewCgmMockData();
    expect(all).toHaveLength(DEFAULT_CREW_ROSTER.length);

    for (const crew of DEFAULT_CREW_ROSTER) {
      const dataset = CREW_CGM_MOCK_DATA[crew.id];
      expect(dataset).toBeDefined();
      expect(dataset.crewId).toBe(crew.id);
      expect(dataset.callsign).toBe(crew.callsign);
      expect(dataset.sampleIntervalMinutes).toBe(5);
      expect(dataset.readings).toHaveLength(288);
    }
  });

  it('keeps glucose values within plausible physiological bounds and summary percentages summing to ~100%', () => {
    for (const dataset of getAllCrewCgmMockData()) {
      for (const reading of dataset.readings) {
        expect(reading.glucoseMgDl).toBeGreaterThanOrEqual(40);
        expect(reading.glucoseMgDl).toBeLessThanOrEqual(400);
        expect(reading.minuteOfDay).toBeGreaterThanOrEqual(0);
        expect(reading.minuteOfDay).toBeLessThan(1440);
      }

      const totalPct = dataset.timeInRangePct + dataset.lowPct + dataset.highPct;
      expect(totalPct).toBeGreaterThanOrEqual(99.5);
      expect(totalPct).toBeLessThanOrEqual(100.5);
    }
  });

  it('is deterministic across repeated calls and differentiates crew metabolic profiles', () => {
    const vanceA = getCrewCgmMockData('crew-vance');
    const vanceB = getCrewCgmMockData('crew-vance');
    const chen = getCrewCgmMockData('crew-chen');
    const okafor = getCrewCgmMockData('crew-okafor');

    expect(vanceA.readings).toEqual(vanceB.readings);
    expect(chen.meanGlucoseMgDl).toBeGreaterThan(vanceA.meanGlucoseMgDl);
    expect(okafor.meanGlucoseMgDl).toBeLessThan(vanceA.meanGlucoseMgDl);
  });
});
