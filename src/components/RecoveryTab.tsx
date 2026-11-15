/**
 * ARGUS — Return to Earth tab (local demo): each astronaut's personal 45-day recovery plan after landing
 * (src/features/recovery/plan.ts). When the mission location becomes "Earth · after mission" the tab opens
 * (`WelcomeHome`) and ARGUS starts talking by itself: "Welcome home…" and the focus of the plan.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Flag, Globe, HeartPulse, Square } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { Card } from './ui/Card';
import { sayLine } from '../utils/alarmTone';
import {
  buildRecoveryPlan,
  daysBetween,
  minutesForDay,
  phaseOf,
  RECOVERY_DAYS,
  tasksForDay,
  welcomeSpeech,
  type FindingStatus,
} from '../features/recovery/plan';

const LANDING_KEY = 'argus.recovery.landing.v1';
const DONE_KEY = 'argus.recovery.done.v1';

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const readJson = <T,>(k: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? '') as T) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export function landingDayOf(crewId: string): string | null {
  return readJson<Record<string, string>>(LANDING_KEY, {})[crewId] ?? null;
}
export function setLandingDay(crewId: string, key: string): void {
  writeJson(LANDING_KEY, { ...readJson<Record<string, string>>(LANDING_KEY, {}), [crewId]: key });
}

const STATUS: Record<FindingStatus, { cls: string; label: string }> = {
  red: { cls: 'border-red-500/60 bg-red-500/10 text-red-300', label: 'Focus' },
  yellow: { cls: 'border-amber-500/60 bg-amber-500/10 text-amber-300', label: 'Watch' },
  green: { cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300', label: 'Fine' },
};

function usePlan() {
  const { activeCrewMember, zones } = useMission();
  const readings = useMemo(() => Object.values(zones).flat(), [zones]);
  return useMemo(() => buildRecoveryPlan(activeCrewMember, readings), [activeCrewMember, readings]);
}

/** Says "Welcome home…" and opens the tab when the location changes to Earth after the mission. */
export const WelcomeHome: React.FC = () => {
  const { activeCrewMember, spaceLocationId, setActiveTab } = useMission();
  const prev = useRef<{ crew: string; loc: string } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = { crew: activeCrewMember.id, loc: spaceLocationId };
    if (!p || p.crew !== activeCrewMember.id) return; // first render or crew switch: not a landing
    if (spaceLocationId === 'earth_post' && p.loc !== 'earth_post') {
      if (!landingDayOf(activeCrewMember.id)) setLandingDay(activeCrewMember.id, todayKey());
      setActiveTab('recovery'); // the tab speaks the welcome when it opens
    }
  }, [spaceLocationId, activeCrewMember, setActiveTab]);
  return null;
};

export const RecoveryTab: React.FC = () => {
  const { activeCrewMember, spaceLocationId, setSpaceLocation } = useMission();
  const plan = usePlan();
  const crewId = activeCrewMember.id;
  const landed = landingDayOf(crewId) ?? todayKey();
  const realDay = Math.max(0, daysBetween(landed, todayKey()));
  const [day, setDay] = useState(Math.min(realDay, RECOVERY_DAYS - 1));
  const [done, setDone] = useState<Record<string, boolean>>(() => readJson(DONE_KEY, {}));
  useEffect(() => setDay(Math.min(realDay, RECOVERY_DAYS - 1)), [crewId, realDay]);

  // ARGUS talks as soon as the plan is on screen (opening the tab, landing, or switching astronaut).
  const planRef = useRef(plan);
  planRef.current = plan;
  const landedNow = spaceLocationId === 'earth_post';
  useEffect(() => {
    if (!landedNow) return;
    return sayLine(welcomeSpeech(activeCrewMember.callsign, planRef.current));
  }, [landedNow, crewId, activeCrewMember.callsign]);

  if (spaceLocationId !== 'earth_post') {
    return (
      <Card title="Return to Earth" icon={<Globe className="h-4 w-4" />}>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <Globe className="h-12 w-12 text-hud-accent" aria-hidden="true" />
          <p className="max-w-md text-sm text-hud-muted">
            After landing, ARGUS builds {activeCrewMember.callsign}’s personal {RECOVERY_DAYS}-day plan to get back to full health, from the mission data.
          </p>
          <button
            type="button"
            className="hud-btn-primary px-5 py-2.5"
            onClick={() => {
              setLandingDay(crewId, todayKey());
              setSpaceLocation('earth_post');
            }}
          >
            Land: set location to Earth · after mission
          </button>
        </div>
      </Card>
    );
  }

  const phase = phaseOf(plan, day);
  const tasks = tasksForDay(plan, day);
  const k = (id: string) => `${crewId}|${day}|${id}`;
  const doneCount = tasks.filter((t) => done[k(t.id)]).length;
  const toggle = (id: string) => {
    const next = { ...done, [k(id)]: !done[k(id)] };
    setDone(next);
    writeJson(DONE_KEY, next);
  };
  const nextCheckpoint = plan.checkpoints.find((c) => c.day >= day);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-hud-text">
          <Globe className="h-5 w-5 text-hud-accent" aria-hidden="true" /> Return to Earth · {activeCrewMember.callsign}
        </h2>
        <span className="text-xs text-hud-muted">landed {landed} · {plan.missionDays} days in space</span>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-hud-line px-1 py-0.5">
          <button type="button" className="hud-btn h-7 w-7 p-0" onClick={() => setDay((d) => Math.max(0, d - 1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[7.5rem] text-center font-mono text-sm text-hud-text">Day {day} of {RECOVERY_DAYS - 1}</span>
          <button type="button" className="hud-btn h-7 w-7 p-0" onClick={() => setDay((d) => Math.min(RECOVERY_DAYS - 1, d + 1))} aria-label="Next day">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 45-day timeline with phases and checkpoints */}
      <Card>
        <div className="relative">
          <div className="flex h-8 overflow-hidden rounded-lg">
            {plan.phases.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center justify-center text-[11px] font-semibold ${['bg-sky-500/30', 'bg-violet-500/30', 'bg-emerald-500/30'][i]} ${p.id === phase.id ? 'text-hud-text' : 'text-hud-muted'}`}
                style={{ width: `${((p.to - p.from + 1) / RECOVERY_DAYS) * 100}%` }}
              >
                {p.title} · R+{p.from}–{p.to}
              </div>
            ))}
          </div>
          <div className="absolute -top-1 h-10 w-0.5 bg-hud-accent" style={{ left: `${((day + 0.5) / RECOVERY_DAYS) * 100}%` }} aria-hidden="true" />
          <div className="relative mt-1 h-5">
            {plan.checkpoints.map((c) => (
              <button
                key={c.day}
                type="button"
                className="absolute -translate-x-1/2 text-hud-muted hover:text-hud-accent"
                style={{ left: `${((c.day + 0.5) / RECOVERY_DAYS) * 100}%` }}
                onClick={() => setDay(c.day)}
                title={`${c.title}: ${c.tests.join(', ')}`}
                aria-label={`Checkpoint ${c.title}`}
              >
                <Flag className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-hud-text">
          <span className="font-semibold">{phase.title}:</span> <span className="text-hud-muted">{phase.goal}</span>
        </p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title={`Today · R+${day}`} icon={<Check className="h-4 w-4" />} actions={<span className="text-xs text-hud-muted">{doneCount}/{tasks.length} done · ~{minutesForDay(plan, day)} min</span>}>
          <ul className="space-y-1.5">
            {tasks.map((t) => {
              const isDone = !!done[k(t.id)];
              const f = t.forFinding ? plan.findings.find((x) => x.id === t.forFinding) : null;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => toggle(t.id)}
                    aria-pressed={isDone}
                    className="hud-focus flex w-full items-start gap-2 rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2 text-left hover:border-hud-accent/60"
                  >
                    {isDone ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-hud-muted" aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold ${isDone ? 'text-hud-muted line-through' : 'text-hud-text'}`}>
                        {t.title}
                        {t.minutes > 0 && <span className="ml-2 font-mono text-[11px] font-normal text-hud-muted">{t.minutes} min</span>}
                      </span>
                      <span className="block text-xs text-hud-muted">{t.detail}</span>
                    </span>
                    {f && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${STATUS[f.status].cls}`}>{f.title}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {nextCheckpoint && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-hud-muted">
              <Flag className="h-3.5 w-3.5 text-hud-accent" aria-hidden="true" />
              {nextCheckpoint.day === day ? 'Checkpoint today' : `Next checkpoint R+${nextCheckpoint.day}`}: {nextCheckpoint.tests.join(', ')}
            </p>
          )}
        </Card>

        <Card title="From your mission data" icon={<HeartPulse className="h-4 w-4" />}>
          <ul className="space-y-2">
            {plan.findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-hud-line bg-hud-bg/50 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-hud-text">{f.title}</span>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS[f.status].cls}`}>{STATUS[f.status].label}</span>
                </div>
                <p className="mt-0.5 text-xs text-hud-text">{f.summary}</p>
                <p className="text-[11px] text-hud-muted">Back to baseline: {f.outlook}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="text-[11px] text-hud-muted">
        Based on NASA’s post-flight reconditioning (45 days from landing, tailored per astronaut). ARGUS builds it from the mission data as decision support;
        the flight surgeon and the reconditioning specialists set the real plan. Recovery times are typical ranges and vary.
      </p>
    </div>
  );
};
