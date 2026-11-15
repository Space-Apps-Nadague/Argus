/**
 * Cargo Memory — Visual Object Learning, hard 3-minute version. Rounds of: memorise 12 objects
 * (1.2 s each), then mark 24 as seen or new. Half of the new ones are look-alikes (one detail changed),
 * so the crew must remember exact objects. Rounds repeat until the 3 minutes are up.
 * Source: SRC-089 (VOLT: spatial learning and memory), SRC-094 (learn then recognise).
 * Round size, look-alikes and time box are the ARGUS hard level (spec §12.1).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Glyph, GlyphSpec, SHAPES, FILLS, glyphKey } from '../Glyph';
import { mulberry32, randInt, shuffle } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, useTimeBox } from './common';

const LEARN = 12;
const LEARN_MS = 1200;

const randomGlyph = (rand: () => number): GlyphSpec => ({
  shape: SHAPES[randInt(rand, 0, SHAPES.length - 1)],
  color: randInt(rand, 0, 5),
  fill: FILLS[randInt(rand, 0, 2)],
  count: randInt(rand, 1, 3),
  rot: randInt(rand, 0, 7) * 15,
});

/** Same object with one detail changed. */
function lookAlike(rand: () => number, g: GlyphSpec): GlyphSpec {
  switch (randInt(rand, 0, 3)) {
    case 0:
      return { ...g, color: (g.color + randInt(rand, 1, 5)) % 6 };
    case 1:
      return { ...g, fill: FILLS[(FILLS.indexOf(g.fill) + randInt(rand, 1, 2)) % 3] };
    case 2:
      return { ...g, count: (g.count % 3) + 1 };
    default:
      return { ...g, shape: SHAPES[(SHAPES.indexOf(g.shape) + randInt(rand, 1, SHAPES.length - 1)) % SHAPES.length] };
  }
}

export interface VoltRound {
  learn: GlyphSpec[];
  test: { g: GlyphSpec; old: boolean; lure: boolean }[];
}

export function makeVoltRound(rand: () => number): VoltRound {
  const used = new Set<string>();
  const learn: GlyphSpec[] = [];
  while (learn.length < LEARN) {
    const g = randomGlyph(rand);
    if (!used.has(glyphKey(g))) {
      used.add(glyphKey(g));
      learn.push(g);
    }
  }
  const fresh: { g: GlyphSpec; old: boolean; lure: boolean }[] = [];
  let guard = 0;
  while (fresh.length < LEARN && guard++ < 1000) {
    const lure = fresh.length < LEARN / 2;
    const g = lure ? lookAlike(rand, learn[fresh.length]) : randomGlyph(rand);
    if (used.has(glyphKey(g))) continue;
    used.add(glyphKey(g));
    fresh.push({ g, old: false, lure });
  }
  return { learn, test: shuffle([...learn.map((g) => ({ g, old: true, lure: false })), ...fresh], rand) };
}

export const Volt: React.FC<GameProps> = ({ seed, durationSec, onProgress, onDone }) => {
  const rand = useRef(mulberry32(seed));
  const [round, setRound] = useState<VoltRound>(() => makeVoltRound(rand.current));
  const [phase, setPhase] = useState<'learn' | 'test'>('learn');
  const [i, setI] = useState(0);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const correct = useRef(0);
  const answered = useRef(0);
  const lureErrors = useRef(0);
  const combo = useRef(0);
  const points = useRef(0);
  const rts = useRef<number[]>([]);
  const shownAt = useRef(performance.now());
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
        meanRtMs: rts.current.length ? Math.round(rts.current.reduce((a, b) => a + b, 0) / rts.current.length) : 0,
        extra: { answered: answered.current, lureErrors: lureErrors.current },
      });
    }
  );

  useEffect(() => {
    if (phase !== 'learn') return;
    const id = window.setTimeout(() => {
      if (i + 1 >= LEARN) {
        setPhase('test');
        setI(0);
        shownAt.current = performance.now();
      } else setI(i + 1);
    }, LEARN_MS);
    return () => clearTimeout(id);
  }, [phase, i]);

  const answer = (saidOld: boolean) => {
    if (done.current || phase !== 'test' || flash) return;
    const item = round.test[i];
    const ok = item.old === saidOld;
    answered.current++;
    rts.current.push(performance.now() - shownAt.current);
    if (ok) {
      correct.current++;
      combo.current++;
      points.current += 9 + Math.min(combo.current, 8) * 0.5;
      sfx.hit();
    } else {
      if (item.lure) lureErrors.current++;
      combo.current = 0;
      sfx.miss();
    }
    setFlash(ok ? 'hit' : 'miss');
    setTimeout(() => {
      setFlash(null);
      if (i + 1 >= round.test.length) {
        setRound(makeVoltRound(rand.current));
        setPhase('learn');
        setI(0);
      } else {
        setI(i + 1);
        shownAt.current = performance.now();
      }
    }, 220);
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
        <div key={`${i}-${glyphKey(round.learn[i])}`} className="game-pop flex h-56 w-56 items-center justify-center rounded-2xl border border-hud-line bg-hud-bg/60">
          <Glyph spec={round.learn[i]} size={150} title="Object to remember" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="font-display text-sm tracking-widest text-hud-muted">EXACT SAME? · {i + 1}/{round.test.length}</p>
      <div
        className={`flex h-56 w-56 items-center justify-center rounded-2xl border-2 bg-hud-bg/60 ${
          flash === 'hit' ? 'border-status-green' : flash === 'miss' ? 'border-status-red game-shake' : 'border-hud-line'
        }`}
      >
        <div key={i} className="game-pop">
          <Glyph spec={round.test[i].g} size={150} title="Object" />
        </div>
      </div>
      <div className="flex gap-3">
        <button type="button" className="hud-btn-primary w-32 py-3" onClick={() => answer(true)}>Seen</button>
        <button type="button" className="hud-btn w-32 py-3 text-sm" onClick={() => answer(false)}>New</button>
      </div>
      <p className="text-xs text-hud-muted">Careful: some new ones differ by one detail. Keys: ← Seen · → New</p>
    </div>
  );
};
