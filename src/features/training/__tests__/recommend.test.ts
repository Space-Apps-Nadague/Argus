import { describe, expect, it } from 'vitest';
import type { BodyZoneId, TriageStatus, VitalSignReading } from '../../../types/argus';
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
  cardio: [r('spo2', 98), r('resting_hr', 60)],
  musculo: [r('bmd_delta', 0), r('ared_load', 24)],
  immune: [r('core_temp', 36.8)],
  behavioral: [],
  ...over,
});
const green: Record<BodyZoneId, TriageStatus> = { neuro: 'green', cardio: 'green', musculo: 'green', immune: 'green', behavioral: 'green' };

describe('recommendTraining', () => {
  it('needs no extra training when muscle and bone metrics are in range', () => {
    expect(recommendTraining(zones(), green, '0g_transit')).toEqual({ state: 'optional', reasons: [], exercises: [] });
  });

  it('requires bone-loading exercises when bone density drops', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', -1.1), r('ared_load', 24)] }), { ...green, musculo: 'yellow' }, '0g_transit');
    expect(plan.state).toBe('required');
    expect(plan.exercises).toEqual(expect.arrayContaining(['squats', 'lunges', 'pushups', 'plank', 'crunches']));
    expect(plan.reasons.map((x) => x.metricId)).toEqual(['bmd_delta', 'musculo']);
  });

  it('adds resistance work when the daily load is below target', () => {
    const plan = recommendTraining(zones({ musculo: [r('bmd_delta', 0), r('ared_load', 14)] }), green, '0g_transit');
    expect(plan.state).toBe('required');
    expect(plan.exercises).toEqual(['squats', 'pushups', 'plank']);
  });

  it('says not to exercise with a fever, low oxygen or a heart alert', () => {
    expect(recommendTraining(zones({ immune: [r('core_temp', 38.4)] }), green, '0g_transit').state).toBe('unsafe');
    expect(recommendTraining(zones({ cardio: [r('spo2', 90)] }), green, '0g_transit').state).toBe('unsafe');
    const heart = recommendTraining(zones({ musculo: [r('bmd_delta', -2)] }), { ...green, cardio: 'red' }, '0g_transit');
    expect(heart.state).toBe('unsafe');
    expect(heart.exercises).toEqual([]);
  });
});
