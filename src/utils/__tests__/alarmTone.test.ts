import { describe, expect, it } from 'vitest';
import { alertSpeech, alertSteps, splitSentences } from '../alarmTone';
import { FEVER_ACTION, FEVER_LIMIT_C, type LifeThreat } from '../vitalLimits';

const threat = (over: Partial<LifeThreat> = {}): LifeThreat => ({
  zoneId: 'immune',
  metricId: 'core_temp',
  label: 'Body temperature',
  unit: '°C',
  value: 38.5,
  direction: 'high',
  limit: FEVER_LIMIT_C,
  action: FEVER_ACTION,
  severity: 'yellow',
  key: 'k1',
  ...over,
});

describe('spoken alert', () => {
  it('says what was detected and what to do now', () => {
    expect(alertSpeech([threat()], 'VEGA')).toBe(
      '38.5 degrees Celsius body temperature detected for VEGA. You should stop strenuous work, drink water, recheck your temperature in 30 minutes and tell the crew medical officer now.'
    );
  });

  it('does not say "now now" when the action already ends with now', () => {
    const s = alertSpeech([threat({ value: 42, action: 'Stop all work. Start active cooling and call the crew medical officer now.', severity: 'red' })]);
    expect(s).toContain('42 degrees Celsius body temperature detected.');
    expect(s).toContain('call the crew medical officer now.');
    expect(s).not.toMatch(/now now/);
  });

  it('lists several readings and says each action once', () => {
    const s = alertSpeech([
      threat({ value: 41.37 }),
      threat({ metricId: 'spo2', label: 'Blood oxygen', unit: '%', value: 82, key: 'k2', action: 'Give oxygen now.', severity: 'red' }),
      threat({ metricId: 'spo2', label: 'Blood oxygen', unit: '%', value: 81, key: 'k3', action: 'Give oxygen now.', severity: 'red' }),
    ]);
    expect(s).toContain('41.4 degrees Celsius body temperature detected.');
    expect(s).toContain('82 percent blood oxygen detected.');
    expect(s.match(/You should give oxygen now\./g)).toHaveLength(1);
  });

  it('rings once, says "Alert", then the explanation', () => {
    const steps = alertSteps('38.5 degrees Celsius body temperature detected.');
    expect(steps.map((s) => (s.kind === 'beep' ? 'beep' : s.text))).toEqual(['beep', 'Alert!', '38.5 degrees Celsius body temperature detected.']);
  });

  it('speaks each sentence separately (Chrome stalls on long utterances)', () => {
    expect(splitSentences('38.5 degrees Celsius body temperature detected for VEGA. You should drink water now.')).toEqual([
      '38.5 degrees Celsius body temperature detected for VEGA.',
      'You should drink water now.',
    ]);
    const steps = alertSteps('One. Two! Three?', 1, 'ARGUS!');
    expect(steps.map((s) => (s.kind === 'beep' ? 'beep' : s.text))).toEqual(['beep', 'ARGUS!', 'One.', 'Two!', 'Three?']);
  });

  it('is silent with nothing to report', () => {
    expect(alertSpeech([])).toBe('');
  });
});
