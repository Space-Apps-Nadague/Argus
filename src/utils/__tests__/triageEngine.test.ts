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
import {
  createSculptedHeadAndNeckGeometry,
  createSculptedTorsoGeometry,
} from '../anatomicalGeometry';

describe('ARGUS Deterministic Triage Engine (specs/01-data-schema.md)', () => {
  it('evaluates ONSD thresholds accurately in 0g_transit microgravity', () => {
    // 5.4 mm is nominal in 0g_transit (4.5-5.5), 5.7 mm is yellow (4.2-5.9), 6.42 mm (SANS alert) is red
    expect(evaluateMetricStatus('onsd', 5.4, '0g_transit')).toBe('green');
    expect(evaluateMetricStatus('onsd', 5.7, '0g_transit')).toBe('yellow');
    expect(evaluateMetricStatus('onsd', 6.42, '0g_transit')).toBe('red');
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
      sex: 'male' as const,
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

  it('differentiates male and female 3D sculpted anatomical geometries', () => {
    const sexes = new Set(DEFAULT_CREW_ROSTER.map((c) => c.sex));
    expect(sexes.has('female')).toBe(true);
    expect(sexes.has('male')).toBe(true);

    const femaleTorso = createSculptedTorsoGeometry('female');
    const maleTorso = createSculptedTorsoGeometry('male');
    femaleTorso.computeBoundingBox();
    maleTorso.computeBoundingBox();

    const femaleWidth =
      femaleTorso.boundingBox!.max.x - femaleTorso.boundingBox!.min.x;
    const maleWidth =
      maleTorso.boundingBox!.max.x - maleTorso.boundingBox!.min.x;

    // Male biacromial shoulder span is wider than female torso max width
    expect(maleWidth).toBeGreaterThan(femaleWidth);

    const femaleHead = createSculptedHeadAndNeckGeometry('female');
    const maleHead = createSculptedHeadAndNeckGeometry('male');
    expect(femaleHead.attributes.position.count).toBeGreaterThan(1000);
    expect(maleHead.attributes.position.count).toBeGreaterThan(1000);
  });

  describe('Issue #1: Interactive vital logging & 5 new metrics thresholds', () => {
    it('evaluates systolic_bp (cardio) thresholds deterministically', () => {
      // Nominal: 100-130, Yellow: 90-140, Red: <90 or >140
      expect(evaluateMetricStatus('systolic_bp', 118, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('systolic_bp', 100, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('systolic_bp', 130, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('systolic_bp', 135, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('systolic_bp', 95, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('systolic_bp', 85, '0g_transit')).toBe('red');
      expect(evaluateMetricStatus('systolic_bp', 150, '0g_transit')).toBe('red');
    });

    it('evaluates blood_glucose (musculo) thresholds deterministically', () => {
      // Nominal: 70-110, Yellow: 60-140, Red: <60 or >140
      expect(evaluateMetricStatus('blood_glucose', 92, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('blood_glucose', 70, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('blood_glucose', 110, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('blood_glucose', 125, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('blood_glucose', 65, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('blood_glucose', 55, '0g_transit')).toBe('red');
      expect(evaluateMetricStatus('blood_glucose', 155, '0g_transit')).toBe('red');
    });

    it('evaluates core_temp (immune) thresholds deterministically', () => {
      // Nominal: 36.5-37.5, Yellow: 36.0-38.0, Red: <36.0 or >38.0
      expect(evaluateMetricStatus('core_temp', 37.0, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('core_temp', 36.5, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('core_temp', 37.5, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('core_temp', 37.8, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('core_temp', 36.2, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('core_temp', 35.8, '0g_transit')).toBe('red');
      expect(evaluateMetricStatus('core_temp', 38.6, '0g_transit')).toBe('red');
    });

    it('evaluates daily_sleep_hours (behavioral) thresholds deterministically', () => {
      // Nominal: 7.0-9.0, Yellow: 6.0-10.0, Red: <6.0 or >10.0
      expect(evaluateMetricStatus('daily_sleep_hours', 7.5, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('daily_sleep_hours', 7.0, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('daily_sleep_hours', 9.0, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('daily_sleep_hours', 6.4, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('daily_sleep_hours', 9.5, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('daily_sleep_hours', 5.2, '0g_transit')).toBe('red');
      expect(evaluateMetricStatus('daily_sleep_hours', 11.0, '0g_transit')).toBe('red');
    });

    it('evaluates mood_index (behavioral) thresholds deterministically', () => {
      // Nominal: 7.0-10.0, Yellow: 5.0-10.0, Red: <5.0
      expect(evaluateMetricStatus('mood_index', 8.5, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('mood_index', 7.0, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('mood_index', 10.0, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('mood_index', 6.0, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('mood_index', 5.0, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('mood_index', 4.2, '0g_transit')).toBe('red');
      expect(evaluateMetricStatus('mood_index', 2.0, '0g_transit')).toBe('red');
    });

    it('contains all 17 canonical metrics across scenarios with 30-day longitudinal series', () => {
      const expectedMetrics = [
        'onsd', 'iop', 'cabin_co2',
        'resting_hr', 'hrv_rmssd', 'spo2', 'systolic_bp',
        'bmd_delta', 'ared_load', 'blood_glucose',
        'rad_dose', 'wbc_lymph', 'core_temp',
        'sleep_eff', 'pvt_lapses', 'daily_sleep_hours', 'mood_index',
      ];

      for (const scenario of Object.values(TELEMETRY_SCENARIOS)) {
        const scenarioMetricIds = Object.values(scenario.zones)
          .flat()
          .map((r) => r.metricId);
        for (const expectedId of expectedMetrics) {
          expect(scenarioMetricIds).toContain(expectedId);
        }
      }
    });
  });
});
