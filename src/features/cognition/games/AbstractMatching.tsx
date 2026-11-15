/**
 * Pattern Sort — Abstract Matching: send the target object to the pair it belongs with more, by an implicit rule.
 * Source: SRC-089 (AM: abstraction, concept formation), SRC-094 (target classified to one of two pairs)
 * Rule generation: each pair shares one attribute value; the target shares the left pair's value only, or the right's.
 */
import React, { useRef, useState } from 'react';
import { Glyph, GlyphSpec, SHAPES, FILLS } from '../Glyph';
import { mulberry32, randInt } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp } from './common';

const TRIALS = 20;
type Attr = 'shape' | 'color' | 'fill' | 'count';
const ATTRS: Attr[] = ['shape', 'color', 'fill', 'count'];
const RANGE: Record<Attr, number> = { shape: SHAPES.length, color: 6, fill: 3, count: 3 };

const rndGlyph = (rand: () => number): GlyphSpec => ({
  shape: SHAPES[randInt(rand, 0, SHAPES.length - 1)],
  color: randInt(rand, 0, 5),
  fill: FILLS[randInt(rand, 0, 2)],
  count: randInt(rand, 1, 3),
});
const getV = (g: GlyphSpec, a: Attr): number =>
  a === 'shape' ? SHAPES.indexOf(g.shape) : a === 'fill' ? FILLS.indexOf(g.fill) : a === 'count' ? g.count - 1 : g.color;
const setV = (g: GlyphSpec, a: Attr, v: number): GlyphSpec =>
  a === 'shape' ? { ...g, shape: SHAPES[v] } : a === 'fill' ? { ...g, fill: FILLS[v] } : a === 'count' ? { ...g, count: v + 1 } : { ...g, color: v };
const otherV = (rand: () => number, a: Attr, not: number) => {
  let v;
  do v = randInt(rand, 0, RANGE[a] - 1);
  while (v === not);
  return v;
};

export interface AmTrial {
  left: [GlyphSpec, GlyphSpec];
  right: [GlyphSpec, GlyphSpec];
  target: GlyphSpec;
  answer: 'left' | 'right';
}

export function makeAmTrial(rand: () => number): AmTrial {
  const aL = ATTRS[randInt(rand, 0, 3)];
  let aR = ATTRS[randInt(rand, 0, 3)];
  while (aR === aL) aR = ATTRS[randInt(rand, 0, 3)];
  const vL = randInt(rand, 0, RANGE[aL] - 1);
  const vR = randInt(rand, 0, RANGE[aR] - 1);
  // Pair members share their rule value, and differ from it on the other pair's rule attribute.
  const member = (a: Attr, v: number, b: Attr, w: number) => setV(setV(rndGlyph(rand), a, v), b, otherV(rand, b, w));
  const left: [GlyphSpec, GlyphSpec] = [member(aL, vL, aR, vR), member(aL, vL, aR, vR)];
  const right: [GlyphSpec, GlyphSpec] = [member(aR, vR, aL, vL), member(aR, vR, aL, vL)];
  const answer = rand() < 0.5 ? 'left' : 'right';
  const target = answer === 'left' ? member(aL, vL, aR, vR) : member(aR, vR, aL, vL);
  return { left, right, target, answer };
}

export const AbstractMatching: React.FC<GameProps> = ({ seed, onProgress, onDone }) => {
  const trials = useRef(Array.from({ length: TRIALS }, ((r) => () => makeAmTrial(r))(mulberry32(seed)))).current;
  const [i, setI] = useState(0);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const correct = useRef(0);
  const combo = useRef(0);
  const points = useRef(0);
  const t = trials[i];

  const choose = (side: 'left' | 'right') => {
    if (flash) return;
    const ok = side === t.answer;
    if (ok) {
      correct.current++;
      combo.current++;
      points.current += 40 + Math.min(combo.current, 8) * 1.25;
      sfx.hit();
    } else {
      combo.current = 0;
      sfx.miss();
    }
    setFlash(ok ? 'hit' : 'miss');
    const n = i + 1;
    onProgress({ points: clamp(Math.round(points.current), 0, 1000), progress: n / TRIALS, combo: combo.current });
    if (n >= TRIALS) {
      const acc = correct.current / TRIALS;
      onDone({ points: clamp(Math.round(points.current), 0, 1000), metric: Math.round(acc * 100), accuracy: acc });
      return;
    }
    setTimeout(() => {
      setFlash(null);
      setI(n);
    }, 350);
  };

  const pairBox = (side: 'left' | 'right', pair: [GlyphSpec, GlyphSpec]) => (
    <button
      type="button"
      onClick={() => choose(side)}
      className="hud-focus flex gap-1 rounded-xl border border-hud-line bg-hud-bg/60 p-2 transition-colors hover:border-hud-accent"
      aria-label={`Send to ${side} group`}
    >
      <Glyph spec={pair[0]} size={64} />
      <Glyph spec={pair[1]} size={64} />
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-5" onKeyDown={(e) => (e.key === 'ArrowLeft' ? choose('left') : e.key === 'ArrowRight' ? choose('right') : null)}>
      <p className="font-display text-sm tracking-widest text-hud-muted">SORT {i + 1}/{TRIALS}</p>
      <div className={`flex h-32 w-32 items-center justify-center rounded-2xl border-2 bg-hud-bg/60 ${flash === 'hit' ? 'border-status-green' : flash === 'miss' ? 'border-status-red game-shake' : 'border-hud-accent'}`}>
        <div key={i} className="game-pop"><Glyph spec={t.target} size={96} title="Object to sort" /></div>
      </div>
      <div className="flex flex-wrap justify-center gap-6">
        {pairBox('left', t.left)}
        {pairBox('right', t.right)}
      </div>
      <p className="text-xs text-hud-muted">Which group does it belong with more? ← / →</p>
    </div>
  );
};
