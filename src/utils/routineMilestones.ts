/**
 * ARGUS — Scheduled Mission Routine & Gamification Milestones
 * Single Source of Truth: specs/01-data-schema.md §8 (REQ-08, REQ-09)
 *
 * Deterministic calculation of routine due status, milestone unlock conditions,
 * and quick-log routine generators.
 */

import {
  CheckInEntry,
  CrewMemberProfile,
  MetricId,
  ReadinessMilestone,
  ScheduledRoutineStatus,
} from '../types/argus';
import { checkInStreak, lastLoggedDay } from './checkIns';

export const CORE_ROUTINE_METRIC_IDS: MetricId[] = [
  'resting_hr',
  'spo2',
  'systolic_bp',
  'daily_sleep_hours',
  'mood_index',
];

export interface ScheduledRoutineEvaluationParams {
  activeCheckIns: CheckInEntry[];
  latestDay: number;
  countermeasureStreakSols: number;
}

/**
 * Deterministically determines if the daily mission routine is pending for the active sol.
 */
export function getScheduledRoutineStatus(
  params: ScheduledRoutineEvaluationParams
): ScheduledRoutineStatus {
  const { activeCheckIns, latestDay, countermeasureStreakSols } = params;
  const currentDay = latestDay || 30;
  const loggedToday = activeCheckIns.some((entry) => entry.missionDay >= currentDay);
  const streak = checkInStreak(activeCheckIns) + countermeasureStreakSols;
  const lastDay = lastLoggedDay(activeCheckIns);

  return {
    isDue: !loggedToday,
    currentDay,
    lastLoggedDay: lastDay,
    coreMetricsDue: CORE_ROUTINE_METRIC_IDS,
    streakDays: streak,
  };
}

export interface QuickRoutineCheckInParams {
  crewId: string;
  missionDay: number;
  crewProfile?: CrewMemberProfile;
  now?: Date;
  id?: string;
}

/**
 * Creates a calibrated, valid daily check-in with nominal baseline vitals to fulfill the scheduled routine.
 */
export function createQuickRoutineCheckIn(
  params: QuickRoutineCheckInParams
): CheckInEntry {
  const { crewId, missionDay, crewProfile } = params;
  const now = params.now ?? new Date();
  const restingHr = crewProfile?.restingHrBaselineBpm ?? 62;

  return {
    id:
      params.id ??
      `routine-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    crewId,
    missionDay,
    timestampIso: now.toISOString(),
    values: {
      resting_hr: restingHr,
      spo2: 98,
      systolic_bp: 118,
      daily_sleep_hours: 7.8,
      mood_index: 8.5,
      core_temp: 37.0,
      blood_glucose: 92,
    },
    note: `Scheduled mission routine completed for MD-${missionDay}`,
  };
}

export interface EvaluateMilestonesParams {
  activeCheckIns: CheckInEntry[];
  streakDays: number;
  readinessScore: number;
  completedStepCount: number;
  crewMember?: CrewMemberProfile;
}

/**
 * Deterministically evaluates all gamification milestone badges for the active astronaut.
 */
export function evaluateReadinessMilestones(
  params: EvaluateMilestonesParams
): ReadinessMilestone[] {
  const { activeCheckIns, streakDays, readinessScore, completedStepCount } = params;
  const totalEntries = activeCheckIns.length;

  return [
    {
      id: 'first_check',
      title: 'First Sol Check',
      description: 'Completed your first scheduled mission routine',
      category: 'routine',
      icon: 'check',
      unlocked: totalEntries >= 1,
      unlockedAtLabel: totalEntries >= 1 ? 'Sol 1 Complete' : undefined,
      progress: {
        current: Math.min(1, totalEntries),
        target: 1,
        unit: 'check-in',
      },
    },
    {
      id: 'streak_3',
      title: 'Orbital Rhythm',
      description: 'Maintained a 3-sol consecutive health routine streak',
      category: 'streak',
      icon: 'zap',
      unlocked: streakDays >= 3,
      unlockedAtLabel: streakDays >= 3 ? `${streakDays} Sol Streak` : undefined,
      progress: {
        current: Math.min(3, streakDays),
        target: 3,
        unit: 'sols',
      },
    },
    {
      id: 'streak_7',
      title: 'Vigilant Guardian',
      description: 'Maintained a 7-sol continuous telemetry streak',
      category: 'streak',
      icon: 'flame',
      unlocked: streakDays >= 7,
      unlockedAtLabel: streakDays >= 7 ? `${streakDays} Sol Streak` : undefined,
      progress: {
        current: Math.min(7, streakDays),
        target: 7,
        unit: 'sols',
      },
    },
    {
      id: 'streak_14',
      title: 'Deep-Space Discipline',
      description: 'Maintained 14 sols of active countermeasure discipline',
      category: 'streak',
      icon: 'award',
      unlocked: streakDays >= 14,
      unlockedAtLabel: streakDays >= 14 ? `${streakDays} Sol Streak` : undefined,
      progress: {
        current: Math.min(14, streakDays),
        target: 14,
        unit: 'sols',
      },
    },
    {
      id: 'peak_readiness',
      title: 'Peak Condition',
      description: 'Achieved optimal crew readiness score (≥ 95%)',
      category: 'readiness',
      icon: 'shield',
      unlocked: readinessScore >= 95,
      unlockedAtLabel: readinessScore >= 95 ? `${readinessScore}% Readiness` : undefined,
      progress: {
        current: readinessScore,
        target: 95,
        unit: '%',
      },
    },
    {
      id: 'countermeasure_pro',
      title: 'Countermeasure Specialist',
      description: 'Executed 2 or more guided countermeasure clinical protocols',
      category: 'routine',
      icon: 'heart',
      unlocked: completedStepCount >= 2,
      unlockedAtLabel:
        completedStepCount >= 2 ? `${completedStepCount} Protocols Done` : undefined,
      progress: {
        current: Math.min(2, completedStepCount),
        target: 2,
        unit: 'steps',
      },
    },
  ];
}
