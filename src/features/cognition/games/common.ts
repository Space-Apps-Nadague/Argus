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
