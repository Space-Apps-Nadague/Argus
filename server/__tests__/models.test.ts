import { describe, expect, it } from 'vitest';
import type { VitalSignReading } from '../../src/types/argus';
import type { WellbeingCheckIn } from '../../src/types/aiApi';
import { getCrewAdjustedZones } from '../../src/data/telemetryScenarios';
import { analyzeMetricTrend, daysUntilRed, linearRegression } from '../models/trendModels';
import { evaluateDiagnosticRules, maxUrgency, urgencyFloor } from '../models/diagnosticsRules';
import { buildCrewSnapshot } from '../models/crewSnapshot';
import { buildOfflinePlan } from '../models/countermeasureLibrary';
import { computeWellbeing, demoCheckIns, detectCrisisLanguage } from '../models/wellbeingModel';

const reading = (metricId: string, values: number[]): VitalSignReading => ({
  metricId,
  label: metricId,
  unit: 'u',
  currentValue: values[values.length - 1],
  deltaFromBaseline: '',
  flightNormLabel: '',
  plainDescription: '',
  history: values.map((value, i) => ({ missionDay: i + 1, dateLabel: `MD-${i + 1}`, value })),
});

describe('trend models', () => {
  it('fits a straight line exactly', () => {
    expect(linearRegression([1, 2, 3, 4], [2, 4, 6, 8])).toEqual({ slope: 2, intercept: 0 });
  });

  it('flags a steadily rising ONSD as drifting with a days-to-red estimate', () => {
    // ONSD nominal 4.5–5.5, red above 5.9
    const values = Array.from({ length: 20 }, (_, i) => 4.8 + i * 0.04); // ends at 5.56
    const t = analyzeMetricTrend(reading('onsd', values), 'neuro', '0g_transit');
    expect(t.status).toBe('yellow');
    expect(t.level).toBe('drifting');
    expect(t.direction).toBe('up');
    expect(t.slopePerDay).toBeCloseTo(0.04, 3);
    expect(t.daysToRed).toBe(9); // (5.9 - 5.56) / 0.04 = 8.5 → 9
  });

  it('reports a flat nominal metric as steady with no red projection', () => {
    const t = analyzeMetricTrend(reading('spo2', Array(20).fill(98)), 'cardio', '0g_transit');
    expect(t).toMatchObject({ status: 'green', level: 'steady', direction: 'flat', daysToRed: null });
  });

  it('projects toward whichever red band the slope points at', () => {
    expect(daysUntilRed('onsd', 6.4, 0.01)).toBe(0); // already red
    expect(daysUntilRed('onsd', 5.0, -0.02)).toBe(40); // drifting down toward the low red band (4.2)
    expect(daysUntilRed('onsd', 5.0, -0.001)).toBeNull(); // beyond the 60-day horizon
    expect(daysUntilRed('onsd', 5.0, 0)).toBeNull(); // flat
  });
});

describe('diagnostic rules', () => {
  it('ranks SANS first in the SANS scenario', () => {
    const snapshot = buildCrewSnapshot({ scenarioId: 'sans_alert' });
    const hypotheses = evaluateDiagnosticRules(snapshot.trends);
    expect(hypotheses[0].id).toBe('sans');
    expect(hypotheses[0].supportingMetricIds).toContain('onsd');
    expect(hypotheses[0].likelihood).toBe('high');
  });

  it.each([
    ['solar_storm', 'radiation'],
    ['high_co2', 'hypercapnia'],
  ] as const)('ranks the root cause first in %s', (scenarioId, expected) => {
    const snapshot = buildCrewSnapshot({ scenarioId });
    expect(evaluateDiagnosticRules(snapshot.trends)[0].id).toBe(expected);
  });

  it('reports nothing above "low" in the nominal scenario', () => {
    const snapshot = buildCrewSnapshot({ scenarioId: 'nominal' });
    expect(evaluateDiagnosticRules(snapshot.trends).every((h) => h.likelihood === 'low')).toBe(true);
  });

  it('never lets the LLM lower urgency below the deterministic floor', () => {
    const floor = urgencyFloor({ neuro: 'red', cardio: 'green', musculo: 'green', immune: 'green', behavioral: 'green' });
    expect(floor).toBe('immediate_emergency_packet');
    expect(maxUrgency('routine_downlink', floor)).toBe('immediate_emergency_packet');
  });

  it('overlays telemetryCheckIns via applyCheckIns before triage and trends', () => {
    const baseline = buildCrewSnapshot({ scenarioId: 'nominal' });
    expect(baseline.zoneStatuses.neuro).toBe('green');

    const withCheckIn = buildCrewSnapshot({
      scenarioId: 'nominal',
      telemetryCheckIns: [
        {
          id: 'ci-test-1',
          crewId: 'crew-1',
          missionDay: 30,
          timestampIso: '2026-11-14T10:00:00.000Z',
          values: { onsd: 6.4 },
        },
      ],
    });
    expect(withCheckIn.zoneStatuses.neuro).toBe('red');
    expect(withCheckIn.readinessScore).toBeLessThan(baseline.readinessScore);
    const onsdTrend = withCheckIn.trends.find((t) => t.metricId === 'onsd');
    expect(onsdTrend?.currentValue).toBe(6.4);
    expect(onsdTrend?.status).toBe('red');
  });
});

describe('countermeasure library', () => {
  it('puts red-band metrics first with priority "now"', () => {
    const snapshot = buildCrewSnapshot({ scenarioId: 'sans_alert' });
    const plan = buildOfflinePlan(snapshot.flaggedTrends);
    expect(plan[0].priority).toBe('now');
    expect(plan.some((r) => r.category === 'exercise')).toBe(true);
  });
});

describe('wellbeing model', () => {
  const zones = getCrewAdjustedZones('nominal');

  it('scores a steady crew member green', () => {
    const r = computeWellbeing(demoCheckIns('c1'), zones);
    expect(r.status).toBe('green');
    expect(r.crisisFlag).toBe(false);
  });

  it('detects a declining fortnight as worsening and raises risk', () => {
    const steady = computeWellbeing(demoCheckIns('c1'), zones);
    const declining = computeWellbeing(demoCheckIns('c1', 30, true), zones);
    expect(declining.trend).toBe('worsening');
    expect(declining.riskScore).toBeGreaterThan(steady.riskScore);
  });

  it('marks very low check-ins red', () => {
    const low: WellbeingCheckIn[] = [28, 29, 30].map((d) => ({
      id: `x${d}`,
      crewId: 'c1',
      missionDay: d,
      timestampIso: '',
      mood: 1,
      stress: 5,
      energy: 1,
      sleepQuality: 1,
      cohesion: 2,
      motivation: 1,
    }));
    expect(computeWellbeing(low, zones).status).toBe('red');
  });

  it('forces red + emergency on crisis language, even with good scores', () => {
    const checkIns = demoCheckIns('c1');
    checkIns[checkIns.length - 1].note = 'Honestly some days I want to die out here.';
    const r = computeWellbeing(checkIns, zones);
    expect(r).toMatchObject({ crisisFlag: true, status: 'red', earthConsultUrgency: 'immediate_emergency_packet' });
  });
});

describe('crisis-language detector', () => {
  it.each([
    'I keep thinking about suicide',
    "I don't want to wake up anymore",
    'thinking about hurting myself',
    'אני רוצה למות',
  ])('detects: %s', (text) => {
    expect(detectCrisisLanguage(text).crisis).toBe(true);
  });

  it.each(['this experiment is killing me lol', 'my legs are dead tired after ARED', 'the CO2 scrubber died again'])(
    'does not flag ordinary venting: %s',
    (text) => {
      expect(detectCrisisLanguage(text).crisis).toBe(false);
    }
  );
});
