/**
 * Unit tests for deterministic 5-minute CGM curves, trend arrows, and Time-in-Range (SRC-083).
 */

import { describe, expect, it } from 'vitest';
import {
  CGM_POINTS_PER_DAY,
  classifyCgmRate,
  computeCgmTrendArrow,
  computeTimeInRange,
  generateCgm24hCurve,
} from '../cgmMockData';

describe('cgmMockData', () => {
  it('generates 288 deterministic 5-minute points for a 24h window', () => {
    const a = generateCgm24hCurve({ crewId: 'crew-vance', scenarioId: 'nominal', missionDay: 30 });
    const b = generateCgm24hCurve({ crewId: 'crew-vance', scenarioId: 'nominal', missionDay: 30 });
    expect(a).toHaveLength(CGM_POINTS_PER_DAY);
    expect(a[0].timeLabel).toBe('00:00');
    expect(a[a.length - 1].timeLabel).toBe('23:55');
    expect(a).toEqual(b);
  });

  it('produces postprandial peaks above nocturnal baseline and ARED exercise dips', () => {
    const curve = generateCgm24hCurve({ crewId: 'crew-vance', scenarioId: 'nominal', missionDay: 15 });
    const nocturnal = curve.filter((p) => p.eventTag === 'nocturnal').map((p) => p.glucoseMgDl);
    const postprandial = curve.filter((p) => p.eventTag === 'postprandial').map((p) => p.glucoseMgDl);
    const ared = curve.filter((p) => p.eventTag === 'ared_dip').map((p) => p.glucoseMgDl);

    expect(nocturnal.length).toBeGreaterThan(20);
    expect(postprandial.length).toBeGreaterThan(20);
    expect(ared.length).toBeGreaterThan(5);

    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    expect(mean(postprandial)).toBeGreaterThan(mean(nocturnal) + 15);
    expect(Math.min(...ared)).toBeLessThan(mean(nocturnal));
  });

  it('classifies all 7 standard CGM rate-of-change trend arrows', () => {
    expect(classifyCgmRate(3.4).arrow).toBe('↑↑');
    expect(classifyCgmRate(2.2).arrow).toBe('↑');
    expect(classifyCgmRate(1.3).arrow).toBe('↗');
    expect(classifyCgmRate(0.2).arrow).toBe('→');
    expect(classifyCgmRate(-1.4).arrow).toBe('↘');
    expect(classifyCgmRate(-2.5).arrow).toBe('↓');
    expect(classifyCgmRate(-3.2).arrow).toBe('↓↓');
  });

  it('computes trend arrow from recent 15-minute CGM window', () => {
    const rising = [
      { minuteOfDay: 0, glucoseMgDl: 90 },
      { minuteOfDay: 5, glucoseMgDl: 100 },
      { minuteOfDay: 10, glucoseMgDl: 112 },
      { minuteOfDay: 15, glucoseMgDl: 125 },
    ];
    const trend = computeCgmTrendArrow(rising, 15);
    expect(trend.arrow).toBe('↑');
    expect(trend.rateMgDlPerMin).toBeCloseTo(2.33, 2);
  });

  it('computes Time-in-Range (70–140 mg/dL) percentages and deterministic triage status', () => {
    const allInRange = Array.from({ length: 10 }, () => ({ glucoseMgDl: 100 }));
    expect(computeTimeInRange(allInRange)).toMatchObject({
      percentInRange: 100,
      percentBelow: 0,
      percentAbove: 0,
      status: 'green',
    });

    const mixed = [
      { glucoseMgDl: 62 },
      { glucoseMgDl: 65 },
      { glucoseMgDl: 95 },
      { glucoseMgDl: 105 },
      { glucoseMgDl: 115 },
      { glucoseMgDl: 125 },
      { glucoseMgDl: 152 },
      { glucoseMgDl: 165 },
      { glucoseMgDl: 170 },
      { glucoseMgDl: 180 },
    ];
    const tir = computeTimeInRange(mixed);
    expect(tir.percentInRange).toBe(40);
    expect(tir.percentBelow).toBe(20);
    expect(tir.percentAbove).toBe(40);
    expect(tir.status).toBe('red');
  });
});
