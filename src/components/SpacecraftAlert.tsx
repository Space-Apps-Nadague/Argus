/**
 * ARGUS — Spacecraft alarm (demo, see src/features/spacecraft/habitat.ts).
 * ARGUS detected a cabin problem, changed the ship's systems itself (safe actions), and asks the crew
 * before bigger ones. Rings once, says "ARGUS", then explains out loud what it saw, what it changed and
 * what it needs; then listens for "confirm" / "cancel" / "undo" / "status" (browser speech recognition,
 * when available). The live reading recovers on the card as the actions take effect.
 * Settings → "Spacecraft: …" starts each scenario (`triggerSpacecraftEvent`).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Mic, MicOff, RotateCcw, Satellite, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { runAlertSequence, sayLine } from '../utils/alarmTone';
import {
  eventSpeech,
  parseVoiceIntent,
  SPACECRAFT_EVENTS,
  statusSpeech,
  valueAt,
  type SpacecraftEvent,
  type SpacecraftEventId,
} from '../features/spacecraft/habitat';

const EVENT = 'argus:spacecraft-event';

/** Starts a simulated spacecraft event (Settings menu). */
export function triggerSpacecraftEvent(id: SpacecraftEventId): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

type ActionState = 'done' | 'undone' | 'pending' | 'confirmed' | 'declined';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const recognitionCtor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const SpacecraftAlert: React.FC = () => {
  const { activeCrewMember } = useMission();
  const [ev, setEv] = useState<SpacecraftEvent | null>(null);
  const [states, setStates] = useState<Record<string, ActionState>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const stopSound = useRef<() => void>(() => undefined);
  const rec = useRef<Recognition | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<SpacecraftEventId>).detail;
      const next = SPACECRAFT_EVENTS[id];
      if (!next) return;
      setEv(next);
      setStates(Object.fromEntries(next.actions.map((a) => [a.id, a.tier === 'auto' ? 'done' : 'pending'])));
      setStartedAt(Date.now());
      setHeard('');
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // Live reading.
  useEffect(() => {
    if (!ev) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [ev]);

  const stopListening = useCallback(() => {
    try {
      rec.current?.stop();
    } catch {
      /* ignore */
    }
    rec.current = null;
    setListening(false);
  }, []);

  const current = ev ? valueAt(ev.reading, Math.max(0, (now - startedAt) / 1000 - 3)) : 0;

  const handleIntent = useCallback(
    (intent: ReturnType<typeof parseVoiceIntent>) => {
      if (!ev || !intent) return;
      const pending = ev.actions.filter((a) => states[a.id] === 'pending');
      if (intent === 'confirm' && pending.length) {
        setStates((s) => ({ ...s, ...Object.fromEntries(pending.map((a) => [a.id, 'confirmed'])) }));
        stopSound.current = sayLine(`Done. I ${pending.map((a) => a.say.replace(/^(\w+)/, (w) => (w.endsWith('e') ? `${w}d` : `${w}ed`))).join(' and ')}.`);
      } else if (intent === 'cancel' && pending.length) {
        setStates((s) => ({ ...s, ...Object.fromEntries(pending.map((a) => [a.id, 'declined'])) }));
        stopSound.current = sayLine('OK, I will not do that. Tell me if you change your mind.');
      } else if (intent === 'undo') {
        setStates((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === 'done' ? 'undone' : v])));
        stopSound.current = sayLine('Undone. The systems are back to their previous settings.');
      } else if (intent === 'status') {
        stopSound.current = sayLine(statusSpeech(ev, current));
      }
    },
    [ev, states, current]
  );

  const listen = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    try {
      const r = new Ctor();
      r.lang = 'en-US';
      r.continuous = false;
      r.interimResults = false;
      r.onresult = (e) => {
        const text = Array.from(e.results).map((res) => res[0]?.transcript ?? '').join(' ');
        setHeard(text);
        handleIntent(parseVoiceIntent(text));
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      rec.current = r;
      setListening(true);
      r.start();
    } catch {
      setListening(false);
    }
  }, [handleIntent]);

  // Announce, then listen for the reply.
  useEffect(() => {
    if (!ev) return;
    stopSound.current();
    stopSound.current = runAlertSequence(eventSpeech(ev, activeCrewMember.callsign), 1, { intro: 'ARGUS!', onDone: () => listen() });
    okRef.current?.focus();
    return () => {
      stopSound.current();
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev]);

  if (!ev) return null;

  const close = () => {
    stopSound.current();
    stopListening();
    setEv(null);
  };
  const red = ev.severity === 'red';
  const colour = red ? '#e10600' : '#d97706';
  const r = ev.reading;
  const progress = Math.min(1, Math.abs(r.value - current) / Math.abs(r.value - r.target));
  const canListen = Boolean(recognitionCtor());
  const pendingCount = ev.actions.filter((a) => states[a.id] === 'pending').length;

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="sc-title" className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-[2rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl">
        <div className="rounded-[1.4rem] border-4 bg-white px-5 pb-5 pt-5 text-neutral-900" style={{ borderColor: colour }}>
          <div className="flex items-center gap-2">
            <Satellite className="h-5 w-5" style={{ color: colour }} aria-hidden="true" />
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-neutral-500">ARGUS · Spacecraft</p>
            <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: colour }}>
              {red ? 'Alarm' : 'Caution'}
            </span>
          </div>
          <h2 id="sc-title" className="mt-1 text-3xl font-black uppercase leading-none" style={{ color: colour }}>
            {ev.title}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {ev.module} · demo spacecraft (simulated systems) · {activeCrewMember.callsign}
          </p>

          <div className="mt-3 rounded-xl bg-neutral-100 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{r.label}</span>
              <span className="font-mono text-3xl font-bold tabular-nums" style={{ color: progress > 0.9 ? '#16a34a' : colour }}>
                {current.toFixed(r.decimals)} <span className="text-sm">{r.unit}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-300" aria-hidden="true">
              <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">
              Detected {r.value} {r.unit} · normal {r.nominal} · {progress > 0.9 ? 'back to normal' : 'recovering'}
            </p>
          </div>

          <h3 className="mt-3 text-xs font-bold uppercase tracking-widest text-neutral-500">What I changed</h3>
          <ul className="mt-1 space-y-1">
            {ev.actions.map((a) => {
              const st = states[a.id];
              return (
                <li key={a.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm">
                  {st === 'done' || st === 'confirmed' ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  ) : st === 'pending' ? (
                    <span className="h-4 w-4 shrink-0 rounded-full border-2 border-amber-500" aria-hidden="true" />
                  ) : (
                    <X className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{a.system}</span>{' '}
                    <span className="text-neutral-500">
                      {st === 'undone' || st === 'declined' ? a.from : `${a.from} → ${a.to}`}
                    </span>
                  </span>
                  {st === 'pending' && (
                    <>
                      <button type="button" className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white" onClick={() => handleIntent('confirm')}>
                        Confirm
                      </button>
                      <button type="button" className="rounded-md bg-neutral-200 px-2 py-1 text-xs font-bold" onClick={() => handleIntent('cancel')}>
                        Cancel
                      </button>
                    </>
                  )}
                  {st === 'done' && (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                      onClick={() => setStates((s) => ({ ...s, [a.id]: 'undone' }))}
                      aria-label={`Undo: ${a.system}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Undo
                    </button>
                  )}
                  {st === 'confirmed' && <span className="text-xs text-emerald-700">confirmed</span>}
                  {st === 'declined' && <span className="text-xs text-neutral-500">not done</span>}
                </li>
              );
            })}
          </ul>

          <h3 className="mt-3 text-xs font-bold uppercase tracking-widest text-neutral-500">What you should do</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {ev.advice.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>

          <div className="mt-4 flex items-center gap-2">
            {canListen ? (
              <button
                type="button"
                onClick={() => (listening ? stopListening() : listen())}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${listening ? 'animate-pulse bg-sky-600 text-white' : 'bg-neutral-200'}`}
                aria-pressed={listening}
              >
                {listening ? <Mic className="h-4 w-4" aria-hidden="true" /> : <MicOff className="h-4 w-4" aria-hidden="true" />}
                {listening ? `Listening… say ${pendingCount ? '"confirm" or "cancel"' : '"status" or "undo"'}` : 'Talk to ARGUS'}
              </button>
            ) : (
              <span className="text-[11px] text-neutral-500">Voice replies need Chrome or Edge; use the buttons.</span>
            )}
            {heard && <span className="truncate text-[11px] text-neutral-500">heard: “{heard}”</span>}
            <button
              ref={okRef}
              type="button"
              onClick={close}
              className="ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-500 font-bold text-white hover:bg-neutral-600"
              aria-label="OK, close the spacecraft alarm"
            >
              OK
            </button>
          </div>
          <p className="mt-2 text-[10px] text-neutral-400">
            Demo: the spacecraft systems are simulated. Safe actions run automatically and can be undone; bigger ones wait for the crew; life-support shutdowns are never automated.
          </p>
        </div>
      </div>
    </div>
  );
};
