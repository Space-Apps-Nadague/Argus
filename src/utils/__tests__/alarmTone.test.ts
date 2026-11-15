import { describe, expect, it } from 'vitest';
import { alertSpeech } from '../alarmTone';
import type { LifeThreat } from '../vitalLimits';

const threat = (over: Partial<LifeThreat> = {}): LifeThreat => ({
  zoneId: 'immune',
  metricId: 'core_temp',
  label: 'Body temperature',
  unit: '°C',
  value: 42,
  direction: 'high',
  limit: 40,
  action: 'Stop all work. Start active cooling and call the crew medical officer now.',
  key: 'k1',
  ...over,
});

describe('spoken emergency alert', () => {
  it('says what is wrong, with spoken units, and what to do', () => {
    expect(alertSpeech([threat()], 'VEGA')).toBe(
      'Emergency alert for VEGA. Body temperature 42 degrees Celsius. Stop all work. Start active cooling and call the crew medical officer now.'
    );
  });

  it('lists several readings and says each action once', () => {
    const s = alertSpeech([
      threat({ value: 41.37 }),
      threat({ metricId: 'spo2', label: 'Blood oxygen', unit: '%', value: 82, key: 'k2', action: 'Give oxygen now.' }),
      threat({ metricId: 'spo2', label: 'Blood oxygen', unit: '%', value: 81, key: 'k3', action: 'Give oxygen now.' }),
    ]);
    expect(s).toContain('Body temperature 41.4 degrees Celsius.');
    expect(s).toContain('Blood oxygen 82 percent.');
    expect(s.match(/Give oxygen now\./g)).toHaveLength(1);
  });

  it('is silent with nothing to report', () => {
    expect(alertSpeech([])).toBe('');
  });
});
