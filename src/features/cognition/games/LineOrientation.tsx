/**
 * Docking Align — Line Orientation, hard 3-minute version: rotate the moving line until it is parallel to
 * the fixed one. Shorter lines, 2° steps and 10 s per pair (it locks itself when time runs out);
 * pairs keep coming until the 3 minutes are up.
 * Source: SRC-089 (LOT: spatial orientation), SRC-094 (line pairs, rotate by clicking arrows)
 * Line length, step, per-pair limit and time box are the ARGUS hard level (spec §12.1).
 */
import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { mulberry32, randInt } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp, useTimeBox } from './common';

const STEP_DEG = 2;
const PAIR_LIMIT_MS = 10_000;

interface Pair {
  fixed: number;
  start: number;
  fx: number;
  fy: number;
  mx: number;
  my: number;
  len: number;
}

export function makePair(rand: () => number): Pair {
  const fixed = randInt(rand, 0, 89) * 2;
  let start = randInt(rand, 0, 89) * 2;
  while (lineAngleError(start, fixed) < 15) start = randInt(rand, 0, 89) * 2;
  return { fixed, start, fx: randInt(rand, 60, 120), fy: randInt(rand, 50, 170), mx: randInt(rand, 200, 260), my: randInt(rand, 50, 170), len: randInt(rand, 40, 80) };
}

/** Smallest angle between two undirected lines, 0–90°. */
export const lineAngleError = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
};

const Line = ({ x, y, deg, len, cls }: { x: number; y: number; deg: number; len: number; cls: string }) => {
  const r = (deg * Math.PI) / 180;
  const dx = (Math.cos(r) * len) / 2;
  const dy = (Math.sin(r) * len) / 2;
  return <line x1={x - dx} y1={y - dy} x2={x + dx} y2={y + dy} strokeWidth={6} strokeLinecap="round" className={cls} />;
};

export const LineOrientation: React.FC<GameProps> = ({ seed, durationSec, onProgress, onDone }) => {
  const rand = useRef(mulberry32(seed));
  const [p, setP] = useState<Pair>(() => makePair(rand.current));
  const [i, setI] = useState(0);
  const [angle, setAngle] = useState(p.start);
  const [last, setLast] = useState<number | null>(null);
  const errors = useRef<number[]>([]);
  const points = useRef(0);
  const done = useRef(false);
  const locked = useRef(false);
  const angleRef = useRef(angle);
  angleRef.current = angle;

  useTimeBox(
    durationSec,
    (prog) => onProgress({ points: clamp(points.current, 0, 1000), progress: prog }),
    () => {
      done.current = true;
      const n = Math.max(1, errors.current.length);
      onDone({
        points: clamp(points.current, 0, 1000),
        metric: Number((errors.current.reduce((a, b) => a + b, 0) / n).toFixed(2)),
        accuracy: errors.current.filter((e) => e <= 3).length / n,
        extra: { pairs: errors.current.length },
      });
    }
  );

  const submit = () => {
    if (done.current || locked.current) return;
    locked.current = true;
    const err = lineAngleError(angleRef.current, p.fixed);
    errors.current.push(err);
    points.current += clamp(Math.round(30 - err * 3), 0, 30);
    err <= 3 ? sfx.hit() : sfx.miss();
    setLast(err);
    setTimeout(() => {
      const np = makePair(rand.current);
      setP(np);
      setAngle(np.start);
      setI((k) => k + 1);
      setLast(null);
      locked.current = false;
    }, 400);
  };

  // Each pair locks itself after 10 s.
  useEffect(() => {
    const id = window.setTimeout(submit, PAIR_LIMIT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const rotate = (d: number) => setAngle((a) => (a + d + 360) % 360);

  return (
    <div
      className="flex flex-col items-center gap-4"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') rotate(-STEP_DEG);
        if (e.key === 'ArrowRight') rotate(STEP_DEG);
        if (e.key === 'Enter') submit();
      }}
    >
      <p className="font-display text-sm tracking-widest text-hud-muted">ALIGN {i + 1} · 10 s each</p>
      <svg viewBox="0 0 320 220" className="w-full max-w-md rounded-xl border border-hud-line bg-hud-bg/60" role="img" aria-label="Two lines: make the cyan one parallel to the white one">
        <Line x={p.fx} y={p.fy} deg={p.fixed} len={p.len} cls="stroke-hud-text" />
        <Line x={p.mx} y={p.my} deg={angle} len={p.len} cls="stroke-hud-accent" />
      </svg>
      {last !== null && (
        <span className={`game-pop font-mono text-sm ${last <= 3 ? 'text-status-green' : 'text-status-yellow'}`}>off by {last.toFixed(0)}°</span>
      )}
      <div className="flex items-center gap-3">
        <button type="button" className="hud-btn h-12 w-14" onClick={() => rotate(-STEP_DEG)} aria-label="Rotate left">
          <RotateCcw className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" className="hud-btn-primary w-32 py-3" onClick={submit}>Lock</button>
        <button type="button" className="hud-btn h-12 w-14" onClick={() => rotate(STEP_DEG)} aria-label="Rotate right">
          <RotateCw className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs text-hud-muted">Keys: ← → rotate · Enter lock</p>
    </div>
  );
};
