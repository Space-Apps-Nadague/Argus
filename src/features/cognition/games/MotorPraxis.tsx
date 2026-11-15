/**
 * Target Lock — Motor Praxis: hit 20 squares that appear at random places and keep shrinking.
 * Source: SRC-089 (Motor Praxis: sensory-motor speed), SRC-094 (task description: 20 squares, decreasing size)
 */
import React, { useEffect, useRef, useState } from 'react';
import { mulberry32 } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, now } from './common';

const TARGETS = 20; // Source: SRC-094

export const MotorPraxis: React.FC<GameProps> = ({ seed, onProgress, onDone }) => {
  const rand = useRef(mulberry32(seed));
  const [i, setI] = useState(0);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [combo, setCombo] = useState(0);
  const [shake, setShake] = useState(false);
  const shownAt = useRef(now());
  const startAt = useRef(now());
  const rts = useRef<number[]>([]);
  const misses = useRef(0);
  const points = useRef(0);

  const size = 72 - (i / TARGETS) * 50; // px, shrinks 72 → 22

  const place = () => {
    setPos({ x: 8 + rand.current() * 84, y: 10 + rand.current() * 80 });
    shownAt.current = now();
  };
  useEffect(() => {
    startAt.current = now();
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hit = (e: React.PointerEvent) => {
    e.stopPropagation();
    const rt = now() - shownAt.current;
    rts.current.push(rt);
    const c = combo + 1;
    setCombo(c);
    points.current += Math.round(clamp(60 - rt / 25, 10, 50) * (1 + Math.min(c, 10) * 0.05));
    sfx.hit();
    const next = i + 1;
    onProgress({ points: Math.min(points.current, 1000), progress: next / TARGETS, combo: c });
    if (next >= TARGETS) {
      const totalSec = (now() - startAt.current) / 1000;
      const acc = TARGETS / (TARGETS + misses.current);
      onDone({
        points: clamp(Math.round(points.current - misses.current * 10), 0, 1000),
        metric: Number((TARGETS / totalSec).toFixed(3)),
        accuracy: acc,
        meanRtMs: Math.round(rts.current.reduce((a, b) => a + b, 0) / rts.current.length),
        extra: { misses: misses.current },
      });
      return;
    }
    setI(next);
    place();
  };

  const miss = () => {
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
      aria-label={`Target ${i + 1} of ${TARGETS}`}
    >
      <button
        key={i}
        type="button"
        onPointerDown={hit}
        aria-label="Target"
        className="game-pop absolute -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-hud-accent bg-hud-accent/30 shadow-[0_0_18px_rgba(34,211,238,0.5)]"
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: size, height: size }}
      />
      <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-xs text-hud-muted">
        {i + 1}/{TARGETS}
      </span>
    </div>
  );
};
