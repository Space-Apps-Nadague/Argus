/**
 * ARGUS — Crew Roster & Custom Astronaut Bio-Twin Creator Modal (`CrewManagerModal.tsx`)
 * Single Source of Truth: specs/01-data-schema.md (§1 CrewMemberProfile) & specs/02-ui-dashboard.md
 */

import React, { useState } from 'react';
import {
  Activity,
  Check,
  HeartPulse,
  PlusCircle,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import {
  BloodType,
  CrewMemberProfile,
  CrewRole,
  ScenarioId,
} from '../types/argus';
import {
  getCrewAdjustedZones,
  TELEMETRY_SCENARIOS,
} from '../data/telemetryScenarios';
import {
  calculateCrewReadinessScore,
  evaluateAllZones,
  STATUS_COLORS,
} from '../utils/triageEngine';

const BLOOD_TYPES: BloodType[] = [
  'O+',
  'O-',
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
];

const CREW_ROLES: CrewRole[] = [
  'Mission Commander',
  'Flight Engineer',
  'Flight Surgeon / Medical Officer',
  'Payload & Science Specialist',
  'EVA Surface Specialist',
];

const SCENARIO_IDS: ScenarioId[] = [
  'nominal',
  'sans_alert',
  'high_co2',
  'solar_storm',
];

export const CrewManagerModal: React.FC = () => {
  const {
    crewRoster,
    activeCrewMember,
    isCrewModalOpen,
    setCrewModalOpen,
    selectCrewMember,
    createCrewMember,
    deleteCrewMember,
    environment,
  } = useMission();

  const [name, setName] = useState('');
  const [callsign, setCallsign] = useState('');
  const [role, setRole] = useState<string>('Payload & Science Specialist');
  const [age, setAge] = useState<number>(36);
  const [bloodType, setBloodType] = useState<BloodType>('O+');
  const [restingHrBaselineBpm, setRestingHrBaselineBpm] = useState<number>(60);
  const [preFlightOnsdMm, setPreFlightOnsdMm] = useState<number>(4.85);
  const [missionDaysLogged, setMissionDaysLogged] = useState<number>(142);
  const [countermeasureStreakSols, setCountermeasureStreakSols] =
    useState<number>(14);
  const [defaultScenarioId, setDefaultScenarioId] =
    useState<ScenarioId>('nominal');
  const [medicalNotes, setMedicalNotes] = useState<string>(
    'First deep-space mission; high aerobic conditioning and regular ocular ultrasound baseline tracking.'
  );
  const [formError, setFormError] = useState<string | null>(null);

  if (!isCrewModalOpen) {
    return null;
  }

  // Preview deterministic readiness for the new crew member form
  const previewProfile: CrewMemberProfile = {
    id: 'preview',
    name: name || 'New Astronaut',
    callsign: callsign || 'NOVA',
    role,
    age,
    bloodType,
    restingHrBaselineBpm,
    preFlightOnsdMm,
    missionDaysLogged,
    countermeasureStreakSols,
    defaultScenarioId,
    medicalNotes,
  };
  const previewZones = getCrewAdjustedZones(defaultScenarioId, previewProfile);
  const previewReadiness = calculateCrewReadinessScore(
    previewZones,
    environment,
    0
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Please enter the crew member’s full name.');
      return;
    }
    const cleanCallsign = (callsign.trim() || name.trim().split(' ')[0])
      .toUpperCase()
      .slice(0, 14);

    createCrewMember({
      name: name.trim(),
      callsign: cleanCallsign,
      role: role.trim() || 'Payload & Science Specialist',
      age: Math.max(20, Math.min(75, Number(age) || 35)),
      bloodType,
      restingHrBaselineBpm: Math.max(
        42,
        Math.min(95, Number(restingHrBaselineBpm) || 60)
      ),
      preFlightOnsdMm: Math.max(
        4.0,
        Math.min(5.8, Number(preFlightOnsdMm) || 4.8)
      ),
      missionDaysLogged: Math.max(1, Number(missionDaysLogged) || 142),
      countermeasureStreakSols: Math.max(
        0,
        Number(countermeasureStreakSols) || 10
      ),
      defaultScenarioId,
      medicalNotes:
        medicalNotes.trim() ||
        'Custom astronaut bio-twin profile initialized on spacecraft HUD.',
    });

    // Reset form & close modal so user sees their newly created Bio-Twin immediately
    setName('');
    setCallsign('');
    setFormError(null);
    setCrewModalOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crew Roster and Custom Crew Member Creator"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 md:p-6 overflow-y-auto"
    >
      <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-cyan-500/40 shadow-[0_0_50px_rgba(2,6,23,0.95)] overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-400/40 text-cyan-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-mono text-sm md:text-base font-bold uppercase tracking-wider text-slate-100">
                ARGUS // CREW BIO-TWIN ROSTER &amp; CUSTOM MEMBER CREATOR
              </h2>
              <p className="text-xs text-slate-400">
                Select an active astronaut to inspect their 3D Bio-Twin or enroll a new crew member with individualized baseline physiology
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCrewModalOpen(false)}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-100 border border-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-Column Body: Left = Active Roster List | Right = Create Custom Crew Member Form */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          {/* Left Column (7 cols): Mission Crew Roster */}
          <div className="lg:col-span-7 p-4 md:p-5 space-y-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4" />
                Active Mission Crew Roster ({crewRoster.length})
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                Click any crew card to load Bio-Twin
              </span>
            </div>

            <div className="space-y-2.5">
              {crewRoster.map((member) => {
                const isSelected = member.id === activeCrewMember.id;
                const memberZones = getCrewAdjustedZones(
                  member.defaultScenarioId,
                  member
                );
                const memberZoneStatuses = evaluateAllZones(
                  memberZones,
                  environment
                );
                const memberReadiness = calculateCrewReadinessScore(
                  memberZones,
                  environment,
                  0
                );
                const hasRed = Object.values(memberZoneStatuses).includes('red');
                const hasYellow =
                  Object.values(memberZoneStatuses).includes('yellow');
                const badgeStatus = hasRed
                  ? 'red'
                  : hasYellow
                  ? 'yellow'
                  : 'green';
                const statusColor = STATUS_COLORS[badgeStatus];

                return (
                  <div
                    key={member.id}
                    onClick={() => {
                      selectCrewMember(member.id);
                      setCrewModalOpen(false);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectCrewMember(member.id);
                        setCrewModalOpen(false);
                      }
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800/90 border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.18)]'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: statusColor }}
                          />
                          <span className="font-mono text-sm font-bold text-slate-100">
                            {member.name}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/40 font-mono text-[10px] font-bold text-cyan-300">
                            &ldquo;{member.callsign}&rdquo;
                          </span>
                          {member.isCustom && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-400/40 font-mono text-[10px] text-purple-300">
                              CUSTOM
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          {member.role} • Age {member.age} • Blood{' '}
                          <span className="text-slate-200 font-semibold">
                            {member.bloodType}
                          </span>{' '}
                          • Sol {member.missionDaysLogged}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="text-[10px] font-mono uppercase text-slate-400">
                            Readiness
                          </div>
                          <div
                            className="font-mono text-sm font-bold"
                            style={{ color: statusColor }}
                          >
                            {memberReadiness}%
                          </div>
                        </div>

                        {isSelected ? (
                          <span className="px-2.5 py-1 rounded-md bg-cyan-500/20 border border-cyan-400/50 font-mono text-[10px] font-bold text-cyan-300 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 font-mono text-[10px] text-slate-300">
                            Select
                          </span>
                        )}

                        {member.isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCrewMember(member.id);
                            }}
                            title="Remove custom crew member"
                            className="p-1.5 rounded bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Physiological Baselines Strip */}
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[11px] font-mono">
                      <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800/80">
                        <span className="text-slate-400">Baseline HR:</span>{' '}
                        <span className="text-cyan-300 font-semibold">
                          {member.restingHrBaselineBpm} bpm
                        </span>
                      </div>
                      <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800/80">
                        <span className="text-slate-400">Pre-Flight ONSD:</span>{' '}
                        <span className="text-cyan-300 font-semibold">
                          {member.preFlightOnsdMm} mm
                        </span>
                      </div>
                      <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800/80 truncate">
                        <span className="text-slate-400">State:</span>{' '}
                        <span style={{ color: statusColor }} className="font-semibold">
                          {TELEMETRY_SCENARIOS[member.defaultScenarioId].shortTag}
                        </span>
                      </div>
                    </div>

                    <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                      {member.medicalNotes}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column (5 cols): Create Custom Crew Member Form */}
          <div className="lg:col-span-5 p-4 md:p-5 bg-slate-950/60">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5 mb-3">
              <UserPlus className="w-4 h-4" />
              Enroll New Crew Member Bio-Twin
            </h3>

            <form onSubmit={handleCreateSubmit} className="space-y-3">
              {formError && (
                <div className="p-2.5 rounded-lg bg-red-500/15 border border-red-500/40 text-xs font-mono text-red-300">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Dr. Jonas Vasquez"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                    Callsign
                  </label>
                  <input
                    type="text"
                    value={callsign}
                    onChange={(e) => setCallsign(e.target.value)}
                    placeholder="ORION"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono uppercase text-cyan-300 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                    Mission Role
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                  >
                    {CREW_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                      Age
                    </label>
                    <input
                      type="number"
                      min={22}
                      max={70}
                      value={age}
                      onChange={(e) => setAge(Number(e.target.value))}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                      Blood
                    </label>
                    <select
                      value={bloodType}
                      onChange={(e) =>
                        setBloodType(e.target.value as BloodType)
                      }
                      className="w-full px-1.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                    >
                      {BLOOD_TYPES.map((bt) => (
                        <option key={bt} value={bt}>
                          {bt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Physiological Baseline Sliders / Inputs */}
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                <div className="text-[11px] font-mono font-semibold text-cyan-300 flex items-center gap-1.5">
                  <HeartPulse className="w-3.5 h-3.5" />
                  Individual Pre-Flight Physiological Baselines
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Resting HR Baseline (bpm)
                    </label>
                    <input
                      type="number"
                      min={45}
                      max={88}
                      step={1}
                      value={restingHrBaselineBpm}
                      onChange={(e) =>
                        setRestingHrBaselineBpm(Number(e.target.value))
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-cyan-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Pre-Flight ONSD (mm)
                    </label>
                    <input
                      type="number"
                      min={4.2}
                      max={5.6}
                      step={0.05}
                      value={preFlightOnsdMm}
                      onChange={(e) =>
                        setPreFlightOnsdMm(Number(e.target.value))
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-cyan-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Mission Sols Logged
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={missionDaysLogged}
                      onChange={(e) =>
                        setMissionDaysLogged(Number(e.target.value))
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Countermeasure Streak (d)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={countermeasureStreakSols}
                      onChange={(e) =>
                        setCountermeasureStreakSols(Number(e.target.value))
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                  Initial Telemetry Condition / Scenario
                </label>
                <select
                  value={defaultScenarioId}
                  onChange={(e) =>
                    setDefaultScenarioId(e.target.value as ScenarioId)
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                >
                  {SCENARIO_IDS.map((scId) => {
                    const sc = TELEMETRY_SCENARIOS[scId];
                    return (
                      <option key={scId} value={scId}>
                        {sc.shortTag} — {sc.label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                  Spaceflight Medical &amp; Risk Notes
                </label>
                <textarea
                  rows={2}
                  value={medicalNotes}
                  onChange={(e) => setMedicalNotes(e.target.value)}
                  placeholder="Enter relevant spaceflight medical history, EVA workload, or SANS susceptibility notes..."
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
                />
              </div>

              {/* Live Readiness Preview Box */}
              <div className="p-2.5 rounded-lg bg-slate-900 border border-cyan-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>Simulated Bio-Twin Readiness:</span>
                </div>
                <span className="font-mono text-sm font-bold text-cyan-300 flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4" />
                  {previewReadiness}%
                </span>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(34,211,238,0.35)] transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Create &amp; Activate Crew Member Bio-Twin</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
