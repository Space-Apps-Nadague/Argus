/**
 * Docking Align — Line Orientation: rotate the moving line until it is parallel to the fixed one.
 * Source: SRC-089 (LOT: spatial orientation), SRC-094 (12 line pairs, rotate by clicking arrows)
 */
import React, { useRef, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { mulberry32, randInt } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp } from './common';

const PAIRS = 12; // Source: SRC-094
const STEP_DEG = 3;

interface Pair {
  fixed: number;
  start: number;
  fx: number;
  fy: number;
  mx: number;
  my: number;
  len: number;
}

function makePairs(seed: number): Pair[] {
  const rand = mulberry32(seed);
  return Array.from({ length: PAIRS }, () => {
    const fixed = randInt(rand, 0, 59) * 3;
    let start = randInt(rand, 0, 59) * 3;
    while (Math.abs(((start - fixed + 540) % 180) - 0) < 15) start = randInt(rand, 0, 59) * 3;
    return { fixed, start, fx: randInt(rand, 70, 120), fy: randInt(rand, 60, 160), mx: randInt(rand, 200, 250), my: randInt(rand, 60, 160), len: randInt(rand, 60, 110) };
  });
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

export const LineOrientation: React.FC<GameProps> = ({ seed, onProgress, onDone }) => {
  const pairs = useRef(makePairs(seed)).current;
  const [i, setI] = useState(0);
  const [angle, setAngle] = useState(pairs[0].start);
  const [last, setLast] = useState<number | null>(null);
  const errors = useRef<number[]>([]);
  const points = useRef(0);
  const p = pairs[i];

  const submit = () => {
    const err = lineAngleError(angle, p.fixed);
    errors.current.push(err);
    points.current += clamp(Math.round(85 - err * 6), 0, 85);
    err <= 3 ? sfx.hit() : sfx.miss();
    setLast(err);
    const n = i + 1;
    onProgress({ points: clamp(points.current, 0, 1000), progress: n / PAIRS });
    if (n >= PAIRS) {
      const meanErr = errors.current.reduce((a, b) => a + b, 0) / PAIRS;
      onDone({
        points: clamp(points.current, 0, 1000),
        metric: Number(meanErr.toFixed(2)),
        accuracy: errors.current.filter((e) => e <= 3).length / PAIRS,
      });
      return;
    }
    setTimeout(() => {
      setI(n);
      setAngle(pairs[n].start);
      setLast(null);
    }, 450);
  };

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
      <p className="font-display text-sm tracking-widest text-hud-muted">ALIGN {i + 1}/{PAIRS}</p>
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
