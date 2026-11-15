import { useEffect, useRef } from 'react';
import type { GameResult } from '../types';

export interface GameProgress {
  points: number;
  /** 0–1 */
  progress: number;
  combo?: number;
}

export interface GameProps {
  seed: number;
  /** Time budget in seconds (from the catalog). */
  durationSec: number;
  onProgress: (p: GameProgress) => void;
  onDone: (r: GameResult) => void;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const now = () => performance.now();

/** Every game runs for the full time budget at a fixed hard level (spec §12.1). */
export const GAME_SECONDS = 180;

/**
 * Time box for a game: calls `onTick(progress 0–1)` every 250 ms and `onTimeUp()` once when the
 * time budget is used up. Callbacks are read through refs, so they always see the latest state.
 */
export function useTimeBox(durationSec: number, onTick: (progress: number) => void, onTimeUp: () => void) {
  const tick = useRef(onTick);
  const up = useRef(onTimeUp);
  tick.current = onTick;
  up.current = onTimeUp;
  const startAt = useRef(0);
  useEffect(() => {
    startAt.current = now();
    let ended = false;
    const id = window.setInterval(() => {
      const p = clamp((now() - startAt.current) / (durationSec * 1000), 0, 1);
      tick.current(p);
      if (p >= 1 && !ended) {
        ended = true;
        clearInterval(id);
        up.current();
      }
    }, 250);
    return () => clearInterval(id);
  }, [durationSec]);
  return startAt;
}
