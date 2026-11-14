/**
 * ARGUS — Scheduled Mission Routine & Milestones Unit Tests
 * Single Source of Truth: specs/01-data-schema.md §8 (REQ-08, REQ-09)
 */

import { describe, expect, it } from 'vitest';
import {
  createQuickRoutineCheckIn,
  evaluateReadinessMilestones,
  getScheduledRoutineStatus,
} from '../routineMilestones';
import { applyCheckIns, checkInStreak } from '../checkIns';
import { validateCheckInValue } from '../checkIns';
import { DEFAULT_CREW_ROSTER, TELEMETRY_SCENARIOS } from '../../data/telemetryScenarios';
import { CheckInEntry } from '../../types/argus';

describe('Scheduled Mission Routine (REQ-08)', () => {
  const crew = DEFAULT_CREW_ROSTER[0];

  it('marks routine as due when no check-in exists for the current day', () => {
    const status = getScheduledRoutineStatus({
      activeCheckIns: [],
      latestDay: 30,
      countermeasureStreakSols: 5,
    });

    expect(status.isDue).toBe(true);
    expect(status.currentDay).toBe(30);
    expect(status.streakDays).toBe(5);
    expect(status.coreMetricsDue).toContain('resting_hr');
    expect(status.coreMetricsDue).toContain('spo2');
    expect(status.coreMetricsDue).toContain('systolic_bp');
    expect(status.coreMetricsDue).toContain('daily_sleep_hours');
    expect(status.coreMetricsDue).toContain('mood_index');
  });

  it('marks routine as completed when a check-in exists for MD-30', () => {
    const entry: CheckInEntry = {
      id: 'test-entry-1',
      crewId: crew.id,
      missionDay: 30,
      timestampIso: new Date().toISOString(),
      values: { resting_hr: 60, spo2: 99 },
    };

    const status = getScheduledRoutineStatus({
      activeCheckIns: [entry],
      latestDay: 30,
      countermeasureStreakSols: 5,
    });

    expect(status.isDue).toBe(false);
    expect(status.currentDay).toBe(30);
    expect(status.lastLoggedDay).toBe(30);
  });

  it('creates valid quick routine check-in within physiological bounds', () => {
    const routineEntry = createQuickRoutineCheckIn({
      crewId: crew.id,
      missionDay: 30,
      crewProfile: crew,
    });

    expect(routineEntry.crewId).toBe(crew.id);
    expect(routineEntry.missionDay).toBe(30);
    expect(routineEntry.values.resting_hr).toBe(crew.restingHrBaselineBpm);
    expect(routineEntry.note).toContain('MD-30');

    // Verify all generated values pass validation
    for (const [metricId, val] of Object.entries(routineEntry.values)) {
      const valid = validateCheckInValue(metricId as any, val);
      expect(valid.ok).toBe(true);
    }

    // Verify overlaying routine entry updates zones and satisfies streak
    const zones = TELEMETRY_SCENARIOS.nominal.zones;
    const updated = applyCheckIns(zones, [routineEntry]);
    expect(updated.cardio[0].currentValue).toBe(routineEntry.values.resting_hr);
    expect(checkInStreak([routineEntry])).toBe(1);
  });
});

describe('Readiness Milestones & Gamification Badges (REQ-09)', () => {
  const crew = DEFAULT_CREW_ROSTER[0];

  it('evaluates initial milestone state correctly', () => {
    const milestones = evaluateReadinessMilestones({
      activeCheckIns: [],
      streakDays: 0,
      readinessScore: 88,
      completedStepCount: 0,
      crewMember: crew,
    });

    expect(milestones).toHaveLength(6);
    const firstCheck = milestones.find((m) => m.id === 'first_check')!;
    expect(firstCheck.unlocked).toBe(false);
    expect(firstCheck.progress.current).toBe(0);

    const peak = milestones.find((m) => m.id === 'peak_readiness')!;
    expect(peak.unlocked).toBe(false);
    expect(peak.progress.current).toBe(88);
  });

  it('unlocks milestones deterministically as routine and countermeasure criteria are met', () => {
    const entry: CheckInEntry = {
      id: 'entry-1',
      crewId: crew.id,
      missionDay: 30,
      timestampIso: new Date().toISOString(),
      values: { resting_hr: 60 },
    };

    const milestones = evaluateReadinessMilestones({
      activeCheckIns: [entry],
      streakDays: 7,
      readinessScore: 98,
      completedStepCount: 2,
      crewMember: crew,
    });

    const firstCheck = milestones.find((m) => m.id === 'first_check')!;
    expect(firstCheck.unlocked).toBe(true);

    const streak3 = milestones.find((m) => m.id === 'streak_3')!;
    expect(streak3.unlocked).toBe(true);

    const streak7 = milestones.find((m) => m.id === 'streak_7')!;
    expect(streak7.unlocked).toBe(true);

    const streak14 = milestones.find((m) => m.id === 'streak_14')!;
    expect(streak14.unlocked).toBe(false);
    expect(streak14.progress.current).toBe(7);

    const peak = milestones.find((m) => m.id === 'peak_readiness')!;
    expect(peak.unlocked).toBe(true);

    const countermeasurePro = milestones.find((m) => m.id === 'countermeasure_pro')!;
    expect(countermeasurePro.unlocked).toBe(true);
  });
});
