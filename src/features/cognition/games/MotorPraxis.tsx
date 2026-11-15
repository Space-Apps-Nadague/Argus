/**
 * Target Lock — Motor Praxis, hard 3-minute version: squares appear at random places, keep shrinking
 * (48 → 14 px over each wave of 20) and vanish after 1.1 s if not hit.
 * Source: SRC-089 (Motor Praxis: sensory-motor speed), SRC-094 (task description: 20 squares, decreasing size).
 * Hard level, 3-minute time box, time-out and size range are ARGUS choices (spec §12.1).
 */
import React, { useEffect, useRef, useState } from 'react';
import { mulberry32 } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, now, useTimeBox } from './common';

const WAVE = 20; // Source: SRC-094 (20 squares, decreasing size)
const MAX_PX = 48;
const MIN_PX = 14;
const TARGET_TIMEOUT_MS = 1100;

export const MotorPraxis: React.FC<GameProps> = ({ seed, durationSec, onProgress, onDone }) => {
  const rand = useRef(mulberry32(seed));
  const [n, setN] = useState(0);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [combo, setCombo] = useState(0);
  const [shake, setShake] = useState(false);
  const shownAt = useRef(now());
  const rts = useRef<number[]>([]);
  const misses = useRef(0);
  const timeouts = useRef(0);
  const points = useRef(0);
  const done = useRef(false);
  const timer = useRef(0);
  const progress = useRef(0);

  const size = MAX_PX - ((n % WAVE) / (WAVE - 1)) * (MAX_PX - MIN_PX);

  const place = () => {
    setPos({ x: 6 + rand.current() * 88, y: 8 + rand.current() * 84 });
    shownAt.current = now();
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (done.current) return;
      timeouts.current++;
      setCombo(0);
      sfx.miss();
      setN((k) => k + 1);
      place();
    }, TARGET_TIMEOUT_MS);
  };
  useEffect(() => {
    place();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAt = useTimeBox(
    durationSec,
    (p) => {
      progress.current = p;
      onProgress({ points: clamp(Math.round(points.current), 0, 1000), progress: p, combo });
    },
    () => {
      done.current = true;
      clearTimeout(timer.current);
      const hits = rts.current.length;
      const totalSec = Math.max(1, (now() - startAt.current) / 1000);
      const attempts = hits + misses.current + timeouts.current;
      onDone({
        points: clamp(Math.round(points.current - misses.current * 4), 0, 1000),
        metric: Number((hits / totalSec).toFixed(3)),
        accuracy: attempts ? hits / attempts : 0,
        meanRtMs: hits ? Math.round(rts.current.reduce((a, b) => a + b, 0) / hits) : 0,
        extra: { hits, misses: misses.current, timeouts: timeouts.current },
      });
    }
  );

  const hit = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (done.current) return;
    const rt = now() - shownAt.current;
    rts.current.push(rt);
    const c = combo + 1;
    setCombo(c);
    points.current += clamp(14 - rt / 100, 3, 12) * (1 + Math.min(c, 10) * 0.05);
    sfx.hit();
    onProgress({ points: clamp(Math.round(points.current), 0, 1000), progress: progress.current, combo: c });
    setN((k) => k + 1);
    place();
  };

  const miss = () => {
    if (done.current) return;
    misses.current++;
    setCombo(0);
    sfx.miss();
    setShake(true);
    setTimeout(() => setShake(false), 250);
  };

  return (
    <div
      onPointerDown={miss}
      className={`relative h-80 w-full touch-none select-none overflow-hidden rounded-xl border border-hud-line bg-hud-bg/60 hud-grid-bg ${shake ? 'game-shake' : ''}`}
      role="application"
      aria-label={`Target ${n + 1}`}
    >
      <button
        key={n}
        type="button"
        onPointerDown={hit}
        aria-label="Target"
        className="game-pop absolute -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-hud-accent bg-hud-accent/30 shadow-[0_0_18px_rgba(34,211,238,0.5)]"
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: size, height: size }}
      />
      <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-xs text-hud-muted">
        hits {rts.current.length}
      </span>
    </div>
  );
};
