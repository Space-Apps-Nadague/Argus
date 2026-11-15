/**
 * Pattern Sort — Abstract Matching, hard 3-minute version: send the target object to the pair it belongs
 * with more, by an implicit rule. 4 s per object, and the target also shares a decoy detail with the
 * wrong pair. Objects keep coming until the 3 minutes are up.
 * Source: SRC-089 (AM: abstraction, concept formation), SRC-094 (target classified to one of two pairs)
 * Rule generation: each pair shares one attribute value; the target shares the left pair's value only, or the right's.
 * Decoy, per-object limit and time box are the ARGUS hard level (spec §12.1).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Glyph, GlyphSpec, SHAPES, FILLS } from '../Glyph';
import { mulberry32, randInt } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, useTimeBox } from './common';

const TRIAL_LIMIT_MS = 4000;
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
  let target = answer === 'left' ? member(aL, vL, aR, vR) : member(aR, vR, aL, vL);
  // Decoy: copy one non-rule detail from the wrong pair, so a quick look points the wrong way.
  const free = ATTRS.filter((a) => a !== aL && a !== aR);
  const decoyAttr = free[randInt(rand, 0, free.length - 1)];
  const wrong = answer === 'left' ? right[0] : left[0];
  target = setV(target, decoyAttr, getV(wrong, decoyAttr));
  return { left, right, target, answer };
}

export const AbstractMatching: React.FC<GameProps> = ({ seed, durationSec, onProgress, onDone }) => {
  const rand = useRef(mulberry32(seed));
  const [t, setT] = useState<AmTrial>(() => makeAmTrial(rand.current));
  const [i, setI] = useState(0);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const correct = useRef(0);
  const answered = useRef(0);
  const timeouts = useRef(0);
  const combo = useRef(0);
  const points = useRef(0);
  const done = useRef(false);

  useTimeBox(
    durationSec,
    (p) => onProgress({ points: clamp(Math.round(points.current), 0, 1000), progress: p, combo: combo.current }),
    () => {
      done.current = true;
      const acc = answered.current ? correct.current / answered.current : 0;
      onDone({
        points: clamp(Math.round(points.current), 0, 1000),
        metric: Math.round(acc * 100),
        accuracy: acc,
        extra: { answered: answered.current, timeouts: timeouts.current },
      });
    }
  );

  const choose = (side: 'left' | 'right' | null) => {
    if (flash || done.current) return;
    answered.current++;
    if (side === null) timeouts.current++;
    const ok = side === t.answer;
    if (ok) {
      correct.current++;
      combo.current++;
      points.current += 12 + Math.min(combo.current, 8) * 0.5;
      sfx.hit();
    } else {
      combo.current = 0;
      sfx.miss();
    }
    setFlash(ok ? 'hit' : 'miss');
    setTimeout(() => {
      setFlash(null);
      setT(makeAmTrial(rand.current));
      setI((k) => k + 1);
    }, 300);
  };

  // 4 s per object; no answer counts as wrong.
  useEffect(() => {
    const id = window.setTimeout(() => choose(null), TRIAL_LIMIT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

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
      <p className="font-display text-sm tracking-widest text-hud-muted">SORT {i + 1} · 4 s each</p>
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
