/**
 * Grid Logic — Matrix Reasoning, hard 3-minute version: find the piece that completes a 3×3 grid.
 * Three rules at once (the fill pattern also changes diagonally), 5 options that each differ from the
 * answer by one detail, 15 s per grid; grids keep coming until the 3 minutes are up.
 * Source: SRC-089 (MRT: abstract reasoning)
 * Grids are generated from rules: one attribute is constant per row, one changes across columns.
 * Third rule, options, per-grid limit and time box are the ARGUS hard level (spec §12.1).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Glyph, GlyphSpec, SHAPES, FILLS, sameGlyph } from '../Glyph';
import { mulberry32, randInt, shuffle } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, useTimeBox } from './common';

export const MR_OPTIONS = 5;
const OPTIONS = MR_OPTIONS;
const TRIAL_LIMIT_MS = 15_000;

export interface MrTrial {
  cells: GlyphSpec[]; // 9, last is the answer
  options: GlyphSpec[];
  answerIdx: number;
}

export function makeMrTrial(rand: () => number): MrTrial {
  const shapes = shuffle(SHAPES, rand).slice(0, 3);
  const colors = shuffle([0, 1, 2, 3, 4, 5], rand).slice(0, 3);
  const fills = shuffle(FILLS, rand);
  const mode = randInt(rand, 0, 2); // which attribute varies across columns
  const cells: GlyphSpec[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const fill = fills[(r + 2 * c) % 3]; // third rule: fill changes along the diagonals
      if (mode === 0) cells.push({ shape: shapes[r], color: colors[r], fill, count: c + 1 });
      else if (mode === 1) cells.push({ shape: shapes[r], color: colors[c], fill, count: r + 1 });
      else cells.push({ shape: shapes[c], color: colors[r], fill, count: ((r + c) % 3) + 1 });
    }
  const answer = cells[8];
  const distractors: GlyphSpec[] = [];
  const tweaks = [
    (g: GlyphSpec) => ({ ...g, count: (g.count % 3) + 1 }),
    (g: GlyphSpec) => ({ ...g, color: colors[(colors.indexOf(g.color) + 1) % 3] }),
    (g: GlyphSpec) => ({ ...g, shape: shapes[(shapes.indexOf(g.shape) + 1) % 3] }),
    (g: GlyphSpec) => ({ ...g, fill: FILLS[(FILLS.indexOf(g.fill) + 1) % 3] }),
  ];
  for (const tw of shuffle(tweaks, rand)) {
    const d = tw(answer);
    if (!sameGlyph(d, answer) && !distractors.some((x) => sameGlyph(x, d))) distractors.push(d);
    if (distractors.length === OPTIONS - 1) break;
  }
  const options = shuffle([answer, ...distractors], rand);
  return { cells, options, answerIdx: options.findIndex((o) => sameGlyph(o, answer)) };
}

export const MatrixReasoning: React.FC<GameProps> = ({ seed, durationSec, onProgress, onDone }) => {
  const rand = useRef(mulberry32(seed));
  const [t, setT] = useState<MrTrial>(() => makeMrTrial(rand.current));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
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

  const choose = (k: number) => {
    if (picked !== null || done.current) return;
    answered.current++;
    if (k < 0) timeouts.current++;
    const ok = k === t.answerIdx;
    if (ok) {
      correct.current++;
      combo.current++;
      points.current += 40 + Math.min(combo.current, 6) * 2;
      sfx.hit();
    } else {
      combo.current = 0;
      sfx.miss();
    }
    setPicked(k);
    setTimeout(() => {
      setPicked(null);
      setT(makeMrTrial(rand.current));
      setI((n) => n + 1);
    }, 600);
  };

  // 15 s per grid; no answer counts as wrong.
  useEffect(() => {
    const id = window.setTimeout(() => choose(-1), TRIAL_LIMIT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="font-display text-sm tracking-widest text-hud-muted">GRID {i + 1} · 15 s each</p>
      <div key={i} className="game-pop grid grid-cols-3 gap-1 rounded-xl border border-hud-line bg-hud-bg/60 p-2">
        {t.cells.map((g, k) => (
          <div key={k} className="flex h-16 w-16 items-center justify-center rounded-md bg-hud-panel/60">
            {k < 8 ? <Glyph spec={g} size={56} /> : <span className="font-display text-2xl text-hud-accent">?</span>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Answer options">
        {t.options.map((g, k) => (
          <button
            key={k}
            type="button"
            onClick={() => choose(k)}
            aria-label={`Option ${k + 1}`}
            className={`hud-focus flex h-20 w-20 items-center justify-center rounded-xl border-2 bg-hud-bg/60 transition-colors ${
              picked === null ? 'border-hud-line hover:border-hud-accent' : k === t.answerIdx ? 'border-status-green' : k === picked ? 'border-status-red' : 'border-hud-line opacity-50'
            }`}
          >
            <Glyph spec={g} size={60} />
          </button>
        ))}
      </div>
    </div>
  );
};
