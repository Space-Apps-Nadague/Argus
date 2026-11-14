/**
 * ARGUS — Top Mission Bar & Crew Strip (slim, low-text)
 * Single Source of Truth: specs/02-ui-dashboard.md §1 Top Bar
 */

import React, { useState } from 'react';
import { Activity, Award, Bot, Flame, Globe, KeyRound, Orbit, Radio, UserPlus, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { GravityEnvironment, ScenarioId, TriageStatus } from '../types/argus';
import { getCrewAdjustedZones, TELEMETRY_SCENARIOS } from '../data/telemetryScenarios';
import { applyCheckIns } from '../utils/checkIns';
import { ENVIRONMENT_META, ENVIRONMENT_ORDER, evaluateAllZones } from '../utils/triageEngine';
import { hasConfiguredAiKey } from '../services/flightSurgeonAi';
import { StatusIcon, STATUS_WORD } from './ui/StatusPill';

const SCENARIO_ORDER: ScenarioId[] = ['nominal', 'sans_alert', 'high_co2', 'solar_storm'];

export const readinessStatus = (score: number): TriageStatus =>
  score >= 85 ? 'green' : score >= 70 ? 'yellow' : 'red';

const STATUS_TEXT: Record<TriageStatus, string> = {
  green: 'text-status-green',
  yellow: 'text-status-yellow',
  red: 'text-status-red',
};
const STATUS_BG: Record<TriageStatus, string> = {
  green: 'bg-status-green',
  yellow: 'bg-status-yellow',
  red: 'bg-status-red',
};

export const TopMissionBar: React.FC = () => {
  const {
    crewRoster,
    activeCrewMember,
    selectCrewMember,
    setCrewModalOpen,
    environment,
    setEnvironment,
    scenarioId,
    setScenario,
    readinessScore,
    countermeasureStreakSols,
    completedStepIds,
    runtimeApiKey,
    setRuntimeApiKey,
    checkIns,
    milestones,
    setCompanionOpen,
  } = useMission();

  const [showKeyInput, setShowKeyInput] = useState(false);
  const [showMilestonesPopover, setShowMilestonesPopover] = useState(false);

  React.useEffect(() => {
    if (!showMilestonesPopover && !showKeyInput) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowMilestonesPopover(false);
        setShowKeyInput(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showMilestonesPopover, showKeyInput]);
  const envMeta = ENVIRONMENT_META[environment];
  const hasKey = hasConfiguredAiKey(runtimeApiKey);
  const rStatus = readinessStatus(readinessScore);
  const streak = countermeasureStreakSols + (completedStepIds.length > 0 ? 1 : 0);
  const unlockedMilestones = milestones?.filter((m) => m.unlocked) ?? [];
  const unlockedCount = unlockedMilestones.length;
  const totalMilestones = milestones?.length ?? 6;

  return (
    <header className="relative z-30 border-b border-hud-line bg-hud-bg/90 backdrop-blur-md">
      <div className="max-w-[1800px] mx-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 md:px-4 py-2.5">
        {/* Brand + comm delay */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex items-center gap-2"
            title="ARGUS — Astronaut Readiness Guidance & Unified Surveillance"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-hud-accent/40 bg-hud-accent/10">
              <Activity className="h-5 w-5 text-hud-accent" aria-hidden="true" />
            </span>
            <div className="leading-tight">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h1 className="font-display text-lg font-bold tracking-[0.2em] text-hud-text">ARGUS</h1>
                <span className="text-[11px] font-medium tracking-wide text-hud-accent/90">
                  Astronaut Readiness Guidance &amp; Unified Surveillance
                </span>
              </div>
              <p className="text-[11px] text-hud-muted">Crew Bio-Twin · {envMeta.shortLabel} ({envMeta.gravityG})</p>
            </div>
          </div>
          <span
            title="One-way signal delay to Earth"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300"
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            {envMeta.commDelay.replace(' ONE-WAY', '')}
            <span className="font-sans text-amber-200/80">to Earth</span>
          </span>
          <span
            title={`Local gravity field: ${envMeta.gravityG} (${envMeta.label})`}
            className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] text-cyan-300"
          >
            <Orbit className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
            <span>{envMeta.gravityG}</span>
            <span className="font-sans text-cyan-200/80">gravity</span>
          </span>
        </div>

        {/* Readiness · location · scenario · AI key */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div
            className="flex items-center gap-2.5 rounded-lg border border-hud-line bg-hud-panel/80 px-3 py-1.5"
            aria-label={`${activeCrewMember.callsign} readiness ${readinessScore} percent, ${STATUS_WORD[rStatus]}`}
          >
            <StatusIcon status={rStatus} className={`h-4 w-4 ${STATUS_TEXT[rStatus]}`} />
            <div className="leading-tight">
              <div className="text-[11px] text-hud-muted">Readiness</div>
              <div className={`font-mono text-base font-semibold ${STATUS_TEXT[rStatus]}`}>{readinessScore}%</div>
            </div>
            <span
              className="ml-1 flex items-center gap-0.5 font-mono text-[11px] text-amber-300"
              title="Countermeasure streak (days)"
            >
              <Flame className="h-3.5 w-3.5" aria-hidden="true" />
              {streak}d
            </span>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMilestonesPopover((p) => !p)}
              aria-expanded={showMilestonesPopover}
              aria-label={`Readiness milestones: ${unlockedCount} of ${totalMilestones} unlocked`}
              title="Readiness milestone badges"
              className="hud-focus flex items-center gap-1.5 rounded-lg border border-hud-line bg-hud-panel/80 px-2.5 py-1.5 text-xs text-amber-300 transition-colors hover:border-amber-400/50"
            >
              <Award className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <span className="font-mono font-semibold">{unlockedCount}/{totalMilestones}</span>
              <span className="hidden sm:inline text-hud-muted text-[11px]">Badges</span>
            </button>
            {showMilestonesPopover && (
              <div
                role="dialog"
                aria-label="Readiness milestone badges"
                className="fixed inset-x-3 top-16 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-hud-line bg-hud-panel p-3 shadow-2xl"
              >
                <div className="mb-2 flex items-center justify-between border-b border-hud-line pb-2">
                  <div className="flex items-center gap-1.5">
                    <Award className="h-4 w-4 text-amber-400" aria-hidden="true" />
                    <span className="font-display text-xs font-semibold text-hud-text">
                      Readiness Milestones
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMilestonesPopover(false)}
                    aria-label="Close milestones popover"
                    className="hud-focus rounded p-0.5 text-hud-muted hover:text-hud-text"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mb-2.5 text-[11px] text-hud-muted">
                  {unlockedCount} of {totalMilestones} badges earned for routine logging and resilience.
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto no-scrollbar pr-0.5">
                  {(milestones ?? []).map((m) => {
                    const pct = Math.min(100, Math.round((m.progress.current / m.progress.target) * 100));
                    return (
                      <div
                        key={m.id}
                        className={`rounded-lg border p-2 text-xs transition-colors ${
                          m.unlocked
                            ? 'border-amber-400/40 bg-amber-400/10'
                            : 'border-hud-line/70 bg-hud-bg/40 opacity-75'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-hud-text flex items-center gap-1.5">
                            <span className={m.unlocked ? 'text-amber-400' : 'text-slate-500'}>
                              {m.unlocked ? '✓' : '○'}
                            </span>
                            {m.title}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.2 font-mono text-[9px] font-bold uppercase ${
                              m.unlocked
                                ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {m.unlocked ? 'Unlocked' : 'In Progress'}
                          </span>
                        </div>
                        <p className="text-[11px] text-hud-muted mb-1.5">{m.description}</p>
                        <div className="flex items-center justify-between font-mono text-[10px] text-hud-muted mb-0.5">
                          <span>Progress</span>
                          <span>
                            {m.progress.current} / {m.progress.target} {m.progress.unit}
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full ${m.unlocked ? 'bg-amber-400' : 'bg-hud-accent/60'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-hud-line bg-hud-panel/80 px-2.5 py-1.5">
            <Globe className="h-3.5 w-3.5 text-hud-accent" aria-hidden="true" />
            <span className="text-[11px] text-hud-muted">Location</span>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as GravityEnvironment)}
              className="hud-focus cursor-pointer rounded bg-transparent text-xs font-medium text-hud-text"
              aria-label="Mission Location and Gravity Environment"
            >
              {ENVIRONMENT_ORDER.map((loc) => (
                <option key={loc} value={loc} className="bg-hud-panel text-hud-text">
                  {ENVIRONMENT_META[loc].shortLabel} ({ENVIRONMENT_META[loc].gravityG})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-hud-line bg-hud-panel/80 px-2.5 py-1.5">
            <span className="text-[11px] text-hud-muted">Scenario</span>
            <select
              value={scenarioId}
              onChange={(e) => setScenario(e.target.value as ScenarioId)}
              className="hud-focus cursor-pointer rounded bg-transparent text-xs font-medium text-hud-text"
            >
              {SCENARIO_ORDER.map((id) => (
                <option key={id} value={id} className="bg-hud-panel text-hud-text">
                  {TELEMETRY_SCENARIOS[id].label}
                </option>
              ))}
            </select>
          </label>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowKeyInput((p) => !p)}
              aria-expanded={showKeyInput}
              aria-label={hasKey ? 'Clinical AI connected. Change key' : 'Add Clinical AI key (optional)'}
              title={hasKey ? 'Clinical AI connected' : 'Optional Clinical AI key'}
              className={`hud-focus flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                hasKey
                  ? 'border-status-green/50 bg-status-green/10 text-status-green'
                  : 'border-hud-line bg-hud-panel/80 text-hud-muted hover:text-hud-accent'
              }`}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </button>
            {showKeyInput && (
              <div
                role="dialog"
                aria-label="Clinical AI key"
                className="fixed inset-x-3 top-16 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-hud-line bg-hud-panel p-3 shadow-2xl"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-hud-text">Clinical AI key</span>
                  <button
                    type="button"
                    onClick={() => setShowKeyInput(false)}
                    aria-label="Close"
                    className="hud-focus rounded p-0.5 text-hud-muted hover:text-hud-text"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-hud-muted">Optional. ARGUS works fully offline.</p>
                <input
                  type="password"
                  value={runtimeApiKey}
                  onChange={(e) => setRuntimeApiKey(e.target.value)}
                  placeholder="API key"
                  aria-label="Clinical AI API key"
                  className="hud-input text-xs"
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setCompanionOpen(true)}
            aria-label="Open ARGUS Companion chat drawer"
            title="ARGUS Companion (offline brain + Clinical AI + voice)"
            className="hud-focus flex items-center gap-1.5 rounded-lg border border-hud-accent/60 bg-hud-accent/15 px-2.5 py-1.5 text-xs text-hud-text hover:bg-hud-accent/25 transition-colors"
          >
            <Bot className="h-4 w-4 text-hud-accent" aria-hidden="true" />
            <span className="font-display font-semibold tracking-wider">ARGUS</span>
            <span className="hidden xl:inline text-[10px] text-hud-muted font-sans">Companion</span>
          </button>
        </div>
      </div>

      {/* Crew strip */}
      <div className="border-t border-hud-line/70 bg-hud-panel/40">
        <div className="max-w-[1800px] mx-auto flex items-center gap-2 px-3 md:px-4 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 no-scrollbar overflow-x-auto py-0.5" role="group" aria-label="Active crew member">
            {crewRoster.map((member) => {
              const isSelected = member.id === activeCrewMember.id;
              const sc = isSelected ? scenarioId : member.defaultScenarioId;
              const zones = applyCheckIns(getCrewAdjustedZones(sc, member), checkIns[member.id] || []);
              const st = Object.values(evaluateAllZones(zones, environment));
              const worst: TriageStatus = st.includes('red') ? 'red' : st.includes('yellow') ? 'yellow' : 'green';
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => selectCrewMember(member.id)}
                  aria-pressed={isSelected}
                  title={`${member.name} · ${member.role} · ${STATUS_WORD[worst]}`}
                  className={`hud-focus flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
                    isSelected
                      ? 'border-hud-accent/70 bg-hud-accent/15 text-hud-text'
                      : 'border-hud-line bg-hud-bg/60 text-hud-muted hover:text-hud-text'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${STATUS_BG[worst]}`} aria-hidden="true" />
                  <span className="font-mono font-semibold text-hud-accent">{member.callsign}</span>
                  <span className="hidden md:inline">{member.name}</span>
                  <span className="sr-only">, {STATUS_WORD[worst]}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setCrewModalOpen(true)} className="hud-btn shrink-0">
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Add crew</span>
            <span className="sr-only sm:hidden">Add crew</span>
          </button>
        </div>
      </div>
    </header>
  );
};
