/**
 * Cargo Memory — Visual Object Learning: memorise 10 objects, then classify 20 (10 seen, 10 new) as seen or new.
 * Source: SRC-089 (VOLT: spatial learning and memory), SRC-094 (10 learn, 20 test)
 */
import React, { useEffect, useRef, useState } from 'react';
import { Glyph, GlyphSpec, SHAPES, FILLS, glyphKey } from '../Glyph';
import { mulberry32, randInt, shuffle } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp } from './common';

const LEARN = 10; // Source: SRC-094
const LEARN_MS = 1600;

function makeItems(seed: number) {
  const rand = mulberry32(seed);
  const seen = new Set<string>();
  const items: GlyphSpec[] = [];
  while (items.length < LEARN * 2) {
    const g: GlyphSpec = {
      shape: SHAPES[randInt(rand, 0, SHAPES.length - 1)],
      color: randInt(rand, 0, 5),
      fill: FILLS[randInt(rand, 0, 2)],
      count: randInt(rand, 1, 3),
      rot: randInt(rand, 0, 7) * 15,
    };
    const k = glyphKey(g);
    if (!seen.has(k)) {
      seen.add(k);
      items.push(g);
    }
  }
  const learn = items.slice(0, LEARN);
  const test = shuffle(
    items.map((g, k) => ({ g, old: k < LEARN })),
    rand
  );
  return { learn, test };
}

export const Volt: React.FC<GameProps> = ({ seed, onProgress, onDone }) => {
  const { learn, test } = useRef(makeItems(seed)).current;
  const [phase, setPhase] = useState<'learn' | 'test'>('learn');
  const [i, setI] = useState(0);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const correct = useRef(0);
  const combo = useRef(0);
  const points = useRef(0);
  const rts = useRef<number[]>([]);
  const shownAt = useRef(performance.now());

  useEffect(() => {
    if (phase !== 'learn') return;
    const id = window.setTimeout(() => {
      if (i + 1 >= LEARN) {
        setPhase('test');
        setI(0);
        shownAt.current = performance.now();
      } else setI(i + 1);
      onProgress({ points: 0, progress: ((i + 1) / LEARN) * 0.4 });
    }, LEARN_MS);
    return () => clearTimeout(id);
  }, [phase, i, onProgress]);

  const answer = (saidOld: boolean) => {
    const item = test[i];
    const ok = item.old === saidOld;
    rts.current.push(performance.now() - shownAt.current);
    if (ok) {
      correct.current++;
      combo.current++;
      points.current += 40 + Math.min(combo.current, 8) * 2.5;
      sfx.hit();
    } else {
      combo.current = 0;
      sfx.miss();
    }
    setFlash(ok ? 'hit' : 'miss');
    const next = i + 1;
    onProgress({ points: clamp(Math.round(points.current), 0, 1000), progress: 0.4 + (next / test.length) * 0.6, combo: combo.current });
    if (next >= test.length) {
      const acc = correct.current / test.length;
      onDone({
        points: clamp(Math.round(points.current), 0, 1000),
        metric: Math.round(acc * 100),
        accuracy: acc,
        meanRtMs: Math.round(rts.current.reduce((a, b) => a + b, 0) / rts.current.length),
      });
      return;
    }
    setTimeout(() => {
      setFlash(null);
      setI(next);
      shownAt.current = performance.now();
    }, 250);
  };

  useEffect(() => {
    if (phase !== 'test') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 's') answer(true);
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'n') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (phase === 'learn') {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="font-display text-sm tracking-widest text-hud-accent">MEMORISE · {i + 1}/{LEARN}</p>
        <div key={i} className="game-pop flex h-56 w-56 items-center justify-center rounded-2xl border border-hud-line bg-hud-bg/60">
          <Glyph spec={learn[i]} size={150} title="Object to remember" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="font-display text-sm tracking-widest text-hud-muted">SEEN IT? · {i + 1}/{test.length}</p>
      <div
        className={`flex h-56 w-56 items-center justify-center rounded-2xl border-2 bg-hud-bg/60 ${
          flash === 'hit' ? 'border-status-green' : flash === 'miss' ? 'border-status-red game-shake' : 'border-hud-line'
        }`}
      >
        <div key={i} className="game-pop">
          <Glyph spec={test[i].g} size={150} title="Object" />
        </div>
      </div>
      <div className="flex gap-3">
        <button type="button" className="hud-btn-primary w-32 py-3" onClick={() => answer(true)}>Seen</button>
        <button type="button" className="hud-btn w-32 py-3 text-sm" onClick={() => answer(false)}>New</button>
      </div>
      <p className="text-xs text-hud-muted">Keys: ← Seen · → New</p>
    </div>
  );
};
