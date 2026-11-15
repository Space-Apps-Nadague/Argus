/**
 * Reflex — Psychomotor Vigilance Test, brief 3-minute version (PVT-B).
 * Source: SRC-090 (PVT-B: 3 min, inter-stimulus interval 1–4 s, lapse ≥ 355 ms, false start < 100 ms)
 * Also counts lapses ≥ 500 ms, the definition the existing `pvt_lapses` vital uses (triageEngine.ts).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { mulberry32 } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, mean, now } from './common';

export const PVT_LAPSE_MS = 355; // Source: SRC-090
export const PVT_CLASSIC_LAPSE_MS = 500; // standard 10-min PVT lapse; existing pvt_lapses metric
export const PVT_FALSE_START_MS = 100; // Source: SRC-090
const ISI_MIN_MS = 1000; // Source: SRC-090
const ISI_MAX_MS = 4000;
const TIMEOUT_MS = 30_000;

export const Pvt: React.FC<GameProps> = ({ seed, durationSec, onProgress, onDone }) => {
  const rand = useRef(mulberry32(seed));
  const [phase, setPhase] = useState<'wait' | 'stim' | 'feedback'>('wait');
  const [counter, setCounter] = useState(0);
  const [last, setLast] = useState<{ text: string; good: boolean } | null>(null);
  const rts = useRef<number[]>([]);
  const falseStarts = useRef(0);
  const stimAt = useRef(0);
  const startAt = useRef(now());
  const timers = useRef<number[]>([]);
  const raf = useRef(0);
  const finished = useRef(false);

  const pointsNow = () => {
    const speed = mean(rts.current.map((rt) => 1000 / rt));
    const lapses = rts.current.filter((rt) => rt >= PVT_LAPSE_MS).length;
    return clamp(Math.round(speed * 200 - lapses * 25 - falseStarts.current * 25), 0, 1000);
  };

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    timers.current.forEach(clearTimeout);
    cancelAnimationFrame(raf.current);
    const list = rts.current;
    const speed = mean(list.map((rt) => 1000 / rt));
    onDone({
      points: pointsNow(),
      metric: Number(speed.toFixed(3)),
      meanRtMs: Math.round(mean(list)),
      extra: {
        responses: list.length,
        lapses355: list.filter((rt) => rt >= PVT_LAPSE_MS).length,
        lapses500: list.filter((rt) => rt >= PVT_CLASSIC_LAPSE_MS).length,
        falseStarts: falseStarts.current,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDone]);

  const schedule = useCallback(() => {
    const elapsed = now() - startAt.current;
    if (elapsed >= durationSec * 1000) return finish();
    setPhase('wait');
    const isi = ISI_MIN_MS + rand.current() * (ISI_MAX_MS - ISI_MIN_MS);
    timers.current.push(
      window.setTimeout(() => {
        stimAt.current = now();
        setPhase('stim');
        const tickFn = () => {
          const ms = now() - stimAt.current;
          setCounter(Math.floor(ms));
          if (ms > TIMEOUT_MS) {
            rts.current.push(TIMEOUT_MS);
            schedule();
            return;
          }
          raf.current = requestAnimationFrame(tickFn);
        };
        raf.current = requestAnimationFrame(tickFn);
      }, isi)
    );
  }, [durationSec, finish]);

  useEffect(() => {
    startAt.current = now();
    schedule();
    const tick = window.setInterval(() => {
      const p = clamp((now() - startAt.current) / (durationSec * 1000), 0, 1);
      onProgress({ points: pointsNow(), progress: p });
    }, 250);
    return () => {
      clearInterval(tick);
      timers.current.forEach(clearTimeout);
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respond = useCallback(() => {
    if (finished.current) return;
    if (phase === 'stim') {
      const rt = now() - stimAt.current;
      cancelAnimationFrame(raf.current);
      if (rt < PVT_FALSE_START_MS) {
        falseStarts.current++;
        sfx.miss();
        setLast({ text: 'Too early', good: false });
      } else {
        rts.current.push(rt);
        rt >= PVT_LAPSE_MS ? sfx.miss() : sfx.hit();
        setLast({ text: `${Math.round(rt)} ms`, good: rt < PVT_LAPSE_MS });
      }
      setPhase('feedback');
      timers.current.push(window.setTimeout(schedule, 500));
    } else if (phase === 'wait') {
      falseStarts.current++;
      sfx.miss();
      setLast({ text: 'Too early', good: false });
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPhase('feedback');
      timers.current.push(window.setTimeout(schedule, 700));
    }
  }, [phase, schedule]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        respond();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [respond]);

  return (
    <button
      type="button"
      onPointerDown={respond}
      className={`hud-focus flex h-72 w-full select-none flex-col items-center justify-center rounded-xl border-2 transition-colors ${
        phase === 'stim' ? 'border-hud-accent bg-hud-accent/10' : 'border-hud-line bg-hud-bg/60'
      }`}
      aria-label="Reaction pad. Press when the counter starts."
    >
      {phase === 'stim' ? (
        <span className="font-mono text-6xl font-bold tabular-nums text-hud-accent">{counter}</span>
      ) : phase === 'feedback' && last ? (
        <span className={`game-pop font-display text-3xl font-bold ${last.good ? 'text-status-green' : 'text-status-red'}`}>
          {last.text}
        </span>
      ) : (
        <span className="font-display text-lg tracking-widest text-hud-muted">WAIT…</span>
      )}
      <span className="mt-4 text-xs text-hud-muted">Tap, click or press Space</span>
    </button>
  );
};
