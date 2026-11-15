/**
 * ARGUS — Add Crew Member dialog (`CrewManagerModal.tsx`)
 * Single Source of Truth: specs/01-data-schema.md (§1 CrewMemberProfile) & specs/02-ui-dashboard.md (§2.5)
 * The roster itself lives in the Crew tab (`CrewTab.tsx`). This dialog only creates crew members.
 */

import React, { useEffect, useRef, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { BiologicalSex, BloodType, CrewMemberProfile, CrewRole, ScenarioId } from '../types/argus';
import { getCrewAdjustedZones, TELEMETRY_SCENARIOS } from '../data/telemetryScenarios';
import { calculateCrewReadinessScore } from '../utils/triageEngine';
import { readinessStatus } from './TopMissionBar';
import { StatusPill } from './ui/StatusPill';

const BLOOD_TYPES: BloodType[] = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const CREW_ROLES: CrewRole[] = [
  'Mission Commander',
  'Flight Engineer',
  'Flight Surgeon / Medical Officer',
  'Payload & Science Specialist',
  'EVA Surface Specialist',
];
const SCENARIO_IDS: ScenarioId[] = ['nominal', 'unexplained_fatigue', 'sans_alert', 'high_co2', 'solar_storm'];

const Field: React.FC<{ id: string; label: string; className?: string; children: React.ReactNode }> = ({
  id,
  label,
  className = '',
  children,
}) => (
  <div className={className}>
    <label htmlFor={id} className="mb-1 block text-xs text-hud-muted">
      {label}
    </label>
    {children}
  </div>
);

export const CrewManagerModal: React.FC = () => {
  const { isCrewModalOpen, setCrewModalOpen, createCrewMember, setActiveTab, environment } = useMission();

  const [name, setName] = useState('');
  const [callsign, setCallsign] = useState('');
  const [sex, setSex] = useState<BiologicalSex>('female');
  const [role, setRole] = useState<string>('Payload & Science Specialist');
  const [age, setAge] = useState<number>(36);
  const [bloodType, setBloodType] = useState<BloodType>('O+');
  const [restingHrBaselineBpm, setRestingHrBaselineBpm] = useState<number>(60);
  const [preFlightOnsdMm, setPreFlightOnsdMm] = useState<number>(4.85);
  const [missionDaysLogged, setMissionDaysLogged] = useState<number>(142);
  const [countermeasureStreakSols, setCountermeasureStreakSols] = useState<number>(14);
  const [defaultScenarioId, setDefaultScenarioId] = useState<ScenarioId>('nominal');
  const [medicalNotes, setMedicalNotes] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isCrewModalOpen) return;
    openerRef.current = document.activeElement;
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCrewModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [isCrewModalOpen, setCrewModalOpen]);

  if (!isCrewModalOpen) return null;

  const previewProfile: CrewMemberProfile = {
    id: 'preview',
    name: name || 'New astronaut',
    callsign: callsign || 'NOVA',
    role,
    sex,
    age,
    bloodType,
    restingHrBaselineBpm,
    preFlightOnsdMm,
    missionDaysLogged,
    countermeasureStreakSols,
    defaultScenarioId,
    medicalNotes,
  };
  const previewReadiness = calculateCrewReadinessScore(
    getCrewAdjustedZones(defaultScenarioId, previewProfile),
    environment,
    0
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Enter the crew member’s full name.');
      firstFieldRef.current?.focus();
      return;
    }
    const cleanCallsign = (callsign.trim() || name.trim().split(' ')[0]).toUpperCase().slice(0, 14);
    createCrewMember({
      name: name.trim(),
      callsign: cleanCallsign,
      role: role.trim() || 'Payload & Science Specialist',
      sex,
      age: Math.max(20, Math.min(75, Number(age) || 35)),
      bloodType,
      restingHrBaselineBpm: Math.max(42, Math.min(95, Number(restingHrBaselineBpm) || 60)),
      preFlightOnsdMm: Math.max(4.0, Math.min(5.8, Number(preFlightOnsdMm) || 4.8)),
      missionDaysLogged: Math.max(1, Number(missionDaysLogged) || 142),
      countermeasureStreakSols: Math.max(0, Number(countermeasureStreakSols) || 10),
      defaultScenarioId,
      medicalNotes: medicalNotes.trim() || 'Custom astronaut bio-twin profile.',
    });
    setName('');
    setCallsign('');
    setMedicalNotes('');
    setFormError(null);
    setCrewModalOpen(false);
    setActiveTab('biotwin');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-hud-bg/85 p-3 backdrop-blur-md md:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && setCrewModalOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-crew-title"
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-hud-line bg-hud-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-hud-line px-5 py-3.5">
          <h2 id="add-crew-title" className="flex items-center gap-2 font-display text-sm font-semibold tracking-wide text-hud-text">
            <UserPlus className="h-4 w-4 text-hud-accent" aria-hidden="true" />
            Add crew member
          </h2>
          <button
            type="button"
            onClick={() => setCrewModalOpen(false)}
            aria-label="Close"
            className="hud-focus rounded-lg p-1.5 text-hud-muted hover:text-hud-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleCreateSubmit} className="flex-1 space-y-4 overflow-y-auto p-5" noValidate>
          {formError && (
            <p role="alert" className="rounded-lg border border-status-red/40 bg-status-red/10 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id="crew-name" label="Full name *" className="sm:col-span-2">
              <input
                ref={firstFieldRef}
                id="crew-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. Jonas Vasquez"
                aria-invalid={!!formError && !name.trim()}
                className="hud-input font-sans"
              />
            </Field>
            <Field id="crew-callsign" label="Callsign">
              <input
                id="crew-callsign"
                type="text"
                value={callsign}
                onChange={(e) => setCallsign(e.target.value)}
                placeholder="ORION"
                className="hud-input uppercase"
              />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1 text-xs text-hud-muted">3D anatomy</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['female', 'male'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={sex === opt}
                  onClick={() => setSex(opt)}
                  className="hud-seg border border-hud-line py-1.5"
                >
                  {opt === 'female' ? '♀ Female' : '♂ Male'}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field id="crew-role" label="Role" className="col-span-2">
              <select id="crew-role" value={role} onChange={(e) => setRole(e.target.value)} className="hud-input font-sans">
                {CREW_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="crew-age" label="Age">
              <input id="crew-age" type="number" min={22} max={70} value={age} onChange={(e) => setAge(Number(e.target.value))} className="hud-input" />
            </Field>
            <Field id="crew-blood" label="Blood">
              <select id="crew-blood" value={bloodType} onChange={(e) => setBloodType(e.target.value as BloodType)} className="hud-input">
                {BLOOD_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {bt}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset className="rounded-xl border border-hud-line p-3">
            <legend className="px-1 text-xs text-hud-muted">Pre-flight baselines</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field id="crew-hr" label="Resting HR (bpm)">
                <input id="crew-hr" type="number" min={45} max={88} value={restingHrBaselineBpm} onChange={(e) => setRestingHrBaselineBpm(Number(e.target.value))} className="hud-input" />
              </Field>
              <Field id="crew-onsd" label="ONSD (mm)">
                <input id="crew-onsd" type="number" min={4.2} max={5.6} step={0.05} value={preFlightOnsdMm} onChange={(e) => setPreFlightOnsdMm(Number(e.target.value))} className="hud-input" />
              </Field>
              <Field id="crew-sols" label="Mission days">
                <input id="crew-sols" type="number" min={1} max={1000} value={missionDaysLogged} onChange={(e) => setMissionDaysLogged(Number(e.target.value))} className="hud-input" />
              </Field>
              <Field id="crew-streak" label="Countermeasure streak (d)">
                <input id="crew-streak" type="number" min={0} max={365} value={countermeasureStreakSols} onChange={(e) => setCountermeasureStreakSols(Number(e.target.value))} className="hud-input" />
              </Field>
            </div>
          </fieldset>

          <Field id="crew-scenario" label="Starting condition">
            <select id="crew-scenario" value={defaultScenarioId} onChange={(e) => setDefaultScenarioId(e.target.value as ScenarioId)} className="hud-input font-sans">
              {SCENARIO_IDS.map((id) => (
                <option key={id} value={id}>
                  {TELEMETRY_SCENARIOS[id].label}
                </option>
              ))}
            </select>
          </Field>

          <Field id="crew-notes" label="Medical notes">
            <textarea
              id="crew-notes"
              rows={2}
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              placeholder="SANS history, EVA workload, allergies…"
              className="hud-input font-sans"
            />
          </Field>

          <div className="flex items-center justify-between gap-3 border-t border-hud-line pt-4">
            <span className="flex items-center gap-2 text-xs text-hud-muted">
              Readiness preview
              <span className="font-mono text-sm font-semibold text-hud-text">{previewReadiness}%</span>
              <StatusPill status={readinessStatus(previewReadiness)} />
            </span>
            <button type="submit" className="hud-btn-primary">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add crew member
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
