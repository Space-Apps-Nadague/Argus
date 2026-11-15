import { describe, expect, it } from 'vitest';
import type { BodyZoneId, SpaceLocationId, TriageStatus, VitalSignReading } from '../../../types/argus';
import { EXERCISES, exercisesFor, GRAVITY_EXERCISES, MICROGRAVITY_EXERCISES, settingNote } from '../exercises';
import { environmentForLocation, SPACE_LOCATIONS } from '../../../data/spaceLocations';
import { recommendTraining, trainingIntensity } from '../recommend';

const r = (metricId: string, value: number, label = metricId, unit = 'u'): VitalSignReading => ({
  metricId,
  label,
  unit,
  currentValue: value,
  deltaFromBaseline: '',
  flightNormLabel: '',
  plainDescription: '',
  history: [{ missionDay: 1, dateLabel: 'D1', value }],
});

const zones = (over: Partial<Record<BodyZoneId, VitalSignReading[]>> = {}): Record<BodyZoneId, VitalSignReading[]> => ({
  neuro: [],
  cardio: [r('spo2', 98), r('resting_hr', 60), r('hrv_rmssd', 60)],
  musculo: [r('bmd_delta', 0), r('ared_load', 20)],
  metabolic: [],
  immune: [r('core_temp', 36.8)],
  behavioral: [],
  ...over,
});
const green: Record<BodyZoneId, TriageStatus> = { neuro: 'green', cardio: 'green', musculo: 'green', metabolic: 'green', immune: 'green', behavioral: 'green' };

describe('recommendTraining', () => {
  it('uses ISS devices in microgravity and body-weight exercises with gravity', () => {
    expect(exercisesFor('0g_transit')).toEqual(MICROGRAVITY_EXERCISES);
    expect(exercisesFor('iss_leo')).toEqual(MICROGRAVITY_EXERCISES);
    expect(exercisesFor('mars_base')).toContain('pushups');
    expect(exercisesFor('0g_transit')).not.toContain('pushups');
  });

  it('needs no extra training when muscle, bone and heart metrics are in range', () => {
    expect(recommendTraining(zones(), green, '0g_transit')).toEqual({ state: 'optional', reasons: [], exercises: [], intensity: 'full', intensityReasons: [], skip: [], skipReasons: {}, notes: [] });
  });

  it('requires ARED work in microgravity when bone density drops', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 20)] }), { ...green, musculo: 'yellow' }, '0g_transit');
    expect(plan.state).toBe('required');
    expect(plan.exercises).toEqual(expect.arrayContaining(['aredSquat', 'aredDeadlift', 'aredHeelRaise', 'treadmill']));
    expect(plan.exercises).not.toContain('pushups');
    expect(plan.reasons.map((x) => x.metricId)).toEqual(['bmd_delta', 'musculo']);
  });

  it('requires body-weight exercises on Mars when bone density drops', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 20)] }), { ...green, musculo: 'yellow' }, 'mars_base');
    expect(plan.exercises).toEqual(expect.arrayContaining(['squats', 'lunges', 'pushups', 'plank', 'crunches']));
    expect(plan.exercises).not.toContain('aredSquat');
  });

  it('adds resistance work when the daily load is below target', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', 0), r('ared_load', 14)] }), green, '0g_transit');
    expect(plan.exercises).toEqual(['aredSquat', 'aredDeadlift', 'aredHeelRaise']);
  });

  it('adds aerobic training in microgravity when the heart deconditions', () => {
    const plan = recommendTraining(zones({ cardio: [r('spo2', 98), r('resting_hr', 82), r('hrv_rmssd', 60)] }), green, '0g_transit');
    expect(plan.state).toBe('required');
    expect(plan.exercises).toEqual(['cycle', 'treadmill']);
  });

  it('says not to exercise with a fever, low oxygen or a heart alert', () => {
    expect(recommendTraining(zones({ immune: [r('core_temp', 38.4)] }), green, '0g_transit').state).toBe('unsafe');
    expect(recommendTraining(zones({ cardio: [r('spo2', 90)] }), green, '0g_transit').state).toBe('unsafe');
    const heart = recommendTraining(zones({ musculo: [r('bmd_delta', -2)] }), { ...green, cardio: 'red' }, '0g_transit');
    expect(heart.state).toBe('unsafe');
    expect(heart.exercises).toEqual([]);
  });
});

describe('exercise set for every mission location', () => {
  const MICRO_LOCATIONS: SpaceLocationId[] = ['leo', 'gateway', 'mars_transit'];

  it.each(Object.keys(SPACE_LOCATIONS) as SpaceLocationId[])('%s picks the right gravity set', (id) => {
    const env = environmentForLocation(id);
    const expected = MICRO_LOCATIONS.includes(id) ? MICROGRAVITY_EXERCISES : GRAVITY_EXERCISES;
    expect(exercisesFor(env)).toEqual(expected);
    expect(settingNote(env)).toBeTruthy();
    // Low bone density must trigger training, using only exercises available at this location.
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -5), r('ared_load', 20)] }), green, env);
    expect(plan.state).toBe('required');
    expect(plan.exercises.length).toBeGreaterThan(0);
    plan.exercises.forEach((e) => expect(expected).toContain(e));
  });
});

describe('training intensity follows health level', () => {
  it('is full when every zone is green', () => {
    expect(trainingIntensity(zones(), green).intensity).toBe('full');
  });

  it('is reduced when a zone is in caution, with lower doses', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 20)] }), { ...green, musculo: 'yellow' }, '0g_transit');
    expect(plan.intensity).toBe('reduced');
    expect(plan.intensityReasons[0]).toMatch(/Musculoskeletal/);
    expect(plan.skip).toEqual([]);
    expect(EXERCISES.aredSquat.dose.reduced).toMatch(/70 %/);
  });

  it('is a light day with a red zone: spine-heavy and impact exercises are swapped out', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 20)] }), { ...green, musculo: 'red' }, '0g_transit');
    expect(plan.intensity).toBe('light');
    expect(plan.exercises).not.toContain('aredDeadlift');
    expect(plan.exercises).not.toContain('treadmill');
    expect(plan.exercises).toEqual(expect.arrayContaining(['aredSquat', 'aredHeelRaise', 'cycle']));
    expect(plan.skip).toEqual(expect.arrayContaining(['aredDeadlift', 'treadmill']));
  });

  it('swaps lunges and push-ups on a light day with gravity', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 20)] }), { ...green, musculo: 'red' }, 'mars_base');
    expect(plan.exercises).not.toContain('lunges');
    expect(plan.exercises).not.toContain('pushups');
    plan.exercises.forEach((e) => expect(GRAVITY_EXERCISES).toContain(e));
  });

  it('keeps aerobic work gentle when the heart is in caution', () => {
    const plan = recommendTraining(zones({ cardio: [r('spo2', 98), r('resting_hr', 82), r('hrv_rmssd', 60)] }), { ...green, cardio: 'yellow' }, '0g_transit');
    expect(plan.intensity).toBe('light');
    expect(plan.exercises).toEqual(['cycle']);
  });

  it('goes light with a raised temperature or borderline oxygen', () => {
    expect(trainingIntensity(zones({ immune: [r('core_temp', 37.7)] }), green).intensity).toBe('light');
    expect(trainingIntensity(zones({ cardio: [r('spo2', 94)] }), green).intensity).toBe('light');
  });

  it('has a dose for every intensity on every exercise', () => {
    Object.values(EXERCISES).forEach((e) => {
      expect(e.dose.full && e.dose.reduced && e.dose.light).toBeTruthy();
    });
  });
});

describe('each out-of-range metric changes the exercises', () => {
  const plan = (over: Partial<Record<BodyZoneId, VitalSignReading[]>>, env: Parameters<typeof recommendTraining>[2] = '0g_transit') =>
    recommendTraining(zones(over), green, env);

  it('high blood pressure: cycling instead of heavy lifts and holds', () => {
    const p = plan({ cardio: [r('spo2', 98), r('resting_hr', 60), r('hrv_rmssd', 60), r('systolic_bp', 150)] });
    expect(p.exercises).toContain('cycle');
    expect(p.skip).toEqual(expect.arrayContaining(['aredDeadlift', 'aredSquat']));
    expect(p.intensity).toBe('reduced');
  });

  it('high blood pressure on Mars: no plank, cycle instead', () => {
    const p = plan({ cardio: [r('spo2', 98), r('systolic_bp', 150)] }, 'mars_base');
    expect(p.exercises).toEqual(['cycle']);
    expect(p.skip).toContain('plank');
  });

  it('high eye pressure: no deadlift, breathe-out note, cycle added', () => {
    const p = plan({ neuro: [r('iop', 24)] });
    expect(p.exercises).toContain('cycle');
    expect(p.skip).toContain('aredDeadlift');
    expect(p.notes.join(' ')).toMatch(/hold your breath/);
  });

  it('bone loss with high eye pressure: bone work without the deadlift', () => {
    const p = plan({ neuro: [r('onsd', 6.2)], musculo: [r('bmd_delta', -1.5), r('ared_load', 20)] });
    expect(p.exercises).toEqual(expect.arrayContaining(['aredSquat', 'aredHeelRaise', 'treadmill', 'cycle']));
    expect(p.exercises).not.toContain('aredDeadlift');
  });

  it('low blood sugar blocks training; borderline adds an eat-first note', () => {
    expect(plan({ metabolic: [r('blood_glucose', 62)] }).state).toBe('unsafe');
    const p = plan({ metabolic: [r('blood_glucose', 80)], musculo: [r('bmd_delta', -1.5), r('ared_load', 20)] });
    expect(p.state).toBe('required');
    expect(p.notes[0]).toMatch(/carbohydrate/);
  });

  it('high blood sugar: aerobic exercise', () => {
    const p = plan({ metabolic: [r('blood_glucose', 160)] });
    expect(p.exercises).toEqual(expect.arrayContaining(['cycle', 'treadmill']));
  });

  it('low fluid or food: no long run, drink/eat note', () => {
    const p = plan({ metabolic: [r('hydration_intake', 1.5), r('caloric_intake', 1500)], musculo: [r('bmd_delta', -1.5), r('ared_load', 20)] });
    expect(p.skip).toContain('treadmill');
    expect(p.exercises).not.toContain('treadmill');
    expect(p.notes.join(' ')).toMatch(/Drink/);
    expect(p.notes.join(' ')).toMatch(/Eat/);
  });

  it('poor sleep or slow reactions: controlled exercises, no heavy lifts', () => {
    const p = plan({ behavioral: [r('sleep_eff', 60)] });
    expect(p.exercises).toEqual(expect.arrayContaining(['cycle', 'aredHeelRaise']));
    expect(p.skip).toEqual(expect.arrayContaining(['aredDeadlift', 'aredSquat']));
    const q = plan({ behavioral: [r('pvt_lapses', 7)] }, 'mars_base');
    expect(q.skip).toContain('lunges');
    expect(q.exercises).toEqual(expect.arrayContaining(['cycle', 'plank']));
  });

  it('low mood: aerobic exercise', () => {
    expect(plan({ behavioral: [r('mood_index', 2)] }).exercises).toEqual(expect.arrayContaining(['cycle', 'treadmill']));
  });

  it('low immune cells or high cabin CO2: moderate only, no long run', () => {
    const p = plan({ immune: [r('core_temp', 36.8), r('wbc_lymph', 0.9)], musculo: [r('bmd_delta', -1.5), r('ared_load', 20)] });
    expect(p.intensity).toBe('reduced');
    expect(p.exercises).not.toContain('treadmill');
    const q = plan({ neuro: [r('cabin_co2', 6)], musculo: [r('bmd_delta', -1.5), r('ared_load', 20)] });
    expect(q.skip).toContain('treadmill');
  });

  it('every rule cites a source', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../recommend.ts', import.meta.url), 'utf8');
    expect(src.match(/Source: SRC-\d{3}/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
  });
});
