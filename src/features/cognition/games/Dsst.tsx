/**
 * Code Breaker — Digit Symbol Substitution: use the key to match each symbol to its digit, as fast as possible.
 * Source: SRC-089 (DSST: complex scanning and visual tracking), SRC-095 (DSST best single predictor of 6-DOF docking)
 */
import React, { useEffect, useRef, useState } from 'react';
import { Glyph, GlyphSpec, SHAPES } from '../Glyph';
import { mulberry32, randInt, shuffle } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, now } from './common';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function makeKey(seed: number): GlyphSpec[] {
  const rand = mulberry32(seed);
  // 9 distinct single-color symbols: 6 shapes plus rotated/outlined variants.
  const base: GlyphSpec[] = [
    ...SHAPES.map((shape) => ({ shape, color: 0, fill: 'outline' as const, count: 1 })),
    { shape: 'triangle', color: 0, fill: 'solid', count: 1, rot: 180 },
    { shape: 'square', color: 0, fill: 'striped', count: 1, rot: 45 },
    { shape: 'circle', color: 0, fill: 'solid', count: 2 },
  ];
  return shuffle(base, rand);
}

export const Dsst: React.FC<GameProps> = ({ seed, durationSec, onProgress, onDone }) => {
  const key = useRef(makeKey(seed)).current;
  const rand = useRef(mulberry32(seed ^ 0x5bd1e995));
  const [target, setTarget] = useState(() => randInt(rand.current, 0, 8));
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const correct = useRef(0);
  const wrong = useRef(0);
  const combo = useRef(0);
  const points = useRef(0);
  const startAt = useRef(now());
  const shownAt = useRef(now());
  const rts = useRef<number[]>([]);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const minutes = (now() - startAt.current) / 60000;
    const total = correct.current + wrong.current;
    onDone({
      points: clamp(Math.round(points.current), 0, 1000),
      metric: Number((correct.current / minutes).toFixed(1)),
      accuracy: total ? correct.current / total : 0,
      meanRtMs: Math.round(rts.current.reduce((a, b) => a + b, 0) / Math.max(1, rts.current.length)),
      extra: { correct: correct.current, wrong: wrong.current },
    });
  };

  useEffect(() => {
    startAt.current = now();
    const id = window.setInterval(() => {
      const p = (now() - startAt.current) / (durationSec * 1000);
      onProgress({ points: clamp(Math.round(points.current), 0, 1000), progress: clamp(p, 0, 1), combo: combo.current });
      if (p >= 1) {
        clearInterval(id);
        finish();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = (digitIdx: number) => {
    if (done.current) return;
    rts.current.push(now() - shownAt.current);
    if (digitIdx === target) {
      correct.current++;
      combo.current++;
      points.current += 14 + Math.min(combo.current, 10);
      sfx.hit();
      setFlash('hit');
    } else {
      wrong.current++;
      combo.current = 0;
      sfx.miss();
      setFlash('miss');
    }
    let n: number;
    do n = randInt(rand.current, 0, 8);
    while (n === target);
    setTarget(n);
    shownAt.current = now();
    setTimeout(() => setFlash(null), 150);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = Number(e.key);
      if (d >= 1 && d <= 9) answer(d - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="grid grid-cols-9 gap-1 rounded-xl border border-hud-line bg-hud-bg/60 p-2" aria-label="Symbol key">
        {key.map((g, k) => (
          <div key={k} className="flex flex-col items-center">
            <Glyph spec={g} size={34} />
            <span className="font-mono text-sm text-hud-text">{DIGITS[k]}</span>
          </div>
        ))}
      </div>
      <div
        className={`flex h-36 w-36 items-center justify-center rounded-2xl border-2 bg-hud-bg/60 ${
          flash === 'hit' ? 'border-status-green' : flash === 'miss' ? 'border-status-red game-shake' : 'border-hud-line'
        }`}
      >
        <Glyph spec={key[target]} size={96} title="Symbol to decode" />
      </div>
      <div className="grid grid-cols-9 gap-1">
        {DIGITS.map((d, k) => (
          <button key={d} type="button" className="hud-btn h-11 w-9 font-mono text-base" onClick={() => answer(k)}>
            {d}
          </button>
        ))}
      </div>
      <p className="text-xs text-hud-muted">Tap the digit or use keys 1–9.</p>
    </div>
  );
};
