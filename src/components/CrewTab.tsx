/**
 * ARGUS — Crew tab (specs/02-ui-dashboard.md §2.5)
 * Roster cards with per-crew zone status, readiness, check-in streak and expandable details.
 */

import React, { useState } from 'react';
import { Check, ChevronDown, ClipboardCheck, Trash2, UserPlus } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { getCrewAdjustedZones, TELEMETRY_SCENARIOS, ZONE_ORDER } from '../data/telemetryScenarios';
import { applyCheckIns, checkInStreak } from '../utils/checkIns';
import { calculateCrewReadinessScore, evaluateAllZones } from '../utils/triageEngine';
import { readinessStatus } from './TopMissionBar';
import { Card } from './ui/Card';
import { StatusIcon, StatusPill, STATUS_WORD } from './ui/StatusPill';
import { ZoneIcon, ZONE_SHORT_NAME } from './ui/ZoneIcon';

const DOT_TEXT = { green: 'text-status-green', yellow: 'text-status-yellow', red: 'text-status-red' } as const;

export const CrewTab: React.FC = () => {
  const {
    crewRoster,
    activeCrewMember,
    selectCrewMember,
    deleteCrewMember,
    setCrewModalOpen,
    setActiveTab,
    scenarioId,
    environment,
    checkIns,
    completedStepIds,
  } = useMission();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-wide text-hud-text">
          Crew <span className="font-sans text-sm font-normal text-hud-muted">· {crewRoster.length}</span>
        </h2>
        <button type="button" className="hud-btn" onClick={() => setCrewModalOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add crew member
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {crewRoster.map((m) => {
          const isActive = m.id === activeCrewMember.id;
          const sc = isActive ? scenarioId : m.defaultScenarioId;
          const entries = checkIns[m.id] || [];
          const zones = applyCheckIns(getCrewAdjustedZones(sc, m), entries);
          const statuses = evaluateAllZones(zones, environment);
          const readiness = calculateCrewReadinessScore(zones, environment, isActive ? completedStepIds.length : 0);
          const streak = checkInStreak(entries);
          const open = expanded === m.id;

          return (
            <Card
              key={m.id}
              as="article"
              className={isActive ? 'ring-1 ring-hud-accent/60' : ''}
              bodyClassName="p-4 space-y-3"
              ariaLabel={`${m.name}, ${m.callsign}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-hud-accent">{m.callsign}</p>
                  <p className="truncate text-sm font-semibold text-hud-text">{m.name}</p>
                  <p className="truncate text-xs text-hud-muted">
                    {m.role} · {m.sex === 'male' ? '♂' : '♀'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl font-semibold text-hud-text">{readiness}%</p>
                  <StatusPill status={readinessStatus(readiness)} />
                </div>
              </div>

              <ul className="flex items-center justify-between gap-1 rounded-lg border border-hud-line bg-hud-bg/50 px-2 py-1.5" aria-label="Zone status">
                {ZONE_ORDER.map((z) => (
                  <li
                    key={z}
                    className={`flex items-center gap-1 ${DOT_TEXT[statuses[z]]}`}
                    title={`${ZONE_SHORT_NAME[z]}: ${STATUS_WORD[statuses[z]]}`}
                  >
                    <ZoneIcon zone={z} className="h-3.5 w-3.5" />
                    <StatusIcon status={statuses[z]} className="h-3 w-3" />
                    <span className="sr-only">
                      {ZONE_SHORT_NAME[z]}: {STATUS_WORD[statuses[z]]}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                {isActive ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-hud-accent/15 px-2.5 py-1.5 text-xs font-medium text-hud-accent">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Active
                  </span>
                ) : (
                  <button type="button" className="hud-btn" onClick={() => selectCrewMember(m.id)}>
                    Set active
                  </button>
                )}
                <button
                  type="button"
                  className="hud-btn ml-auto"
                  aria-expanded={open}
                  aria-controls={`crew-details-${m.id}`}
                  onClick={() => setExpanded(open ? null : m.id)}
                >
                  Details
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              </div>

              {open && (
                <div id={`crew-details-${m.id}`} className="space-y-2 border-t border-hud-line pt-3 text-xs">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-hud-muted">Age · Blood</dt>
                    <dd className="font-mono text-hud-text">
                      {m.age} · {m.bloodType}
                    </dd>
                    <dt className="text-hud-muted">Resting HR baseline</dt>
                    <dd className="font-mono text-hud-text">{m.restingHrBaselineBpm} bpm</dd>
                    <dt className="text-hud-muted">Pre-flight ONSD</dt>
                    <dd className="font-mono text-hud-text">{m.preFlightOnsdMm} mm</dd>
                    <dt className="text-hud-muted">Mission day</dt>
                    <dd className="font-mono text-hud-text">{m.missionDaysLogged}</dd>
                    <dt className="text-hud-muted">Default condition</dt>
                    <dd className="text-hud-text">{TELEMETRY_SCENARIOS[m.defaultScenarioId].label}</dd>
                  </dl>
                  <p className="leading-relaxed text-hud-muted">{m.medicalNotes}</p>
                  {m.isCustom &&
                    (confirmDelete === m.id ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-status-red/40 bg-status-red/10 p-2">
                        <span className="text-red-200">Delete {m.callsign}? Their check-ins are removed too.</span>
                        <button type="button" className="hud-btn border-status-red/60 text-red-200" onClick={() => deleteCrewMember(m.id)}>
                          Delete crew member
                        </button>
                        <button type="button" className="hud-btn" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="hud-btn text-red-300" onClick={() => setConfirmDelete(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                      </button>
                    ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};
