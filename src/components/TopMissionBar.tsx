/**
 * ARGUS — Top Mission Bar & Crew Strip (slim, low-text)
 * Single Source of Truth: specs/02-ui-dashboard.md §1 Top Bar
 */

import React, { useState } from 'react';
import { Activity, Flame, KeyRound, LogOut, MapPin, Radio, ShieldCheck, UserPlus, UserRound, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { useAuth } from '../context/AuthContext';
import { formatCommDelay, SPACE_LOCATION_ORDER, SPACE_LOCATIONS } from '../data/spaceLocations';
import { MissionClock } from './MissionClock';
import { ScenarioId, SpaceLocationId, TriageStatus, UserRole } from '../types/argus';
import { getCrewAdjustedZones, TELEMETRY_SCENARIOS } from '../data/telemetryScenarios';
import { applyCheckIns } from '../utils/checkIns';
import { evaluateAllZones } from '../utils/triageEngine';
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

const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', astronaut: 'Astronaut', flight_surgeon: 'Flight surgeon' };

export const TopMissionBar: React.FC = () => {
  const {
    crewRoster,
    activeCrewMember,
    selectCrewMember,
    setCrewModalOpen,
    environment,
    scenarioId,
    setScenario,
    readinessScore,
    countermeasureStreakSols,
    completedStepIds,
    runtimeApiKey,
    setRuntimeApiKey,
    checkIns,
    zonesForCrew,
    latestDay,
    spaceLocation,
    spaceLocationId,
    setSpaceLocation,
  } = useMission();
  const { currentUser, isAdmin, seesAllCrew, canViewHealth, logout } = useAuth();

  const [showKeyInput, setShowKeyInput] = useState(false);
  const hasKey = hasConfiguredAiKey(runtimeApiKey);
  const rStatus = readinessStatus(readinessScore);
  const streak = countermeasureStreakSols + (completedStepIds.length > 0 ? 1 : 0);

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
              <h1 className="font-display text-lg font-bold tracking-[0.2em] text-hud-text">ARGUS</h1>
              <p className="text-[11px] text-hud-muted">
                {activeCrewMember.callsign} · {spaceLocation.gravityLabel}
              </p>
            </div>
          </div>
          <label
            className="flex items-center gap-1.5 rounded-lg border border-hud-line bg-hud-panel/80 px-2.5 py-1.5"
            title={spaceLocation.description}
          >
            <MapPin className="h-3.5 w-3.5 text-hud-accent" aria-hidden="true" />
            <span className="sr-only">Mission location</span>
            <select
              value={spaceLocationId}
              onChange={(e) => setSpaceLocation(e.target.value as SpaceLocationId)}
              className="hud-focus cursor-pointer rounded bg-transparent text-xs font-medium text-hud-text"
            >
              {SPACE_LOCATION_ORDER.map((id) => (
                <option key={id} value={id} className="bg-hud-panel text-hud-text">
                  {SPACE_LOCATIONS[id].label}
                </option>
              ))}
            </select>
          </label>
          <span
            title="One-way signal delay to Earth"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300"
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            {formatCommDelay(spaceLocation)}
            <span className="font-sans text-amber-200/80">to Earth</span>
          </span>
        </div>

        {/* Clock · readiness · scenario · AI key · user */}
        <div className="flex flex-wrap items-center gap-2">
          <MissionClock location={spaceLocation} missionDay={latestDay} />
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
              <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-hud-line bg-hud-panel p-3 shadow-2xl">
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

          <div className="flex items-center gap-1.5 rounded-lg border border-hud-line bg-hud-panel/80 py-1 pl-2.5 pr-1">
            {isAdmin ? (
              <ShieldCheck className="h-4 w-4 text-hud-accent" aria-hidden="true" />
            ) : (
              <UserRound className="h-4 w-4 text-hud-accent" aria-hidden="true" />
            )}
            <div className="leading-tight">
              <div className="text-xs font-semibold text-hud-text">{currentUser?.username}</div>
              <div className="text-[10px] text-hud-muted">{ROLE_LABELS[currentUser?.role ?? 'astronaut']}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="hud-focus ml-1 rounded-md p-1.5 text-hud-muted hover:bg-hud-bg hover:text-hud-text"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Crew strip (users who see all crew) */}
      {seesAllCrew && canViewHealth && (
      <div className="border-t border-hud-line/70 bg-hud-panel/40">
        <div className="max-w-[1800px] mx-auto flex items-center gap-2 px-3 md:px-4 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 no-scrollbar overflow-x-auto py-0.5" role="group" aria-label="Active crew member">
            {crewRoster.map((member) => {
              const isSelected = member.id === activeCrewMember.id;
              const sc = isSelected ? scenarioId : member.defaultScenarioId;
              const zones = zonesForCrew(member, sc) ?? applyCheckIns(getCrewAdjustedZones(sc, member), checkIns[member.id] || []);
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
      )}
    </header>
  );
};
