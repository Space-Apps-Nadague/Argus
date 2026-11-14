import { describe, expect, it } from 'vitest';
import {
  computeBaseline,
  computeDrift,
  driftLevel,
  findMetricLinks,
  forecastMetric,
  formatSigma,
  pearson,
} from '../driftAnalytics';
import { TelemetryHistoryPoint } from '../../types/argus';
import { TELEMETRY_SCENARIOS } from '../../data/telemetryScenarios';
import { evaluateAllZones } from '../triageEngine';

const series = (vals: number[]): TelemetryHistoryPoint[] =>
  vals.map((value, i) => ({ missionDay: i + 1, dateLabel: `MD-${i + 1}`, value }));

describe('driftAnalytics', () => {
  it('builds a baseline from the first 7 days with an SD floor', () => {
    const b = computeBaseline('resting_hr', series([60, 60, 60, 60, 60, 60, 60, 90, 95]));
    expect(b).not.toBeNull();
    expect(b!.mean).toBe(60);
    expect(b!.n).toBe(7);
    expect(b!.sd).toBe(3); // flat week → METRIC_TYPICAL_SD floor
  });

  it('flags upward drift with EWMA and level', () => {
    const d = computeDrift('resting_hr', series([60, 61, 59, 60, 61, 59, 60, 64, 68, 72, 76, 80]));
    expect(d!.direction).toBe('up');
    expect(d!.level).toBe('drifting');
    expect(d!.zScore).toBeGreaterThan(5);
  });

  it('stays steady when values hover around baseline', () => {
    const d = computeDrift('spo2', series([97, 98, 97, 98, 97, 98, 97, 98, 97, 98]));
    expect(d!.level).toBe('steady');
    expect(d!.direction).toBe('flat');
  });

  it('maps |ewmaZ| to levels', () => {
    expect(driftLevel(0.4)).toBe('steady');
    expect(driftLevel(-1.2)).toBe('watch');
    expect(driftLevel(2.5)).toBe('drifting');
  });

  it('forecasts a linear trend with widening 90% intervals', () => {
    const f = forecastMetric('onsd', series([4.8, 4.9, 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7]));
    expect(f).toHaveLength(3);
    expect(f![0].missionDay).toBe(11);
    expect(f![0].mean).toBeCloseTo(5.8, 5);
    expect(f![2].mean).toBeCloseTo(6.0, 5);
    const w0 = f![0].upper - f![0].lower;
    const w2 = f![2].upper - f![2].lower;
    expect(w2).toBeGreaterThan(w0);
    expect(f![0].lower).toBeLessThan(f![0].mean);
  });

  it('returns null forecast with fewer than 4 points', () => {
    expect(forecastMetric('onsd', series([4.8, 4.9, 5.0]))).toBeNull();
  });

  it('computes Pearson r', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 6);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('only returns candidate-pair links that pass thresholds', () => {
    const links = findMetricLinks(TELEMETRY_SCENARIOS.high_co2.zones);
    expect(links.length).toBeLessThanOrEqual(5);
    links.forEach((l) => {
      expect(Math.abs(l.r)).toBeGreaterThanOrEqual(0.6);
      expect(l.n).toBeGreaterThanOrEqual(7);
      expect(l.mechanism.length).toBeGreaterThan(0);
      expect(Math.sign(l.r)).toBe(l.expectedSign);
    });
  });

  it('never changes triage status (pure, no mutation of zones)', () => {
    const zones = TELEMETRY_SCENARIOS.sans_alert.zones;
    const before = evaluateAllZones(zones, '0g_transit');
    const snapshot = JSON.stringify(zones);
    findMetricLinks(zones);
    Object.values(zones).flat().forEach((r) => {
      computeDrift(r.metricId, r.history);
      forecastMetric(r.metricId, r.history);
    });
    expect(JSON.stringify(zones)).toBe(snapshot);
    expect(evaluateAllZones(zones, '0g_transit')).toEqual(before);
  });

  it('formats sigma', () => {
    expect(formatSigma(1.84)).toBe('+1.8σ');
    expect(formatSigma(-0.42)).toBe('−0.4σ');
  });
});
