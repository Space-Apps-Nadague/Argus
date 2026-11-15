import { describe, expect, it } from 'vitest';
import { commDelayForEnvironment } from '../../data/spaceLocations';
import {
  calculateCrewReadinessScore,
  ENVIRONMENT_META,
  ENVIRONMENT_ORDER,
  evaluateAllZones,
  evaluateMetricStatus,
  formatFlightNormBadge,
  getMetricThreshold,
} from '../triageEngine';
import {
  LOCATION_ENVIRONMENT,
  SPACE_LOCATIONS,
  environmentForLocation,
} from '../../data/spaceLocations';
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

  describe('Issue #21: Multi-environment support & dynamic location/gravity presets (REQ-07)', () => {
    it('defines all 5 canonical location presets in ENVIRONMENT_META and ENVIRONMENT_ORDER', () => {
      expect(ENVIRONMENT_ORDER).toEqual([
        'iss_leo',
        'lunar_base',
        '0g_transit',
        'mars_base',
        'earth_1g',
      ]);

      expect(ENVIRONMENT_META.iss_leo).toMatchObject({
        label: 'ISS Low Earth Orbit',
        shortLabel: 'ISS (LEO)',
        gravityG: '0.00g',
        commDelay: `${commDelayForEnvironment('iss_leo')} ONE-WAY`,
      });

      expect(ENVIRONMENT_META.lunar_base).toMatchObject({
        label: 'Artemis Lunar Base (1/6g)',
        shortLabel: 'Lunar Base',
        gravityG: '0.16g',
        commDelay: `${commDelayForEnvironment('lunar_base')} ONE-WAY`,
      });

      expect(ENVIRONMENT_META['0g_transit']).toMatchObject({
        label: '0g Deep-Space Transit',
        shortLabel: '0g Transit',
        gravityG: '0.00g',
        commDelay: `${commDelayForEnvironment('0g_transit')} ONE-WAY`,
      });

      expect(ENVIRONMENT_META.mars_base).toMatchObject({
        label: 'Mars Surface Base (3/8g)',
        shortLabel: 'Mars Base',
        gravityG: '0.38g',
        commDelay: `${commDelayForEnvironment('mars_base')} ONE-WAY`,
      });

      expect(ENVIRONMENT_META.earth_1g).toMatchObject({
        label: 'Earth Surface (1.00g)',
        shortLabel: 'Earth (1.00g)',
        gravityG: '1.00g',
        commDelay: `${commDelayForEnvironment('earth_1g')} ONE-WAY`,
      });
    });

    it('returns gravity- and location-adjusted metric thresholds', () => {
      // ONSD cephalad fluid shift thresholds:
      const onsd0g = getMetricThreshold('onsd', '0g_transit');
      const onsdLunar = getMetricThreshold('onsd', 'lunar_base');
      const onsdMars = getMetricThreshold('onsd', 'mars_base');
      const onsdEarth = getMetricThreshold('onsd', 'earth_1g');

      expect(onsd0g).toEqual({ nominalMin: 4.5, nominalMax: 5.5, yellowMin: 4.2, yellowMax: 5.9 });
      expect(onsdLunar).toEqual({ nominalMin: 4.3, nominalMax: 5.3, yellowMin: 4.0, yellowMax: 5.7 });
      expect(onsdMars).toEqual({ nominalMin: 4.1, nominalMax: 5.1, yellowMin: 3.8, yellowMax: 5.5 });
      expect(onsdEarth).toEqual({ nominalMin: 4.0, nominalMax: 5.0, yellowMin: 3.8, yellowMax: 5.3 });

      // ARED resistance load thresholds:
      const ared0g = getMetricThreshold('ared_load', '0g_transit');
      const aredLunar = getMetricThreshold('ared_load', 'lunar_base');
      const aredMars = getMetricThreshold('ared_load', 'mars_base');
      const aredEarth = getMetricThreshold('ared_load', 'earth_1g');

      expect(ared0g).toEqual({ nominalMin: 18, nominalMax: 30, yellowMin: 12, yellowMax: 35 });
      expect(aredLunar).toEqual({ nominalMin: 14, nominalMax: 26, yellowMin: 10, yellowMax: 30 });
      expect(aredMars).toEqual({ nominalMin: 12, nominalMax: 24, yellowMin: 8, yellowMax: 28 });
      expect(aredEarth).toEqual({ nominalMin: 0, nominalMax: 16, yellowMin: 0, yellowMax: 24 });

      // Radiation dose rate thresholds (mSv/d):
      const radIss = getMetricThreshold('rad_dose', 'iss_leo');
      const rad0g = getMetricThreshold('rad_dose', '0g_transit');
      const radLunar = getMetricThreshold('rad_dose', 'lunar_base');
      const radMars = getMetricThreshold('rad_dose', 'mars_base');
      const radEarth = getMetricThreshold('rad_dose', 'earth_1g');

      expect(radIss).toEqual({ nominalMin: 0.2, nominalMax: 0.6, yellowMin: 0.0, yellowMax: 1.2 });
      expect(rad0g).toEqual({ nominalMin: 0.4, nominalMax: 1.2, yellowMin: 0.0, yellowMax: 2.5 });
      expect(radLunar).toEqual({ nominalMin: 0.3, nominalMax: 0.9, yellowMin: 0.0, yellowMax: 2.0 });
      expect(radMars).toEqual({ nominalMin: 0.3, nominalMax: 0.8, yellowMin: 0.0, yellowMax: 1.8 });
      expect(radEarth).toEqual({ nominalMin: 0.0, nominalMax: 0.05, yellowMin: 0.0, yellowMax: 0.1 });

      // Cabin CO2 and BMD Delta on Earth:
      const co2Earth = getMetricThreshold('cabin_co2', 'earth_1g');
      expect(co2Earth).toEqual({ nominalMin: 0.0, nominalMax: 1.0, yellowMin: 0.0, yellowMax: 2.0 });

      const bmdEarth = getMetricThreshold('bmd_delta', 'earth_1g');
      expect(bmdEarth).toEqual({ nominalMin: -0.2, nominalMax: 0.2, yellowMin: -0.5, yellowMax: 0.5 });
    });

    it('evaluates metric status dynamically based on the active gravity environment', () => {
      // 5.3 mm ONSD is nominal in 0g_transit, but elevated (yellow) on Mars and Earth
      expect(evaluateMetricStatus('onsd', 5.3, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('onsd', 5.3, 'iss_leo')).toBe('green');
      expect(evaluateMetricStatus('onsd', 5.3, 'lunar_base')).toBe('green');
      expect(evaluateMetricStatus('onsd', 5.3, 'mars_base')).toBe('yellow');
      expect(evaluateMetricStatus('onsd', 5.3, 'earth_1g')).toBe('yellow');

      // 15 kN·reps ARED load is yellow (under-exercised) in 0g transit, but green on Moon, Mars, and Earth
      expect(evaluateMetricStatus('ared_load', 15, '0g_transit')).toBe('yellow');
      expect(evaluateMetricStatus('ared_load', 15, 'lunar_base')).toBe('green');
      expect(evaluateMetricStatus('ared_load', 15, 'mars_base')).toBe('green');
      expect(evaluateMetricStatus('ared_load', 15, 'earth_1g')).toBe('green');

      // 0.8 mSv/d radiation is nominal in 0g deep space and lunar base, but elevated on ISS and critical on Earth
      expect(evaluateMetricStatus('rad_dose', 0.8, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('rad_dose', 0.8, 'iss_leo')).toBe('yellow');
      expect(evaluateMetricStatus('rad_dose', 0.8, 'lunar_base')).toBe('green');
      expect(evaluateMetricStatus('rad_dose', 1.0, 'mars_base')).toBe('yellow');
      expect(evaluateMetricStatus('rad_dose', 0.3, 'earth_1g')).toBe('red');

      // 1.5 mmHg cabin CO2 is nominal in space ECLSS, but elevated on Earth
      expect(evaluateMetricStatus('cabin_co2', 1.5, '0g_transit')).toBe('green');
      expect(evaluateMetricStatus('cabin_co2', 1.5, 'earth_1g')).toBe('yellow');
    });

    it('formats flight norm badges using the active location shortLabel', () => {
      expect(formatFlightNormBadge('onsd', 'mm', 'iss_leo')).toBe('ISS (LEO) Norm: 4.5–5.5 mm');
      expect(formatFlightNormBadge('onsd', 'mm', 'lunar_base')).toBe('Lunar Base Norm: 4.3–5.3 mm');
      expect(formatFlightNormBadge('onsd', 'mm', '0g_transit')).toBe('0g Transit Norm: 4.5–5.5 mm');
      expect(formatFlightNormBadge('onsd', 'mm', 'mars_base')).toBe('Mars Base Norm: 4.1–5.1 mm');
      expect(formatFlightNormBadge('onsd', 'mm', 'earth_1g')).toBe('Earth (1.00g) Norm: 4–5 mm');
    });

    it('tailors offline flight surgeon guidance hazard context to the active environment', () => {
      const g0g = getOfflineFlightSurgeonGuidance('nominal', 'neuro', '0g_transit');
      expect(g0g.hazardContextSummary).toContain(`${commDelayForEnvironment('0g_transit')} one-way Earth comm delay`);

      const gIss = getOfflineFlightSurgeonGuidance('nominal', 'neuro', 'iss_leo');
      expect(gIss.hazardContextSummary).toContain('real-time comm link to Mission Control');

      const gLunar = getOfflineFlightSurgeonGuidance('nominal', 'neuro', 'lunar_base');
      expect(gLunar.hazardContextSummary).toContain(`${commDelayForEnvironment('lunar_base')} one-way Earth comm delay`);

      const gMars = getOfflineFlightSurgeonGuidance('nominal', 'neuro', 'mars_base');
      expect(gMars.hazardContextSummary).toContain(`${commDelayForEnvironment('mars_base')} one-way Earth comm delay`);

      const gEarth = getOfflineFlightSurgeonGuidance('nominal', 'neuro', 'earth_1g');
      expect(gEarth.hazardContextSummary).toContain('1.00g terrestrial gravity');
      expect(gEarth.hazardContextSummary).toContain('on-site real-time medical support');
    });

    it('re-evaluates all zones and readiness score when environment switches', () => {
      // In nominal scenario, check if readiness score is calculated deterministically across environments
      const issScore = calculateCrewReadinessScore(TELEMETRY_SCENARIOS.nominal.zones, 'iss_leo');
      const marsScore = calculateCrewReadinessScore(TELEMETRY_SCENARIOS.nominal.zones, 'mars_base');
      const transitScore = calculateCrewReadinessScore(TELEMETRY_SCENARIOS.nominal.zones, '0g_transit');
      const earthScore = calculateCrewReadinessScore(TELEMETRY_SCENARIOS.nominal.zones, 'earth_1g');

      expect(transitScore).toBe(98);
      expect(issScore).toBeGreaterThanOrEqual(15);
      expect(marsScore).toBeGreaterThanOrEqual(15);
      expect(earthScore).toBeGreaterThanOrEqual(15);
    });
  });

  describe('Issue #25: Earth (1.00g) pre/post-flight location & gravity preset', () => {
    it('maps earth_pre and earth_post locations to earth_1g environment in LOCATION_ENVIRONMENT', () => {
      expect(LOCATION_ENVIRONMENT.earth_pre).toBe('earth_1g');
      expect(LOCATION_ENVIRONMENT.earth_post).toBe('earth_1g');
      expect(environmentForLocation('earth_pre')).toBe('earth_1g');
      expect(environmentForLocation('earth_post')).toBe('earth_1g');
    });

    it('configures 1.00g gravityLabel and shielded radiation on earth_pre and earth_post locations', () => {
      expect(SPACE_LOCATIONS.earth_pre.gravityLabel).toBe('1.00g');
      expect(SPACE_LOCATIONS.earth_post.gravityLabel).toBe('1.00g');
      expect(SPACE_LOCATIONS.earth_pre.gravityG).toBe(1);
      expect(SPACE_LOCATIONS.earth_post.gravityG).toBe(1);
      expect(SPACE_LOCATIONS.earth_pre.radiation).toBe('shielded');
      expect(SPACE_LOCATIONS.earth_post.radiation).toBe('shielded');
      expect(SPACE_LOCATIONS.earth_pre.commDelaySec).toEqual([0, 0]);
      expect(SPACE_LOCATIONS.earth_post.commDelaySec).toEqual([0, 0]);
    });
  });
});
