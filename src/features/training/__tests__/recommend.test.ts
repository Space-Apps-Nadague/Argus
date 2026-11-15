import { describe, expect, it } from 'vitest';
import type { BodyZoneId, TriageStatus, VitalSignReading } from '../../../types/argus';
import { exercisesFor, MICROGRAVITY_EXERCISES } from '../exercises';
import { recommendTraining } from '../recommend';

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
  immune: [r('core_temp', 36.8)],
  behavioral: [],
  ...over,
});
const green: Record<BodyZoneId, TriageStatus> = { neuro: 'green', cardio: 'green', musculo: 'green', immune: 'green', behavioral: 'green' };

describe('recommendTraining', () => {
  it('uses ISS devices in microgravity and body-weight exercises with gravity', () => {
    expect(exercisesFor('0g_transit')).toEqual(MICROGRAVITY_EXERCISES);
    expect(exercisesFor('iss_leo')).toEqual(MICROGRAVITY_EXERCISES);
    expect(exercisesFor('mars_base')).toContain('pushups');
    expect(exercisesFor('0g_transit')).not.toContain('pushups');
  });

  it('needs no extra training when muscle, bone and heart metrics are in range', () => {
    expect(recommendTraining(zones(), green, '0g_transit')).toEqual({ state: 'optional', reasons: [], exercises: [] });
  });

  it('requires ARED work in microgravity when bone density drops', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 20)] }), { ...green, musculo: 'yellow' }, '0g_transit');
    expect(plan.state).toBe('required');
    expect(plan.exercises).toEqual(expect.arrayContaining(['aredSquat', 'aredDeadlift', 'aredHeelRaise', 'treadmill']));
    expect(plan.exercises).not.toContain('pushups');
    expect(plan.reasons.map((x) => x.metricId)).toEqual(['bmd_delta', 'musculo']);
  });

  it('requires body-weight exercises on Mars when bone density drops', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 20)] }), { ...green, musculo: 'red' }, 'mars_base');
    expect(plan.exercises).toEqual(expect.arrayContaining(['squats', 'lunges', 'pushups', 'plank', 'crunches']));
    expect(plan.exercises).not.toContain('aredSquat');
  });

  it('adds resistance work when the daily load is below target', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', 0), r('ared_load', 14)] }), green, '0g_transit');
    expect(plan.exercises).toEqual(['aredSquat', 'aredDeadlift', 'aredHeelRaise']);
  });

  it('adds aerobic training in microgravity when the heart deconditions', () => {
    const plan = recommendTraining(zones({ cardio: [r('spo2', 98), r('resting_hr', 82), r('hrv_rmssd', 60)] }), { ...green, cardio: 'yellow' }, '0g_transit');
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
