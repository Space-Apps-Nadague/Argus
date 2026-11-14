import { describe, expect, it } from 'vitest';
import {
  applyCheckIns,
  buildCheckInEntry,
  checkInStreak,
  latestMissionDay,
  validateCheckInValue,
} from '../checkIns';
import { TELEMETRY_SCENARIOS } from '../../data/telemetryScenarios';
import { calculateCrewReadinessScore, evaluateAllZones } from '../triageEngine';
import { CheckInEntry } from '../../types/argus';

const nominal = TELEMETRY_SCENARIOS.nominal.zones;
const entry = (missionDay: number, values: CheckInEntry['values'], t = '2026-11-14T08:00:00.000Z'): CheckInEntry => ({
  id: `e${missionDay}-${t}`,
  crewId: 'c1',
  missionDay,
  timestampIso: t,
  values,
});

describe('checkIns', () => {
  it('validates against METRIC_INPUT_RANGES', () => {
    expect(validateCheckInValue('resting_hr', '')).toEqual({ ok: 'empty' });
    expect(validateCheckInValue('resting_hr', 'abc')).toEqual({ ok: false, error: 'Enter a number' });
    expect(validateCheckInValue('resting_hr', '300')).toEqual({ ok: false, error: 'Allowed 30–180' });
    expect(validateCheckInValue('onsd', '5,2')).toEqual({ ok: true, value: 5.2 });
  });

  it('builds an entry only when all filled values are valid', () => {
    const bad = buildCheckInEntry({ crewId: 'c1', missionDay: 30, rawValues: { resting_hr: '62', spo2: '120' } });
    expect(bad.entry).toBeNull();
    expect(bad.errors.spo2).toBeDefined();
    const empty = buildCheckInEntry({ crewId: 'c1', missionDay: 30, rawValues: { resting_hr: '' } });
    expect(empty.entry).toBeNull();
    const ok = buildCheckInEntry({ crewId: 'c1', missionDay: 30, rawValues: { resting_hr: '62', spo2: '' }, note: ' ok ' });
    expect(ok.entry!.values).toEqual({ resting_hr: 62 });
    expect(ok.entry!.note).toBe('ok');
  });

  it('replaces the same-day point and updates currentValue', () => {
    const out = applyCheckIns(nominal, [entry(30, { onsd: 6.4 })]);
    const onsd = out.neuro.find((r) => r.metricId === 'onsd')!;
    expect(onsd.currentValue).toBe(6.4);
    expect(onsd.history).toHaveLength(30);
    expect(onsd.history[29]).toMatchObject({ missionDay: 30, value: 6.4, source: 'check_in' });
  });

  it('appends days beyond the series', () => {
    const out = applyCheckIns(nominal, [entry(31, { resting_hr: 70 })]);
    const hr = out.cardio.find((r) => r.metricId === 'resting_hr')!;
    expect(hr.history).toHaveLength(31);
    expect(hr.history[30].dateLabel).toBe('MD-31');
    expect(latestMissionDay(out)).toBe(31);
  });

  it('later entries for the same day win', () => {
    const out = applyCheckIns(nominal, [
      entry(30, { spo2: 95 }, '2026-11-14T09:00:00.000Z'),
      entry(30, { spo2: 97 }, '2026-11-14T08:00:00.000Z'),
    ]);
    expect(out.cardio.find((r) => r.metricId === 'spo2')!.currentValue).toBe(95);
  });

  it('flows into deterministic triage and readiness', () => {
    const before = evaluateAllZones(nominal, '0g_transit');
    const out = applyCheckIns(nominal, [entry(30, { onsd: 6.4 })]);
    const after = evaluateAllZones(out, '0g_transit');
    expect(before.neuro).not.toBe('red');
    expect(after.neuro).toBe('red');
    expect(calculateCrewReadinessScore(out, '0g_transit')).toBeLessThan(
      calculateCrewReadinessScore(nominal, '0g_transit')
    );
  });

  it('does not mutate the input zones', () => {
    const snap = JSON.stringify(nominal);
    applyCheckIns(nominal, [entry(30, { onsd: 6.4 })]);
    expect(JSON.stringify(nominal)).toBe(snap);
  });

  it('computes the streak of consecutive logged days', () => {
    expect(checkInStreak([])).toBe(0);
    expect(checkInStreak([entry(28, {}), entry(29, {}), entry(30, {}), entry(25, {})])).toBe(3);
    expect(checkInStreak([entry(30, {}), entry(30, {})])).toBe(1);
  });
});
