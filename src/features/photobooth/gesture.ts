/**
 * ARGUS — Photobooth hands-free shutter (specs/02-ui-dashboard.md §2.7)
 * Show a peace sign (✌️) for a quarter of a second → a 3-second countdown → the photo is taken.
 * Pure state machine so it is unit-tested; the camera loop feeds it `sign` (peace sign seen) every frame.
 */

/** The sign must be held this long before the countdown starts (ignores a passing hand). */
export const SIGN_ARM_MS = 250;
export const COUNTDOWN_MS = 3000;
/** After a photo, wait this long and for the sign to drop before a new one counts. */
export const COOLDOWN_MS = 2000;

export type ShutterPhase = 'idle' | 'arming' | 'countdown' | 'cooldown';

export interface ShutterState {
  phase: ShutterPhase;
  since: number;
  /** Countdown length, ms (default 3 s; shorter between the photos of a strip). */
  duration?: number;
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
export function startCountdown(now: number, duration = COUNTDOWN_MS): ShutterState {
  return { phase: 'countdown', since: now, duration };
}

export function stepShutter(state: ShutterState, sign: boolean, now: number): ShutterStep {
  const elapsed = now - state.since;
  switch (state.phase) {
    case 'idle':
      return { state: sign ? { phase: 'arming', since: now } : state, capture: false, secondsLeft: null };
    case 'arming':
      if (!sign) return { state: IDLE, capture: false, secondsLeft: null };
      if (elapsed >= SIGN_ARM_MS) return { state: startCountdown(now), capture: false, secondsLeft: 3 };
      return { state, capture: false, secondsLeft: null };
    case 'countdown': {
      const duration = state.duration ?? COUNTDOWN_MS;
      if (elapsed >= duration) return { state: { phase: 'cooldown', since: now }, capture: true, secondsLeft: null };
      return { state, capture: false, secondsLeft: Math.ceil((duration - elapsed) / 1000) };
    }
    case 'cooldown':
      if (!sign && elapsed >= COOLDOWN_MS) return { state: IDLE, capture: false, secondsLeft: null };
      return { state, capture: false, secondsLeft: null };
  }
}
