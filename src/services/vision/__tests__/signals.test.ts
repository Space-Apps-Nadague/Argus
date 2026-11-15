import { describe, expect, it } from 'vitest';
import { countYawns, estimatePulse, eyeStats, type FaceSample, summarize, summarizeEmotion } from '../signals';

/** Builds samples at `fps` for `seconds`, letting `fn` shape each one. */
function series(seconds: number, fps: number, fn: (t: number, i: number) => Partial<FaceSample>): FaceSample[] {
  const out: FaceSample[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = (i * 1000) / fps;
    out.push({ t, facePresent: true, ear: 0.3, mar: 0.1, yaw: 0, rollDeg: 0, cx: 0.5, cy: 0.45, size: 0.3, ...fn(t, i) });
  }
  return out;
}

describe('camera signals', () => {
  it('counts blinks and keeps PERCLOS low for normal blinking', () => {
    // A 200 ms blink every 4 s → 15 blinks/min.
    const s = series(60, 10, (t) => ({ ear: t % 4000 < 200 ? 0.12 : 0.3 }));
    const stats = eyeStats(s);
    expect(stats.blinks).toBeGreaterThanOrEqual(14);
    expect(stats.blinks).toBeLessThanOrEqual(16);
    expect(stats.perclos).toBeLessThan(0.08);
  });

  it('treats long closures as closed time, not blinks', () => {
    // Eyes shut 2 s out of every 8 s → PERCLOS ≈ 0.25.
    const s = series(40, 10, (t) => ({ ear: t % 8000 < 2000 ? 0.1 : 0.3 }));
    const stats = eyeStats(s);
    expect(stats.blinks).toBe(0);
    expect(stats.perclos).toBeGreaterThan(0.2);
    expect(stats.longestClosureMs).toBeGreaterThanOrEqual(1900);
    expect(summarize(s, 40_000, 40).fatigue).toBe('high');
  });

  it('counts only sustained mouth openings as yawns', () => {
    const talking = series(20, 10, (_t, i) => ({ mar: i % 3 === 0 ? 0.7 : 0.1 }));
    expect(countYawns(talking)).toBe(0);
    const yawning = series(30, 10, (t) => ({ mar: t >= 5000 && t < 8000 ? 0.8 : 0.1 }));
    expect(countYawns(yawning)).toBe(1);
  });

  it('averages emotion over the window', () => {
    const s = series(10, 5, (_t, i) => ({ expressions: i % 4 === 0 ? { neutral: 0.9, sad: 0.1 } : { sad: 0.8, neutral: 0.2 } }));
    const e = summarizeEmotion(s)!;
    expect(e.label).toBe('sad');
    expect(e.confidence).toBeGreaterThan(0.5);
    expect(Object.values(e.scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    const obs = summarize(s, 10_000);
    expect(obs.affect).toBe('flat');
    expect(obs.notes).toContain('Looks sad');
  });

  it('recovers a synthetic pulse and rejects noise', () => {
    const bpm = 72;
    const clean = series(20, 12, (t) => ({ green: 120 + 0.6 * Math.sin((2 * Math.PI * bpm * t) / 60000) + 0.002 * t }));
    const est = estimatePulse(clean)!;
    expect(Math.abs(est.bpm - bpm)).toBeLessThanOrEqual(3);
    expect(est.confidence).toBeGreaterThan(0.5);

    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
    const noise = series(20, 12, () => ({ green: 120 + rand() * 4 }));
    expect(estimatePulse(noise)!.confidence).toBeLessThan(0.5);
    expect(estimatePulse(series(5, 12, () => ({ green: 120 })))).toBeNull();
  });

  it('reports not in frame when the face is mostly absent', () => {
    const s = series(10, 5, (_t, i) => ({ facePresent: i % 10 === 0 }));
    const obs = summarize(s, 10_000);
    expect(obs.facePresent).toBe(false);
    expect(obs.emotion).toBeNull();
    expect(obs.notes).toEqual(['Not in frame']);
  });

  it('reads posture and restlessness', () => {
    expect(summarize(series(15, 5, () => ({ cy: 0.8 })), 15_000).posture).toBe('slumped');
    expect(summarize(series(15, 5, () => ({ rollDeg: 20 })), 15_000).posture).toBe('leaning');
    expect(summarize(series(15, 5, () => ({})), 15_000).posture).toBe('upright');
    const fidget = series(15, 5, (_t, i) => ({ cx: 0.5 + (i % 2 ? 0.12 : -0.12), yaw: i % 2 ? 0.4 : -0.4 }));
    expect(summarize(fidget, 15_000).restlessness).toBe('high');
    expect(summarize(series(15, 5, () => ({})), 15_000).restlessness).toBe('low');
  });

  it('only uses the window', () => {
    const old = series(60, 5, (t) => ({ ear: t < 30_000 ? 0.1 : 0.3 }));
    expect(summarize(old, 60_000, 20).fatigue).toBe('low');
  });
});
