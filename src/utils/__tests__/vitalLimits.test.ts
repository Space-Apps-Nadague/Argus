import { describe, expect, it } from 'vitest';
import { BodyZoneId, VitalSignReading } from '../../types/argus';
import { classifyReading, findLifeThreats, sanitizeZones } from '../vitalLimits';
import { validateCheckInValue } from '../checkIns';

const reading = (metricId: string, values: number[]): VitalSignReading => ({
  metricId,
  label: metricId,
  unit: 'u',
  currentValue: values[values.length - 1],
  deltaFromBaseline: '',
  flightNormLabel: '',
  plainDescription: '',
  history: values.map((value, i) => ({ missionDay: i + 1, dateLabel: `D${i + 1}`, value })),
});

const zonesWith = (immune: VitalSignReading[], cardio: VitalSignReading[] = []): Record<BodyZoneId, VitalSignReading[]> => ({
  neuro: [],
  cardio,
  musculo: [],
  immune,
  behavioral: [],
});

describe('vitalLimits', () => {
  it('separates impossible, life-threatening and ordinary values', () => {
    expect(classifyReading('core_temp', 50)).toBe('impossible');
    expect(classifyReading('core_temp', 42)).toBe('life_threat');
    expect(classifyReading('core_temp', 31)).toBe('life_threat');
    expect(classifyReading('core_temp', 37)).toBe('ok');
    expect(classifyReading('spo2', 101)).toBe('impossible');
    expect(classifyReading('spo2', 82)).toBe('life_threat');
    expect(classifyReading('resting_hr', 300)).toBe('impossible');
    expect(classifyReading('resting_hr', 170)).toBe('life_threat');
    expect(classifyReading('mood_index', 1)).toBe('ok');
  });

  it('accepts deadly-but-possible check-ins and rejects impossible ones', () => {
    expect(validateCheckInValue('core_temp', '42')).toEqual({ ok: true, value: 42 });
    expect(validateCheckInValue('core_temp', '50')).toEqual({ ok: false, error: 'Not physically possible (allowed 20–46.5)' });
  });

  it('drops impossible points from series and keeps the last possible value', () => {
    const out = sanitizeZones(zonesWith([reading('core_temp', [36.8, 37.0, 55])]));
    expect(out.immune[0].currentValue).toBe(37.0);
    expect(out.immune[0].history.map((p) => p.value)).toEqual([36.8, 37.0]);
    const gone = sanitizeZones(zonesWith([reading('core_temp', [60, 70])]));
    expect(gone.immune).toEqual([]);
  });

  it('reports life threats from the latest value only', () => {
    const threats = findLifeThreats(zonesWith([reading('core_temp', [37, 42])], [reading('spo2', [80, 97])]), 'crew-1');
    expect(threats).toHaveLength(1);
    expect(threats[0]).toMatchObject({ metricId: 'core_temp', value: 42, direction: 'high', limit: 40, key: 'crew-1|core_temp|42' });
  });
});
