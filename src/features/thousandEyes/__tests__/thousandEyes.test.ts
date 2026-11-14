import { describe, expect, it } from 'vitest';
import {
  BODY_SYSTEM_ORDER,
  INDICATOR_MAP,
  THOUSAND_EYES_INDICATORS,
  computeDeviationIndex,
  computePersonalBaseline,
  computePersonalReadiness,
  computeRedFlagCount,
  evaluateAllIndicators,
  evaluateIndicator,
  findHiddenLinks,
  getExpectedShift,
  getTipForStat,
  zonesToSeriesMap,
} from '../index';
import type { BodyZoneId, VitalSignReading } from '../../../types/argus';
import type { ThousandEyesSeriesMap } from '../types';

describe('Thousand Eyes indicator catalog', () => {
  it('contains all 31 indicators ordered by body system', () => {
    expect(THOUSAND_EYES_INDICATORS).toHaveLength(31);
    const systemIndices = THOUSAND_EYES_INDICATORS.map((i) =>
      BODY_SYSTEM_ORDER.indexOf(i.system)
    );
    for (let i = 1; i < systemIndices.length; i++) {
      expect(systemIndices[i]).toBeGreaterThanOrEqual(systemIndices[i - 1]);
    }
  });

  it('applies NASA HRP-informed location expected shifts', () => {
    expect(getExpectedShift('earth_pre', 'rhr')).toBe(0);
    expect(getExpectedShift('mars_transit', 'rhr')).toBe(-3);
    expect(getExpectedShift('lunar_surface', 'rhr')).toBe(-1);
    expect(getExpectedShift('mars_surface', 'height')).toBe(0.5);
  });
});

describe('Personal baseline & drift evaluation', () => {
  it('returns nodata for indicators without readings', () => {
    const stat = evaluateIndicator(INDICATOR_MAP.grip, undefined, 'mars_transit', 'mis');
    expect(stat.status).toBe('nodata');
    expect(stat.currentValue).toBeNull();
    expect(stat.n).toBe(0);
  });

  it('uses pre-flight readings when available and provisional first-3 otherwise', () => {
    const pre = computePersonalBaseline(
      INDICATOR_MAP.rhr,
      [
        { day: 1, value: 60, phase: 'pre' },
        { day: 2, value: 62, phase: 'pre' },
        { day: 3, value: 64, phase: 'pre' },
        { day: 4, value: 75, phase: 'mis' },
      ],
      'mis'
    );
    expect(pre).not.toBeNull();
    expect(pre!.provisional).toBe(false);
    expect(pre!.mean).toBeCloseTo(62, 5);

    const prov = computePersonalBaseline(
      INDICATOR_MAP.rhr,
      [
        { day: 1, value: 60, phase: 'mis' },
        { day: 2, value: 62, phase: 'mis' },
        { day: 3, value: 64, phase: 'mis' },
        { day: 4, value: 75, phase: 'mis' },
      ],
      'mis'
    );
    expect(prov).not.toBeNull();
    expect(prov!.provisional).toBe(true);
    expect(prov!.mean).toBeCloseTo(62, 5);
  });

  it('requires >= 3 prior in-mission readings for environment indicators', () => {
    const tooShort = computePersonalBaseline(
      INDICATOR_MAP.co2,
      [
        { day: 1, value: 2500, phase: 'mis' },
        { day: 2, value: 2600, phase: 'mis' },
        { day: 3, value: 2700, phase: 'mis' },
      ],
      'mis'
    );
    expect(tooShort).toBeNull();

    const enough = computePersonalBaseline(
      INDICATOR_MAP.co2,
      [
        { day: 1, value: 2500, phase: 'mis' },
        { day: 2, value: 2600, phase: 'mis' },
        { day: 3, value: 2700, phase: 'mis' },
        { day: 4, value: 2800, phase: 'mis' },
      ],
      'mis'
    );
    expect(enough).not.toBeNull();
    expect(enough!.n).toBe(3);
  });

  it('subtracts location expected shift before flagging drift', () => {
    // At mars_transit, rhr expectedShift is -3 bpm. Baseline 63 -> expected 60.
    // Reading 60 bpm is right on expected, so it should be nominal.
    const stat = evaluateIndicator(
      INDICATOR_MAP.rhr,
      [
        { day: 1, value: 63, phase: 'pre' },
        { day: 2, value: 63, phase: 'pre' },
        { day: 3, value: 63, phase: 'pre' },
        { day: 4, value: 60, phase: 'mis' },
        { day: 5, value: 60, phase: 'mis' },
      ],
      'mars_transit',
      'mis'
    );
    expect(stat.status).toBe('nominal');
    expect(stat.expectedShift).toBe(-3);
    expect(stat.bad).toBeCloseTo(0, 4);
  });

  it('flags drifting only in the bad direction and flags red_flag on hard limits', () => {
    // HRV is direction 'l' (lower is worse). Rising HRV is NOT drifting.
    const improvingHrv = evaluateIndicator(
      INDICATOR_MAP.hrv,
      [
        { day: 1, value: 50, phase: 'pre' },
        { day: 2, value: 50, phase: 'pre' },
        { day: 3, value: 50, phase: 'pre' },
        { day: 4, value: 75, phase: 'mis' },
        { day: 5, value: 80, phase: 'mis' },
      ],
      'earth_pre',
      'mis'
    );
    expect(improvingHrv.status).toBe('nominal');
    expect(improvingHrv.bad).toBe(0);

    // Falling HRV triggers drifting
    const worseningHrv = evaluateIndicator(
      INDICATOR_MAP.hrv,
      [
        { day: 1, value: 60, phase: 'pre' },
        { day: 2, value: 60, phase: 'pre' },
        { day: 3, value: 60, phase: 'pre' },
        { day: 4, value: 35, phase: 'mis' },
        { day: 5, value: 30, phase: 'mis' },
      ],
      'earth_pre',
      'mis'
    );
    expect(worseningHrv.status).toBe('drifting');

    // SpO2 < 92 triggers red_flag
    const lowSpo2 = evaluateIndicator(
      INDICATOR_MAP.spo2,
      [
        { day: 1, value: 98, phase: 'pre' },
        { day: 2, value: 98, phase: 'pre' },
        { day: 3, value: 98, phase: 'pre' },
        { day: 4, value: 90, phase: 'mis' },
      ],
      'leo',
      'mis'
    );
    expect(lowSpo2.red).toBe(true);
    expect(lowSpo2.status).toBe('red_flag');
  });
});

describe('Readiness, deviation index & hidden links', () => {
  it('returns null readiness and deviation index when no personal indicators have data', () => {
    const stats = evaluateAllIndicators({}, 'mars_transit', 'mis');
    expect(computeDeviationIndex(stats)).toBeNull();
    expect(computePersonalReadiness(stats)).toBeNull();
    expect(computeRedFlagCount(stats)).toBe(0);
  });

  it('computes deviation index and readiness excluding B/X flagged indicators', () => {
    const series: ThousandEyesSeriesMap = {
      rhr: [
        { day: 1, value: 60, phase: 'pre' },
        { day: 2, value: 60, phase: 'pre' },
        { day: 3, value: 60, phase: 'pre' },
        { day: 4, value: 60, phase: 'mis' },
      ],
      // Environment indicator should not affect personal deviation index
      co2: [
        { day: 1, value: 2000, phase: 'mis' },
        { day: 2, value: 2000, phase: 'mis' },
        { day: 3, value: 2000, phase: 'mis' },
        { day: 4, value: 8000, phase: 'mis' },
      ],
    };
    const stats = evaluateAllIndicators(series, 'earth_pre', 'mis');
    expect(computeDeviationIndex(stats)).toBeCloseTo(0, 5);
    expect(computePersonalReadiness(stats)).toBe(100);
  });

  it('detects strong same-day and next-day hidden links across >= 7 days', () => {
    const days = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const series: ThousandEyesSeriesMap = {
      sleep: days.map((d) => ({ day: d, value: 8 - d * 0.3 })),
      hrv: days.map((d) => ({ day: d, value: 65 - d * 2.5 })),
      mood: days.map((d) => ({ day: d, value: 4.5 - (d - 1) * 0.15 })),
      // Environment indicator should be excluded from hidden links
      co2: days.map((d) => ({ day: d, value: 2000 + d * 100 })),
    };

    const links = findHiddenLinks(series);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.from !== 'co2' && l.to !== 'co2')).toBe(true);
    expect(links.every((l) => Math.abs(l.r) >= 0.6 && l.n >= 7)).toBe(true);
  });
});

describe('ARGUS zonesToSeriesMap & tips', () => {
  it('maps real ARGUS readings and leaves unmeasured indicators nodata', () => {
    const emptyReading = (metricId: string, val: number): VitalSignReading => ({
      metricId,
      label: metricId,
      unit: '',
      currentValue: val,
      deltaFromBaseline: '',
      flightNormLabel: '',
      plainDescription: '',
      history: [
        { missionDay: 1, dateLabel: 'MD-1', value: val },
        { missionDay: 2, dateLabel: 'MD-2', value: val },
        { missionDay: 3, dateLabel: 'MD-3', value: val },
        { missionDay: 4, dateLabel: 'MD-4', value: val },
      ],
    });

    const zones: Record<BodyZoneId, VitalSignReading[]> = {
      neuro: [emptyReading('cabin_co2', 1.9)],
      cardio: [emptyReading('resting_hr', 64)],
      musculo: [],
      immune: [],
      behavioral: [emptyReading('mood_index', 8)],
    };

    const series = zonesToSeriesMap(zones);
    expect(series.rhr).toHaveLength(4);
    expect(series.co2?.[0].value).toBe(Math.round((1.9 * 1_000_000) / 760));
    expect(series.mood?.[0].value).toBe(4);
    expect(series.grip).toBeUndefined();

    const stats = evaluateAllIndicators(series, 'mars_transit', 'mis');
    const gripStat = stats.find((s) => s.indicator.id === 'grip')!;
    expect(gripStat.status).toBe('nodata');
    expect(getTipForStat(gripStat).length).toBeGreaterThan(0);
  });
});
