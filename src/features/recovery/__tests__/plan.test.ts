import { describe, expect, it } from 'vitest';
import type { CrewMemberProfile, VitalSignReading } from '../../../types/argus';
import { buildRecoveryPlan, daysBetween, minutesForDay, phaseOf, RECOVERY_DAYS, tasksForDay, welcomeSpeech } from '../plan';

const crew = (over: Partial<CrewMemberProfile> = {}): CrewMemberProfile => ({
  id: 'c1', name: 'Test', callsign: 'VEGA', role: 'Flight Engineer', sex: 'female', age: 40, bloodType: 'O+',
  restingHrBaselineBpm: 60, preFlightOnsdMm: 4.8, missionDaysLogged: 120, countermeasureStreakSols: 0, defaultScenarioId: 'nominal' as never, medicalNotes: '',
  ...over,
});
const r = (metricId: string, value: number, unit = '', history: number[] = [value]): VitalSignReading => ({
  metricId, label: metricId, unit, currentValue: value, deltaFromBaseline: '', flightNormLabel: '', plainDescription: '',
  history: history.map((v, i) => ({ missionDay: i + 1, dateLabel: `D${i + 1}`, value: v })),
});

describe('return-to-Earth plan', () => {
  const plan = buildRecoveryPlan(crew(), [r('bmd_delta', -2.6, '%'), r('onsd', 5.7, 'mm'), r('resting_hr', 78, 'bpm'), r('wbc_lymph', 1.3, '×10⁹/L'), r('mood_index', 2, '/5')]);

  it('covers 45 days in three phases with no gaps', () => {
    expect(plan.phases[0].from).toBe(0);
    expect(plan.phases[plan.phases.length - 1].to).toBe(RECOVERY_DAYS - 1);
    for (let i = 1; i < plan.phases.length; i++) expect(plan.phases[i].from).toBe(plan.phases[i - 1].to + 1);
    for (let d = 0; d < RECOVERY_DAYS; d++) expect(tasksForDay(plan, d).length).toBeGreaterThan(0);
  });

  it('personalises from the mission data, worst findings first', () => {
    const f = Object.fromEntries(plan.findings.map((x) => [x.id, x]));
    expect(f.bone.status).toBe('red');
    expect(f.eyes.status).toBe('red');
    expect(f.heart.status).toBe('red');
    expect(f.immune.status).toBe('yellow');
    expect(plan.findings[0].status).toBe('red');
    expect(tasksForDay(plan, 3).map((t) => t.id)).toContain('eye_exam');
    expect(tasksForDay(plan, 12).map((t) => t.id)).toContain('bone_impact');
  });

  it('gives a healthy astronaut a lighter plan', () => {
    const easy = buildRecoveryPlan(crew(), [r('bmd_delta', -0.3, '%'), r('onsd', 4.9, 'mm'), r('resting_hr', 62, 'bpm')]);
    expect(easy.findings.find((x) => x.id === 'bone')!.tasks).toHaveLength(0);
    expect(minutesForDay(easy, 12)).toBeLessThan(minutesForDay(plan, 12));
  });

  it('longer missions get a longer first phase', () => {
    expect(phaseOf(buildRecoveryPlan(crew({ missionDaysLogged: 200 }), []), 5).id).toBe('stand');
    expect(phaseOf(plan, 5).id).toBe('rebuild');
  });

  it('welcomes the astronaut home and names the focus', () => {
    const s = welcomeSpeech('VEGA', plan);
    expect(s).toMatch(/^Welcome home, VEGA\. I prepared your 45-day recovery plan/);
    expect(s).toContain('bone');
  });

  it('counts days since landing', () => {
    expect(daysBetween('2026-11-15', '2026-11-15')).toBe(0);
    expect(daysBetween('2026-11-15', '2026-12-01')).toBe(16);
  });
});
