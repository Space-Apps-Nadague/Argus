import { describe, expect, it } from 'vitest';
import { DEFAULT_CREW_ROSTER, getCrewAdjustedZones } from '../../data/telemetryScenarios';
import { CheckInEntry, GravityEnvironment } from '../../types/argus';
import { applyCheckIns } from '../checkIns';
import { METRIC_IDS } from '../triageEngine';
import {
  computePresetValue,
  CORE_VITAL_SHORTCUTS,
  evaluateVitalInputPreview,
} from '../vitalLogger';

describe('vitalLogger', () => {
  it('exposes shortcuts for all 5 core challenge vitals', () => {
    const ids = CORE_VITAL_SHORTCUTS.map((s) => s.metricId);
    expect(ids).toEqual([
      'systolic_bp',
      'blood_glucose',
      'core_temp',
      'daily_sleep_hours',
      'mood_index',
    ]);
  });

  it('evaluates deterministic triage preview for core vitals', () => {
    expect(evaluateVitalInputPreview('systolic_bp', '118', '0g_transit')).toEqual({
      valid: true,
      value: 118,
      error: null,
      status: 'green',
    });
    expect(evaluateVitalInputPreview('blood_glucose', '128', '0g_transit')).toEqual({
      valid: true,
      value: 128,
      error: null,
      status: 'yellow',
    });
    expect(evaluateVitalInputPreview('core_temp', '38.6', '0g_transit')).toEqual({
      valid: true,
      value: 38.6,
      error: null,
      status: 'red',
    });
    expect(evaluateVitalInputPreview('daily_sleep_hours', '7.5', '0g_transit').status).toBe('green');
    expect(evaluateVitalInputPreview('mood_index', '4', '0g_transit').status).toBe('red');
  });

  it('rejects out-of-range and non-numeric inputs', () => {
    const empty = evaluateVitalInputPreview('systolic_bp', '', '0g_transit');
    expect(empty.valid).toBe(false);
    expect(empty.error).toBeNull();
    expect(empty.status).toBeNull();

    const tooHigh = evaluateVitalInputPreview('blood_glucose', '999', '0g_transit');
    expect(tooHigh.valid).toBe(false);
    expect(tooHigh.error).toContain('Allowed');
    expect(tooHigh.status).toBeNull();

    const nonNum = evaluateVitalInputPreview('core_temp', 'abc', '0g_transit');
    expect(nonNum.valid).toBe(false);
    expect(nonNum.error).toBe('Enter a number');
  });

  it('generates valid in-range presets matching the requested triage band across all 17 metrics', () => {
    const envs: GravityEnvironment[] = ['0g_transit', 'iss_leo', 'lunar_base', 'mars_base'];
    for (const env of envs) {
      for (const metricId of METRIC_IDS) {
        const nominal = computePresetValue(metricId, 'nominal', env);
        const yellow = computePresetValue(metricId, 'yellow', env);
        const red = computePresetValue(metricId, 'red', env);

        expect(evaluateVitalInputPreview(metricId, String(nominal), env).status).toBe('green');
        expect(evaluateVitalInputPreview(metricId, String(yellow), env).status).toBe('yellow');
        expect(evaluateVitalInputPreview(metricId, String(red), env).status).toBe('red');
      }
    }
  });

  it('overlays logged core vitals onto MD-30 in offline demo mode', () => {
    const crew = DEFAULT_CREW_ROSTER[0];
    const baseZones = getCrewAdjustedZones('nominal', crew);
    const entry: CheckInEntry = {
      id: 'vital-test-1',
      crewId: crew.id,
      missionDay: 30,
      timestampIso: '2026-11-15T10:00:00.000Z',
      values: {
        systolic_bp: 136,
        blood_glucose: 155,
        core_temp: 37.8,
        daily_sleep_hours: 6.2,
        mood_index: 5.5,
      },
    };
    const updated = applyCheckIns(baseZones, [entry]);

    const sbp = updated.cardio.find((r) => r.metricId === 'systolic_bp');
    const bg = updated.metabolic.find((r) => r.metricId === 'blood_glucose');
    const temp = updated.immune.find((r) => r.metricId === 'core_temp');
    const sleep = updated.behavioral.find((r) => r.metricId === 'daily_sleep_hours');
    const mood = updated.behavioral.find((r) => r.metricId === 'mood_index');

    expect(sbp?.currentValue).toBe(136);
    expect(sbp?.history.at(-1)?.source).toBe('check_in');
    expect(bg?.currentValue).toBe(155);
    expect(temp?.currentValue).toBe(37.8);
    expect(sleep?.currentValue).toBe(6.2);
    expect(mood?.currentValue).toBe(5.5);
  });
});
