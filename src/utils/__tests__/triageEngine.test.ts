import { describe, expect, it } from 'vitest';
import {
  calculateCrewReadinessScore,
  evaluateAllZones,
  evaluateMetricStatus,
} from '../triageEngine';
import {
  DEFAULT_CREW_ROSTER,
  getCrewAdjustedZones,
  getOfflineFlightSurgeonGuidance,
  TELEMETRY_SCENARIOS,
  VISUAL_EXAM_SAMPLES,
} from '../../data/telemetryScenarios';

describe('ARGUS Deterministic Triage Engine (specs/01-data-schema.md)', () => {
  it('evaluates ONSD thresholds accurately across gravity environments', () => {
    // 5.4 mm is nominal in 0g_transit (4.5-5.5), but yellow in 1_6g_moon (nominal 4.4-5.3) and 3_8g_mars (nominal 4.3-5.2)
    expect(evaluateMetricStatus('onsd', 5.4, '0g_transit')).toBe('green');
    expect(evaluateMetricStatus('onsd', 5.4, '1_6g_moon')).toBe('yellow');
    expect(evaluateMetricStatus('onsd', 5.4, '3_8g_mars')).toBe('yellow');

    // 6.42 mm (SANS alert) is red across all gravity modes
    expect(evaluateMetricStatus('onsd', 6.42, '0g_transit')).toBe('red');
    expect(evaluateMetricStatus('onsd', 6.42, '1_6g_moon')).toBe('red');
    expect(evaluateMetricStatus('onsd', 6.42, '3_8g_mars')).toBe('red');
  });

  it('evaluates all 5 zones as green in the nominal scenario under 0g_transit', () => {
    const statuses = evaluateAllZones(
      TELEMETRY_SCENARIOS.nominal.zones,
      '0g_transit'
    );
    expect(statuses).toEqual({
      neuro: 'green',
      cardio: 'green',
      musculo: 'green',
      immune: 'green',
      behavioral: 'green',
    });
  });

  it('flags neuro as red in sans_alert and immune as red in solar_storm', () => {
    const sansStatuses = evaluateAllZones(
      TELEMETRY_SCENARIOS.sans_alert.zones,
      '0g_transit'
    );
    expect(sansStatuses.neuro).toBe('red');

    const speStatuses = evaluateAllZones(
      TELEMETRY_SCENARIOS.solar_storm.zones,
      '0g_transit'
    );
    expect(speStatuses.immune).toBe('red');
  });

  it('calculates deterministic Crew Readiness Score and rewards completed countermeasure steps', () => {
    const nominalScore = calculateCrewReadinessScore(
      TELEMETRY_SCENARIOS.nominal.zones,
      '0g_transit',
      0
    );
    expect(nominalScore).toBe(98);

    const co2BaseScore = calculateCrewReadinessScore(
      TELEMETRY_SCENARIOS.high_co2.zones,
      '0g_transit',
      0
    );
    const co2WithCountermeasures = calculateCrewReadinessScore(
      TELEMETRY_SCENARIOS.high_co2.zones,
      '0g_transit',
      3
    );
    expect(co2BaseScore).toBeLessThan(70);
    expect(co2WithCountermeasures).toBe(co2BaseScore + 9);
  });

  it('provides 30 days of telemetry history for every zone metric and offline guidance + 3 visual samples', () => {
    for (const scenario of Object.values(TELEMETRY_SCENARIOS)) {
      for (const readings of Object.values(scenario.zones)) {
        for (const metric of readings) {
          expect(metric.history).toHaveLength(30);
        }
      }
    }

    const guidance = getOfflineFlightSurgeonGuidance(
      'sans_alert',
      'neuro',
      '0g_transit'
    );
    expect(guidance.triageStatus).toBe('red');
    expect(guidance.guidedSteps.length).toBeGreaterThanOrEqual(2);
    expect(VISUAL_EXAM_SAMPLES).toHaveLength(3);
  });

  it('adjusts telemetry series deterministically for custom crew member baselines', () => {
    expect(DEFAULT_CREW_ROSTER.length).toBeGreaterThanOrEqual(4);

    const customMember = {
      id: 'crew-custom-test',
      name: 'Dr. Jonas Vasquez',
      callsign: 'ORION',
      role: 'Payload & Science Specialist',
      age: 38,
      bloodType: 'A+' as const,
      restingHrBaselineBpm: 71, // +10 bpm vs 61 bpm reference
      preFlightOnsdMm: 5.3,     // +0.5 mm vs 4.8 mm reference
      missionDaysLogged: 90,
      countermeasureStreakSols: 14,
      defaultScenarioId: 'nominal' as const,
      medicalNotes: 'Elevated baseline optic nerve sheath diameter.',
      isCustom: true,
    };

    const adjusted = getCrewAdjustedZones('nominal', customMember);
    const onsdReading = adjusted.neuro.find((r) => r.metricId === 'onsd')!;
    const hrReading = adjusted.cardio.find((r) => r.metricId === 'resting_hr')!;

    // Nominal ONSD is 5.1 mm; with +0.5 mm offset it becomes 5.6 mm (which shifts neuro from green to yellow in 0g_transit!)
    expect(onsdReading.currentValue).toBe(5.6);
    expect(hrReading.currentValue).toBe(71);

    const statuses = evaluateAllZones(adjusted, '0g_transit');
    expect(statuses.neuro).toBe('yellow');
  });
});
