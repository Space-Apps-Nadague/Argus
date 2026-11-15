/**
 * ARGUS — Scheduled Mission Routine Prompt Banner & Readiness Milestones
 * Single Source of Truth: specs/01-data-schema.md §8 (REQ-08, REQ-09)
 *
 * Prompts astronauts when daily measurements are pending and displays
 * gamification milestone badges for completed routines and streaks.
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  Brain,
  Award,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Flame,
  Heart,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { ReadinessMilestone } from '../types/argus';
import { useCognitionStore } from '../features/cognition/store';
import { dateKeyOf, gameOfTheDay } from '../features/cognition/schedule';
import { GAME_BY_ID } from '../features/cognition/catalog';

const MILESTONE_ICON_MAP: Record<ReadinessMilestone['icon'], React.FC<{ className?: string }>> = {
  flame: Flame,
  shield: Shield,
  award: Award,
  zap: Zap,
  check: Check,
  heart: Heart,
};

export const ScheduledRoutineBanner: React.FC = () => {
  const {
    activeCrewMember,
    routineStatus,
    milestones,
    completeScheduledRoutine,
    setActiveTab,
  } = useMission();

  const [showMilestones, setShowMilestones] = useState(false);
  // Daily cognition game is part of the routine (specs/01-data-schema.md §12.2).
  const { byCrew } = useCognitionStore();
  const todayKey = dateKeyOf(new Date());
  const cognitionGame = GAME_BY_ID[gameOfTheDay(activeCrewMember.id, todayKey)];
  const cognitionDone = (byCrew[activeCrewMember.id] ?? []).some((s) => s.daily && s.dateKey === todayKey);
  const [justLogged, setJustLogged] = useState(false);

  const unlockedCount = milestones.filter((m) => m.unlocked).length;

  const handleQuickLog = () => {
    completeScheduledRoutine();
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 4000);
  };

  return (
    <section
      role="region"
      aria-label="Scheduled mission routine and readiness milestones"
      className="mb-4 rounded-xl border border-hud-line bg-hud-panel/85 p-3.5 shadow-lg backdrop-blur-md transition-all"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Routine Status info */}
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
              routineStatus.isDue
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                : 'border-status-green/50 bg-status-green/10 text-status-green'
            }`}
            aria-hidden="true"
          >
            {routineStatus.isDue ? (
              <Clock className="h-5 w-5 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider ${
                  routineStatus.isDue
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-status-green/40 bg-status-green/10 text-status-green'
                }`}
              >
                {routineStatus.isDue ? (
                  <>
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    SCHEDULED ROUTINE DUE · SOL {routineStatus.currentDay}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    SOL {routineStatus.currentDay} ROUTINE LOGGED
                  </>
                )}
              </span>

              <span className="flex items-center gap-1 font-mono text-xs text-amber-300">
                <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                {routineStatus.streakDays}d Streak
              </span>

              {justLogged && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/50 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300 animate-pulse">
                  <Sparkles className="h-3 w-3" />
                  Routine Recorded!
                </span>
              )}
            </div>

            <p className="text-xs text-hud-muted leading-relaxed">
              {routineStatus.isDue ? (
                <>
                  Daily health assessment is pending for{' '}
                  <strong className="text-hud-text font-medium">
                    {activeCrewMember.name}
                  </strong>{' '}
                  ({activeCrewMember.callsign}). Record scheduled readings (HR, SpO2, BP, Sleep, Mood) to detect early drift and maintain crew readiness.
                </>
              ) : (
                <>
                  All scheduled vital signs are verified for{' '}
                  <strong className="text-hud-text font-medium">
                    {activeCrewMember.callsign}
                  </strong>
                  . Continuous telemetry feeds active bio-twin drift analytics and milestone tracking.
                </>
              )}
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0 pt-1 lg:pt-0">
          <button
            type="button"
            onClick={() => setActiveTab('cognition')}
            className={`hud-btn ${cognitionDone ? 'text-status-green' : 'border-hud-accent/60 text-hud-accent'}`}
            aria-label={cognitionDone ? `Cognition game done today: ${cognitionGame.title}` : `Play today's cognition game: ${cognitionGame.title}`}
          >
            {cognitionDone ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Brain className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{cognitionDone ? 'Game done' : `Game: ${cognitionGame.title}`}</span>
          </button>
          {routineStatus.isDue ? (
            <>
              <button
                type="button"
                onClick={handleQuickLog}
                className="hud-focus inline-flex items-center gap-1.5 rounded-lg bg-hud-accent px-3.5 py-1.5 text-xs font-semibold text-hud-bg shadow-sm transition-all hover:bg-cyan-300 active:scale-95"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Mark Routine Done
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('trends')}
                className="hud-btn"
                title="See today's readings from your watch and dosimeter"
              >
                <span>View Trends</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setActiveTab('trends')}
              className="hud-btn"
              title="See today's readings from your watch and dosimeter"
            >
              <span>View Trends</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMilestones((prev) => !prev)}
            aria-expanded={showMilestones}
            aria-controls="milestones-shelf"
            className={`hud-focus inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              showMilestones
                ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                : 'border-hud-line bg-hud-bg/70 text-hud-muted hover:text-hud-text'
            }`}
          >
            <Award className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <span>
              Milestones ({unlockedCount}/{milestones.length})
            </span>
            {showMilestones ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Expandable Milestones Shelf (REQ-09) */}
      {showMilestones && (
        <div
          id="milestones-shelf"
          className="mt-3.5 border-t border-hud-line/80 pt-3 transition-all"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-hud-text">
                Readiness Milestones &amp; Achievement Badges
              </h3>
            </div>
            <span className="font-mono text-xs text-hud-muted">
              {unlockedCount} of {milestones.length} Unlocked
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {milestones.map((m) => {
              const IconComponent = MILESTONE_ICON_MAP[m.icon] || Award;
              const pct = Math.min(
                100,
                Math.round((m.progress.current / m.progress.target) * 100)
              );

              return (
                <div
                  key={m.id}
                  className={`flex flex-col justify-between rounded-xl border p-2.5 transition-all ${
                    m.unlocked
                      ? 'border-amber-400/50 bg-gradient-to-b from-amber-500/10 to-transparent shadow-[0_0_12px_rgba(251,191,36,0.1)]'
                      : 'border-hud-line bg-hud-bg/50 opacity-75'
                  }`}
                >
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                          m.unlocked
                            ? 'border-amber-400/50 bg-amber-400/20 text-amber-300'
                            : 'border-slate-700 bg-slate-800/60 text-slate-400'
                        }`}
                        aria-hidden="true"
                      >
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                          m.unlocked
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {m.unlocked ? 'Unlocked' : 'In Progress'}
                      </span>
                    </div>

                    <h4 className="text-xs font-semibold text-hud-text leading-tight mb-1">
                      {m.title}
                    </h4>
                    <p className="text-[11px] text-hud-muted leading-snug line-clamp-2">
                      {m.description}
                    </p>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-hud-line/60">
                    <div className="flex items-center justify-between font-mono text-[10px] text-hud-muted mb-1">
                      <span>Progress</span>
                      <span>
                        {m.progress.current} / {m.progress.target} {m.progress.unit}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          m.unlocked ? 'bg-amber-400' : 'bg-hud-accent/60'
                        }`}
                        style={{ width: `${pct}%` }}
                        aria-valuenow={m.progress.current}
                        aria-valuemin={0}
                        aria-valuemax={m.progress.target}
                        role="progressbar"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
