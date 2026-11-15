/**
 * ARGUS — Training tab (specs/02-ui-dashboard.md §2.6)
 * Tells the crew member whether today's metrics call for training, which exercises to do and how:
 * an animated 3-D astronaut, steps and common mistakes. In microgravity the exercises use the
 * ISS devices (ARED, treadmill with harness, cycle ergometer); with gravity, body-weight exercises.
 */

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, Dumbbell, Orbit, Pause, Play } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { Card } from './ui/Card';
import { EXERCISES, exercisesFor, settingNote, type ExerciseId } from '../features/training/exercises';
import { recommendTraining } from '../features/training/recommend';

const ExerciseFigure3D = lazy(() =>
  import('../features/training/ExerciseFigure3D').then((m) => ({ default: m.ExerciseFigure3D }))
);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const TrainingTab: React.FC = () => {
  const { zones, zoneStatuses, environment, activeCrewMember } = useMission();
  const plan = useMemo(() => recommendTraining(zones, zoneStatuses, environment), [zones, zoneStatuses, environment]);
  const ordered = useMemo(() => {
    const library = exercisesFor(environment);
    return [...plan.exercises, ...library.filter((id) => !plan.exercises.includes(id))];
  }, [plan.exercises, environment]);
  const [selected, setSelected] = useState<ExerciseId>(ordered[0]);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());

  // Moving between microgravity and gravity changes the library: keep the selection valid.
  useEffect(() => {
    if (!ordered.includes(selected)) setSelected(ordered[0]);
  }, [ordered, selected]);
  const exercise = EXERCISES[ordered.includes(selected) ? selected : ordered[0]];

  const banner =
    plan.state === 'unsafe' ? (
      <div role="alert" className="flex gap-3 rounded-xl border border-red-500/60 bg-red-500/10 p-4">
        <AlertOctagon className="h-6 w-6 shrink-0 text-red-400" aria-hidden="true" />
        <div>
          <p className="font-semibold text-red-200">Do not exercise now, {activeCrewMember.callsign}.</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-100">
            {plan.reasons.map((r) => (
              <li key={r.metricId}>{r.text}</li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-red-100">Rest and contact the crew medical officer. Training resumes when these are back in range.</p>
        </div>
      </div>
    ) : plan.state === 'required' ? (
      <div className="flex gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
        <Dumbbell className="h-6 w-6 shrink-0 text-amber-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-amber-200">Training required today</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-hud-text">
            {plan.reasons.map((r) => (
              <li key={r.metricId}>{r.text}</li>
            ))}
          </ul>
        </div>
      </div>
    ) : (
      <div className="flex gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-300" aria-hidden="true" />
        <p className="text-sm text-hud-text">
          <span className="font-semibold text-emerald-200">No extra training needed today.</span> Muscle and bone metrics are in range. Keep your normal daily routine; the library below shows correct form.
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      {banner}
      <p className="flex items-start gap-2 rounded-lg border border-hud-line bg-hud-panel/60 px-3 py-2 text-xs text-hud-muted">
        <Orbit className="mt-0.5 h-4 w-4 shrink-0 text-hud-accent" aria-hidden="true" />
        {settingNote(environment)}
      </p>

      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card title="Exercises" icon={<Dumbbell className="h-4 w-4" />} bodyClassName="p-2">
          <ul className="space-y-1" role="listbox" aria-label="Exercises">
            {ordered.map((id) => {
              const e = EXERCISES[id];
              const recommended = plan.exercises.includes(id);
              const active = id === selected;
              return (
                <li key={id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelected(id)}
                    className={`hud-focus flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active ? 'bg-hud-accent/15 text-hud-text ring-1 ring-hud-accent/50' : 'text-hud-muted hover:bg-hud-panel hover:text-hud-text'
                    }`}
                  >
                    <span>
                      <span className="block font-medium">{e.name}</span>
                      <span className="block text-[11px] text-hud-muted">{e.dose}</span>
                    </span>
                    {recommended && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                        Today
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title={exercise.name}
          icon={<Dumbbell className="h-4 w-4" />}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="relative aspect-video overflow-hidden rounded-xl border border-hud-line bg-[#0b1220]">
                <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-hud-muted">Loading 3-D astronaut…</div>}>
                  <ExerciseFigure3D exerciseId={exercise.id} playing={playing} />
                </Suspense>
                <button
                    type="button"
                    onClick={() => setPlaying((p) => !p)}
                    className="hud-btn absolute bottom-2 right-2 !px-2 !py-1 text-xs"
                    aria-label={playing ? 'Pause animation' : 'Play animation'}
                  >
                    {playing ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                    {playing ? 'Pause' : 'Play'}
                </button>
              </div>
              <p className="text-[11px] text-hud-muted">Drag to turn the astronaut, scroll to zoom.</p>
            </div>

            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-hud-muted">Dose</dt>
                <dd className="font-medium text-hud-text">{exercise.dose}</dd>
                <dt className="text-hud-muted">Works</dt>
                <dd className="text-hud-text">{exercise.targets}</dd>
                {exercise.equipment && (
                  <>
                    <dt className="text-hud-muted">Device</dt>
                    <dd className="text-hud-text">{exercise.equipment}</dd>
                  </>
                )}
              </dl>
              <p className="text-hud-muted">{exercise.why}</p>
              <div>
                <h3 className="mb-1 font-display text-xs font-semibold tracking-wide text-hud-text">HOW TO DO IT</h3>
                <ol className="list-decimal space-y-1 pl-5 text-hud-text">
                  {exercise.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
              <div>
                <h3 className="mb-1 font-display text-xs font-semibold tracking-wide text-hud-text">AVOID</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-hud-muted">
                  {exercise.mistakes.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
              <p className="rounded-lg border border-hud-line bg-hud-panel/60 p-2 text-xs text-hud-muted">
                <span className="font-semibold text-hud-text">Tip: </span>
                {exercise.note}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
