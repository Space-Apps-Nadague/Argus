import { describe, expect, it } from 'vitest';
import { COOLDOWN_MS, COUNTDOWN_MS, FIST_ARM_MS, IDLE, startCountdown, stepShutter, type ShutterState } from '../gesture';

/** Feeds a fist on/off timeline (ms, fist) and returns the frames with captures and the countdown seen. */
function run(timeline: [number, boolean][], start: ShutterState = IDLE) {
  let state = start;
  const captures: number[] = [];
  const shown = new Set<number>();
  for (const [t, fist] of timeline) {
    const step = stepShutter(state, fist, t);
    state = step.state;
    if (step.capture) captures.push(t);
    if (step.secondsLeft !== null) shown.add(step.secondsLeft);
  }
  return { captures, shown, state };
}

const frames = (from: number, to: number, fist: boolean, every = 50): [number, boolean][] => {
  const out: [number, boolean][] = [];
  for (let t = from; t <= to; t += every) out.push([t, fist]);
  return out;
};

describe('fist shutter', () => {
  it('takes the photo 3 s after a held fist, counting 3-2-1', () => {
    const { captures, shown } = run([...frames(0, 600, true), ...frames(650, 4000, false)]);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toBeGreaterThanOrEqual(FIST_ARM_MS + COUNTDOWN_MS);
    expect(captures[0]).toBeLessThan(FIST_ARM_MS + COUNTDOWN_MS + 100);
    expect([...shown].sort()).toEqual([1, 2, 3]);
  });

  it('ignores a hand that closes only briefly', () => {
    const { captures } = run([...frames(0, 200, true), ...frames(250, 5000, false)]);
    expect(captures).toEqual([]);
  });

  it('keeps counting even if the hand opens during the countdown', () => {
    const { captures } = run([...frames(0, 500, true), ...frames(550, 4500, false)]);
    expect(captures).toHaveLength(1);
  });

  it('needs the hand to open again before the next photo', () => {
    const held = run(frames(0, 10_000, true));
    expect(held.captures).toHaveLength(1);
    const reopened = run([...frames(0, 3600, true), ...frames(3650, 3650 + COOLDOWN_MS + 100, false), ...frames(6000, 9800, true)]);
    expect(reopened.captures).toHaveLength(2);
  });

  it('starts the same countdown from the button', () => {
    const { captures } = run(frames(1000, 4200, false), startCountdown(1000));
    expect(captures).toEqual([4000]);
  });
});
