/**
 * ARGUS — Top Mission Control HUD Bar & Crew Roster Strip
 * Single Source of Truth: specs/02-ui-dashboard.md (§1 Top Bar & Crew Roster Strip)
 */

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Flame,
  Globe,
  KeyRound,
  Radio,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { GravityEnvironment, ScenarioId } from '../types/argus';
import {
  getCrewAdjustedZones,
  TELEMETRY_SCENARIOS,
} from '../data/telemetryScenarios';
import {
  ENVIRONMENT_META,
  evaluateAllZones,
  STATUS_COLORS,
} from '../utils/triageEngine';
import { hasConfiguredGeminiKey } from '../services/flightSurgeonAi';

const ENVIRONMENTS: { id: GravityEnvironment; label: string }[] = [
  { id: '0g_transit', label: '0g Transit' },
  { id: '1_6g_moon', label: '1/6g Moon' },
  { id: '3_8g_mars', label: '3/8g Mars' },
];

const SCENARIO_ORDER: ScenarioId[] = [
  'nominal',
  'sans_alert',
  'high_co2',
  'solar_storm',
];

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
  } = useMission();

  const [showKeyInput, setShowKeyInput] = useState(false);
  const envMeta = ENVIRONMENT_META[environment];
  const hasKey = hasConfiguredGeminiKey(runtimeApiKey);

  const readinessColor =
    readinessScore >= 85
      ? '#22c55e'
      : readinessScore >= 70
      ? '#eab308'
      : '#ef4444';

  return (
    <header className="w-full border-b border-cyan-500/20 bg-slate-950/95 backdrop-blur-md sticky top-0 z-30">
      {/* Primary Top HUD Row */}
      <div className="max-w-[1800px] mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Branding & Simulated Earth Comm Delay Badge */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-400/40 shadow-[0_0_15px_rgba(34,211,238,0.15)]">
            <Activity className="w-5 h-5 text-cyan-400" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping opacity-75" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-mono text-sm md:text-base font-bold tracking-wider text-slate-100">
                ARGUS <span className="text-cyan-400">//</span> AUTONOMOUS CREW BIO-TWIN
              </h1>
              <span
                title="Simulated Deep-Space One-Way Light Time to Earth MCC-Houston"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30"
              >
                <Radio className="w-3 h-3 text-amber-400 animate-pulse" />
                EARTH COMM DELAY: {envMeta.commDelay}
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span>Astronaut Readiness Guidance &amp; Unified Surveillance</span>
              <span className="text-slate-600">•</span>
              <span className="font-mono text-[11px] text-cyan-400/80">
                {envMeta.missionPhase}
              </span>
            </p>
          </div>
        </div>

        {/* Center: Environment Context Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            Gravity:
          </span>
          {ENVIRONMENTS.map((env) => {
            const isActive = environment === env.id;
            return (
              <button
                key={env.id}
                type="button"
                onClick={() => setEnvironment(env.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                {env.label}
              </button>
            );
          })}
        </div>

        {/* Right: Crew Readiness Score + Simulate Medical Event Dropdown */}
        <div className="flex items-center gap-3">
          {/* Crew Readiness Score & Streak */}
          <div className="flex items-center gap-3 bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="w-4 h-4"
                style={{ color: readinessColor }}
              />
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  {activeCrewMember.callsign} Readiness
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="font-mono text-base font-bold leading-none"
                    style={{ color: readinessColor }}
                  >
                    {readinessScore}%
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-0.5">
                    <Flame className="w-3 h-3 text-amber-400 inline" />
                    {countermeasureStreakSols + (completedStepIds.length > 0 ? 1 : 0)}d STREAK
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Simulate Medical Event Dropdown */}
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5">
            <AlertTriangle
              className={`w-4 h-4 ${
                scenarioId === 'nominal'
                  ? 'text-cyan-400'
                  : 'text-red-400 animate-bounce'
              }`}
            />
            <div className="flex flex-col">
              <label
                htmlFor="scenario-select"
                className="text-[10px] font-mono uppercase tracking-wider text-slate-400"
              >
                Simulate Medical Event
              </label>
              <select
                id="scenario-select"
                value={scenarioId}
                onChange={(e) => setScenario(e.target.value as ScenarioId)}
                className="bg-transparent text-xs font-mono font-semibold text-slate-100 focus:outline-none cursor-pointer pr-2"
              >
                {SCENARIO_ORDER.map((id) => {
                  const sc = TELEMETRY_SCENARIOS[id];
                  return (
                    <option
                      key={id}
                      value={id}
                      className="bg-slate-900 text-slate-100"
                    >
                      {sc.shortTag} — {sc.label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Optional Runtime Gemini API Key Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowKeyInput((prev) => !prev)}
              title="Configure Optional Gemini 3.8 Flash API Key (Offline Fallback Always Active)"
              className={`p-2 rounded-lg border text-xs font-mono flex items-center gap-1 transition-colors ${
                hasKey
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">
                {hasKey ? 'AI LIVE' : 'AI KEY'}
              </span>
            </button>

            {showKeyInput && (
              <div className="absolute right-0 mt-2 w-80 p-3 rounded-xl bg-slate-900 border border-cyan-500/30 shadow-2xl z-50">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono font-semibold text-cyan-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Gemini 3.8 Flash API Key
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowKeyInput(false)}
                    className="text-[11px] font-mono text-slate-400 hover:text-slate-200"
                  >
                    CLOSE
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mb-2">
                  ARGUS runs 100% offline by default. Enter a Gemini API key to enable live AI guidance &amp; vision triage.
                </p>
                <input
                  type="password"
                  value={runtimeApiKey}
                  onChange={(e) => setRuntimeApiKey(e.target.value)}
                  placeholder="AIzaSy... (or set VITE_GEMINI_API_KEY)"
                  className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Secondary Row: Interactive Crew Member Roster Strip & "+ Add / Manage Crew" Button */}
      <div className="border-t border-slate-800/80 bg-slate-900/60 px-4 py-1.5">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-400 flex items-center gap-1.5 shrink-0 mr-1">
              <Users className="w-3.5 h-3.5" />
              Crew Roster ({crewRoster.length}):
            </span>

            {crewRoster.map((member) => {
              const isSelected = member.id === activeCrewMember.id;
              const effectiveScenario = isSelected
                ? scenarioId
                : member.defaultScenarioId;
              const memberZones = getCrewAdjustedZones(
                effectiveScenario,
                member
              );
              const statuses = evaluateAllZones(memberZones, environment);
              const hasRed = Object.values(statuses).includes('red');
              const hasYellow = Object.values(statuses).includes('yellow');
              const dotColor = hasRed
                ? STATUS_COLORS.red
                : hasYellow
                ? STATUS_COLORS.yellow
                : STATUS_COLORS.green;

              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => selectCrewMember(member.id)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-mono flex items-center gap-2 transition-all shrink-0 ${
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-400 text-slate-100 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      hasRed ? 'animate-ping' : ''
                    }`}
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="font-bold text-cyan-300">
                    {member.callsign}
                  </span>
                  <span className="text-slate-200">{member.name}</span>
                  <span className="hidden md:inline text-[10px] text-slate-400">
                    ({member.role} • {member.bloodType})
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setCrewModalOpen(true)}
            className="px-3 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/50 text-cyan-300 font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Create / Manage Crew</span>
          </button>
        </div>
      </div>
    </header>
  );
};
