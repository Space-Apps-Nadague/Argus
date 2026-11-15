/**
 * Echo — Fractal N-Back (working memory), hard 3-minute version: press MATCH when the glyph equals
 * the one shown THREE steps back (3-back), one glyph every 1.5 s, 120 glyphs.
 * Source: SRC-089 (F2B: working memory), SRC-094 (task description). 3-back, pace and length are
 * the ARGUS hard level (spec §12.1).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Glyph, GlyphSpec, SHAPES, FILLS, sameGlyph } from '../Glyph';
import { mulberry32, randInt } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp } from './common';

/** How many steps back a match counts. */
export const N_BACK = 3;
const STEP_MS = 1500;
const TRIALS = Math.round((180 * 1000) / STEP_MS); // fills the 3-minute game
const TARGET_RATE = 0.3;

function makeSequence(seed: number): { seq: GlyphSpec[]; isTarget: boolean[] } {
  const rand = mulberry32(seed);
  // Small pool of similar-looking glyphs so the task needs memory, not just novelty detection.
  const pool: GlyphSpec[] = Array.from({ length: 8 }, () => ({
    shape: SHAPES[randInt(rand, 0, SHAPES.length - 1)],
    color: randInt(rand, 0, 5),
    fill: FILLS[randInt(rand, 0, 2)],
    count: randInt(rand, 1, 3),
    rot: randInt(rand, 0, 3) * 15,
  }));
  const seq: GlyphSpec[] = [];
  const isTarget: boolean[] = [];
  for (let i = 0; i < TRIALS; i++) {
    if (i >= N_BACK && rand() < TARGET_RATE) {
      seq.push(seq[i - N_BACK]);
    } else {
      let g: GlyphSpec;
      do g = pool[randInt(rand, 0, pool.length - 1)];
      while (i >= N_BACK && sameGlyph(g, seq[i - N_BACK]));
      seq.push(g);
    }
    isTarget.push(i >= N_BACK && sameGlyph(seq[i], seq[i - N_BACK]));
  }
  return { seq, isTarget };
}

export const FractalNBack: React.FC<GameProps> = ({ seed, onProgress, onDone }) => {
  const { seq, isTarget } = useRef(makeSequence(seed)).current;
  const [i, setI] = useState(0);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const responded = useRef<boolean[]>(Array(TRIALS).fill(false));
  const points = useRef(0);
  const combo = useRef(0);
  const iRef = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = iRef.current;
      // Missed target on the trial that is ending
      if (isTarget[cur] && !responded.current[cur]) combo.current = 0;
      const next = cur + 1;
      if (next >= TRIALS) {
        clearInterval(id);
        const targets = isTarget.filter(Boolean).length;
        const hits = isTarget.filter((t, k) => t && responded.current[k]).length;
        const fas = isTarget.filter((t, k) => !t && responded.current[k]).length;
        const nonTargets = TRIALS - N_BACK - targets;
        const hitRate = targets ? hits / targets : 0;
        const faRate = nonTargets ? fas / nonTargets : 0;
        onDone({
          points: clamp(Math.round(points.current), 0, 1000),
          metric: Number((hitRate - faRate).toFixed(3)),
          accuracy: (hits + (nonTargets - fas)) / (targets + nonTargets),
          extra: { hits, falseAlarms: fas, targets },
        });
        return;
      }
      iRef.current = next;
      setI(next);
      setFlash(null);
      onProgress({ points: clamp(Math.round(points.current), 0, 1000), progress: next / TRIALS, combo: combo.current });
    }, STEP_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = () => {
    const cur = iRef.current;
    if (responded.current[cur] || cur < N_BACK) return;
    responded.current[cur] = true;
    if (isTarget[cur]) {
      combo.current++;
      points.current += 22 + Math.min(combo.current, 8) * 2;
      sfx.hit();
      setFlash('hit');
    } else {
      combo.current = 0;
      points.current = Math.max(0, points.current - 15);
      sfx.miss();
      setFlash('miss');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key.toLowerCase() === 'm') {
        e.preventDefault();
        press();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className={`flex h-56 w-56 items-center justify-center rounded-2xl border-2 bg-hud-bg/60 transition-colors ${
          flash === 'hit' ? 'border-status-green' : flash === 'miss' ? 'border-status-red game-shake' : 'border-hud-line'
        }`}
      >
        <div key={i} className="game-pop">
          <Glyph spec={seq[i]} size={150} title={`Shape ${i + 1}`} />
        </div>
      </div>
      <button type="button" onClick={press} disabled={i < N_BACK} className="hud-btn-primary w-48 py-3 text-base tracking-widest">
        MATCH
      </button>
      <p className="text-xs text-hud-muted">Same as 3 back? Press MATCH or Space.</p>
    </div>
  );
};
