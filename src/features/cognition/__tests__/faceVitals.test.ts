import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import {
  compareFace,
  countBlinks,
  estimateHeartRate,
  gazeJitter,
  rgbToLab,
  summarizeFace,
  type FaceFrame,
  type FaceVitalsSummary,
} from '../faceVitals';

const FPS = 15;
const frames = (seconds: number, f: (t: number, k: number) => Partial<FaceFrame>): FaceFrame[] =>
  Array.from({ length: seconds * FPS }, (_, k) => {
    const t = (k * 1000) / FPS;
    return { t, blink: 0.05, gaze: { x: 0.5, y: 0.5 }, rgb: [190, 140, 120], widthRatio: 1.6, ...f(t, k) };
  });

/** Face colour with a pulse at `bpm`, plus camera noise. */
const pulseRgb = (t: number, bpm: number, rand: () => number): [number, number, number] => {
  const p = Math.sin((2 * Math.PI * bpm * t) / 60000);
  return [180 + 0.6 * p + (rand() - 0.5) * 0.8, 130 + 1.2 * p + (rand() - 0.5) * 0.8, 110 + 0.4 * p + (rand() - 0.5) * 0.8];
};

describe('camera health check', () => {
  it('counts blinks with hysteresis (no double count on a flickering lid)', () => {
    const f = frames(10, (t) => ({ blink: [1000, 1050, 1100, 4000, 4050, 7000].some((b) => Math.abs(t - b) < 40) ? 0.8 : t > 1000 && t < 1200 ? 0.4 : 0.05 }));
    expect(countBlinks(f)).toBe(3);
  });

  it('measures gaze jitter and ignores saccades and blinks', () => {
    const rand = mulberry32(1);
    const steady = frames(20, () => ({ gaze: { x: 0.5 + (rand() - 0.5) * 0.004, y: 0.5 } }));
    const shaky = frames(20, () => ({ gaze: { x: 0.5 + (rand() - 0.5) * 0.03, y: 0.5 } }));
    const withSaccades = frames(20, (_, k) => ({ gaze: { x: k % 30 < 15 ? 0.3 : 0.7, y: 0.5 } }));
    expect(gazeJitter(steady)!).toBeLessThan(gazeJitter(shaky)!);
    expect(gazeJitter(withSaccades)).toBe(0);
  });

  it('converts skin colour to CIELAB (white, red)', () => {
    const w = rgbToLab([255, 255, 255]);
    expect(w.L).toBeCloseTo(100, 0);
    expect(Math.abs(w.a)).toBeLessThan(0.5);
    expect(rgbToLab([200, 120, 110]).a).toBeGreaterThan(rgbToLab([200, 185, 180]).a);
  });

  it('finds the heart rate in a noisy face-colour signal', () => {
    for (const bpm of [62, 88, 120]) {
      const rand = mulberry32(bpm);
      const s = Array.from({ length: 60 * FPS }, (_, k) => {
        const t = (k * 1000) / FPS + (rand() - 0.5) * 20; // jittery frame times
        return { t, rgb: pulseRgb(t, bpm, rand) };
      });
      const hr = estimateHeartRate(s)!;
      expect(Math.abs(hr.bpm - bpm)).toBeLessThanOrEqual(2);
      expect(hr.quality).toBeGreaterThan(0.3);
    }
  });

  it('does not report a heart rate from pure noise or too little video', () => {
    const rand = mulberry32(9);
    const noise = Array.from({ length: 60 * FPS }, (_, k) => ({ t: (k * 1000) / FPS, rgb: [180 + rand() * 3, 130 + rand() * 3, 110 + rand() * 3] as [number, number, number] }));
    const hr = estimateHeartRate(noise);
    expect(hr === null || hr.quality < 0.3).toBe(true);
    expect(estimateHeartRate(noise.slice(0, 10 * FPS))).toBeNull();
  });

  it('summarises a 3-minute game', () => {
    const rand = mulberry32(5);
    const f = frames(180, (t) => ({ blink: Math.floor(t / 4000) !== Math.floor((t - 1000 / FPS) / 4000) ? 0.9 : 0.05, rgb: pulseRgb(t, 75, rand) }));
    const s = summarizeFace(f)!;
    expect(s.faceSeenPct).toBe(100);
    expect(s.blinkRate).toBeGreaterThan(13);
    expect(s.blinkRate).toBeLessThan(17);
    expect(s.heartRate).toBeGreaterThanOrEqual(73);
    expect(s.heartRate).toBeLessThanOrEqual(77);
    expect(s.faceWidthRatio).toBe(1.6);
  });

  it('says "no face" instead of guessing when the face is mostly missing', () => {
    const s = summarizeFace(frames(60, (_, k) => (k % 10 ? { blink: null, gaze: null, rgb: null, widthRatio: null } : {})))!;
    expect(s.blinkRate).toBeNull();
    expect(s.heartRate).toBeNull();
  });

  it('flags pallor and a fuller face against the personal baseline, after 3 sessions', () => {
    const base: FaceVitalsSummary = { seconds: 180, faceSeenPct: 98, blinkRate: 14, eyesClosedPct: 3, gazeJitter: 0.4, skinL: 62, skinA: 16, faceWidthRatio: 1.6, heartRate: 70, heartRateQuality: 0.5 };
    const today = { ...base, skinA: 11.5, faceWidthRatio: 1.67, heartRate: 74 };
    expect(compareFace(today, [base, base]).every((f) => f.flag === null)).toBe(true);
    const f = Object.fromEntries(compareFace(today, [base, base, base]).map((x) => [x.key, x]));
    expect(f.skinA.flag).toBe('changed');
    expect(f.faceWidthRatio.flag).toBe('changed');
    expect(f.heartRate.flag).toBe('usual');
    expect(f.gazeJitter.flag).toBe('usual');
  });
});
