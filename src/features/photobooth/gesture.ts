/**
 * ARGUS — Photobooth hands-free shutter (specs/02-ui-dashboard.md §2.7)
 * Close your hand (a fist) for a moment → a 3-second countdown → the photo is taken.
 * Pure state machine so it is unit-tested; the camera loop feeds it `fist` every frame.
 */

/** A fist must be held this long before the countdown starts (ignores a passing hand). */
export const FIST_ARM_MS = 400;
export const COUNTDOWN_MS = 3000;
/** After a photo, wait this long and for the hand to open before a new fist counts. */
export const COOLDOWN_MS = 2000;

export type ShutterPhase = 'idle' | 'arming' | 'countdown' | 'cooldown';

export interface ShutterState {
  phase: ShutterPhase;
  since: number;
}

export interface ShutterStep {
  state: ShutterState;
  /** True on the single frame the photo should be taken. */
  capture: boolean;
  /** 3, 2, 1 during the countdown, otherwise null. */
  secondsLeft: number | null;
}

export const IDLE: ShutterState = { phase: 'idle', since: 0 };

/** Starts the countdown now (the on-screen button uses the same timer). */
export function startCountdown(now: number): ShutterState {
  return { phase: 'countdown', since: now };
}

export function stepShutter(state: ShutterState, fist: boolean, now: number): ShutterStep {
  const elapsed = now - state.since;
  switch (state.phase) {
    case 'idle':
      return { state: fist ? { phase: 'arming', since: now } : state, capture: false, secondsLeft: null };
    case 'arming':
      if (!fist) return { state: IDLE, capture: false, secondsLeft: null };
      if (elapsed >= FIST_ARM_MS) return { state: startCountdown(now), capture: false, secondsLeft: 3 };
      return { state, capture: false, secondsLeft: null };
    case 'countdown':
      if (elapsed >= COUNTDOWN_MS) return { state: { phase: 'cooldown', since: now }, capture: true, secondsLeft: null };
      return { state, capture: false, secondsLeft: Math.ceil((COUNTDOWN_MS - elapsed) / 1000) };
    case 'cooldown':
      if (!fist && elapsed >= COOLDOWN_MS) return { state: IDLE, capture: false, secondsLeft: null };
      return { state, capture: false, secondsLeft: null };
  }
}
