/**
 * ARGUS — Camera health check during the cognition game (specs/02-ui-dashboard.md §2.8).
 * Pure analysis of per-frame face measurements taken on the device (MediaPipe Face Landmarker,
 * see faceCapture.ts). Nothing leaves the device. These are screening signs compared with the
 * crew member's own baseline, not diagnoses: camera, lighting and head position all affect them.
 *
 *  - Eyes: blink rate, % of time eyes closed (fatigue), gaze jitter (small frame-to-frame movement
 *    of the iris while looking at the game; a webcam sees only coarse movement, not fine nystagmus).
 *  - Pallor: skin colour of forehead and cheeks in CIELAB; a lower a* (less red) than usual = paler.
 *  - Face fullness: cheek width / distance between the eyes; higher than usual can mean fluid has
 *    shifted to the head (the "puffy face" of microgravity).
 *  - Heart rate from the face (remote photoplethysmography, POS method): tiny colour changes with
 *    each heartbeat. Only reported when the signal is clean enough.
 */

export interface FaceFrame {
  /** ms */
  t: number;
  /** Eyes closed 0–1 (mean of MediaPipe eyeBlinkLeft/Right). Null when no face. */
  blink: number | null;
  /** Iris position inside the eye, in eye widths (mean of both eyes). */
  gaze: { x: number; y: number } | null;
  /** Mean skin colour of forehead + cheeks, 0–255. */
  rgb: [number, number, number] | null;
  /** Cheek width / distance between the outer eye corners, on frames facing the camera. */
  widthRatio: number | null;
}

export interface FaceVitalsSummary {
  seconds: number;
  /** % of frames with a face. */
  faceSeenPct: number;
  blinkRate: number | null;
  eyesClosedPct: number | null;
  /** RMS frame-to-frame iris movement during fixation, % of eye width. */
  gazeJitter: number | null;
  skinL: number | null;
  skinA: number | null;
  faceWidthRatio: number | null;
  heartRate: number | null;
  /** 0–1: share of the pulse band's power at the heart-rate peak. */
  heartRateQuality: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const std = (xs: number[]) => {
  const m = meanOf(xs);
  return Math.sqrt(meanOf(xs.map((x) => (x - m) ** 2)));
};
const round = (x: number, d = 1) => Number(x.toFixed(d));

/** Blinks counted with hysteresis: closed above 0.5, open again below 0.3. */
export function countBlinks(frames: FaceFrame[]): number {
  let closed = false;
  let n = 0;
  for (const f of frames) {
    if (f.blink === null) continue;
    if (!closed && f.blink > 0.5) {
      closed = true;
      n++;
    } else if (closed && f.blink < 0.3) closed = false;
  }
  return n;
}

/** RMS of small frame-to-frame iris moves (saccades over 6 % of eye width and blinks excluded). */
export function gazeJitter(frames: FaceFrame[], saccade = 0.06): number | null {
  const d: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!a.gaze || !b.gaze || (a.blink ?? 1) > 0.3 || (b.blink ?? 1) > 0.3 || b.t - a.t > 150) continue;
    const m = Math.hypot(b.gaze.x - a.gaze.x, b.gaze.y - a.gaze.y);
    if (m <= saccade) d.push(m);
  }
  if (d.length < 30) return null;
  return round(Math.sqrt(meanOf(d.map((x) => x * x))) * 100, 2);
}

/** sRGB (0–255) → CIELAB (D65). */
export function rgbToLab([r, g, b]: [number, number, number]): { L: number; a: number; b: number } {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * Heart rate (bpm) from face colour with the POS method (Wang et al., 2017): resample to 15 Hz,
 * project normalised RGB onto the plane orthogonal to skin tone, then find the strongest frequency
 * between 42 and 180 bpm. Needs ≥ 20 s of signal.
 */
export function estimateHeartRate(samples: { t: number; rgb: [number, number, number] }[]): { bpm: number; quality: number } | null {
  const pts = samples.filter((s) => s.rgb.every((c) => c > 0)).sort((a, b) => a.t - b.t);
  if (pts.length < 30) return null;
  const fs = 15;
  const t0 = pts[0].t;
  const dur = (pts[pts.length - 1].t - t0) / 1000;
  if (dur < 20) return null;
  const n = Math.floor(dur * fs);
  const rgb: [number, number, number][] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = t0 + (k * 1000) / fs;
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const w = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    rgb.push([0, 1, 2].map((c) => a.rgb[c] + (b.rgb[c] - a.rgb[c]) * w) as [number, number, number]);
  }
  // POS with 1.6 s sliding windows, overlap-added.
  const l = Math.round(1.6 * fs);
  const h = new Array<number>(n).fill(0);
  for (let s = 0; s + l <= n; s++) {
    const win = rgb.slice(s, s + l);
    const m = [0, 1, 2].map((c) => meanOf(win.map((x) => x[c])));
    if (m.some((v) => v <= 0)) continue;
    const s1 = win.map((x) => x[1] / m[1] - x[2] / m[2]);
    const s2 = win.map((x) => x[1] / m[1] + x[2] / m[2] - (2 * x[0]) / m[0]);
    const alpha = std(s2) ? std(s1) / std(s2) : 0;
    const p = s1.map((v, i) => v + alpha * s2[i]);
    const pm = meanOf(p);
    for (let i = 0; i < l; i++) h[s + i] += p[i] - pm;
  }
  const hm = meanOf(h);
  const sig = h.map((v) => v - hm);
  let best = 0;
  let bestBpm = 0;
  const power: { bpm: number; p: number }[] = [];
  for (let bpm = 42; bpm <= 180; bpm += 0.5) {
    const w = (2 * Math.PI * bpm) / 60 / fs;
    let re = 0;
    let im = 0;
    for (let k = 0; k < sig.length; k++) {
      re += sig[k] * Math.cos(w * k);
      im -= sig[k] * Math.sin(w * k);
    }
    const p = re * re + im * im;
    power.push({ bpm, p });
    if (p > best) {
      best = p;
      bestBpm = bpm;
    }
  }
  const total = power.reduce((a, x) => a + x.p, 0);
  if (!total) return null;
  const near = power.filter((x) => Math.abs(x.bpm - bestBpm) <= 3).reduce((a, x) => a + x.p, 0);
  return { bpm: Math.round(bestBpm), quality: round(near / total, 2) };
}

/** Heart rate is shown only above this signal quality. */
export const HR_MIN_QUALITY = 0.3;

export function summarizeFace(frames: FaceFrame[]): FaceVitalsSummary | null {
  if (frames.length < 10) return null;
  const seconds = (frames[frames.length - 1].t - frames[0].t) / 1000;
  const withFace = frames.filter((f) => f.blink !== null);
  const facePct = (withFace.length / frames.length) * 100;
  // Face visible less than half the time: report nothing rather than guess.
  if (withFace.length < 30 || seconds < 15 || facePct < 50) {
    return { seconds: round(seconds, 0), faceSeenPct: round(facePct, 0), blinkRate: null, eyesClosedPct: null, gazeJitter: null, skinL: null, skinA: null, faceWidthRatio: null, heartRate: null, heartRateQuality: null };
  }
  const faceMinutes = (seconds * (withFace.length / frames.length)) / 60;
  const labs = frames.filter((f) => f.rgb).map((f) => rgbToLab(f.rgb!));
  const ratios = frames.map((f) => f.widthRatio).filter((x): x is number => x !== null);
  const hr = estimateHeartRate(frames.filter((f) => f.rgb).map((f) => ({ t: f.t, rgb: f.rgb! })));
  return {
    seconds: round(seconds, 0),
    faceSeenPct: round(facePct, 0),
    blinkRate: faceMinutes > 0 ? round(countBlinks(frames) / faceMinutes, 1) : null,
    eyesClosedPct: round((withFace.filter((f) => (f.blink ?? 0) > 0.6).length / withFace.length) * 100, 1),
    gazeJitter: gazeJitter(frames),
    skinL: labs.length ? round(median(labs.map((x) => x.L))) : null,
    skinA: labs.length ? round(median(labs.map((x) => x.a))) : null,
    faceWidthRatio: ratios.length >= 10 ? round(median(ratios), 3) : null,
    heartRate: hr && hr.quality >= HR_MIN_QUALITY ? hr.bpm : null,
    heartRateQuality: hr ? hr.quality : null,
  };
}

// ── Comparison with the crew member's own baseline ──────────────────────────

export type FaceMetricKey = 'blinkRate' | 'eyesClosedPct' | 'gazeJitter' | 'skinA' | 'faceWidthRatio' | 'heartRate';

export interface FaceFinding {
  key: FaceMetricKey;
  label: string;
  value: number | null;
  unit: string;
  baseline: number | null;
  /** null while calibrating or without a value. */
  flag: 'usual' | 'changed' | null;
  note: string;
}

/** Sessions needed before a baseline is used. */
export const FACE_BASELINE_MIN = 3;

/**
 * ARGUS screening thresholds (heuristics, not clinical cut-offs): a change this large from the
 * personal median is shown as "changed" so the crew can look again or check with the CMO.
 */
const RULES: { key: FaceMetricKey; label: string; unit: string; changed: (v: number, b: number) => boolean; note: string; usual: string }[] = [
  { key: 'skinA', label: 'Skin colour (redness a*)', unit: '', changed: (v, b) => b - v >= 3, note: 'Paler than usual. Check the lighting is the same; if it is, report it to the CMO.', usual: 'Usual colour' },
  { key: 'faceWidthRatio', label: 'Face fullness', unit: '', changed: (v, b) => (v - b) / b >= 0.03, note: 'Face looks fuller than usual: possible fluid shift to the head.', usual: 'Usual' },
  { key: 'gazeJitter', label: 'Gaze steadiness (jitter)', unit: '% eye width', changed: (v, b) => v >= b * 1.5 && v - b >= 0.3, note: 'Eyes less steady than usual (fatigue, or worth an eye check).', usual: 'Steady as usual' },
  { key: 'eyesClosedPct', label: 'Eyes closed', unit: '% of time', changed: (v, b) => v - b >= 5, note: 'Eyes closed more than usual: a sign of fatigue.', usual: 'Usual' },
  { key: 'blinkRate', label: 'Blink rate', unit: '/min', changed: (v, b) => Math.abs(v - b) >= Math.max(6, b * 0.5), note: 'Blinking much more or less than usual (dry eyes or fatigue).', usual: 'Usual' },
  { key: 'heartRate', label: 'Heart rate (from face)', unit: 'bpm', changed: (v, b) => v - b >= 15, note: 'Heart rate higher than usual during the game.', usual: 'Usual' },
];

export function compareFace(current: FaceVitalsSummary, history: FaceVitalsSummary[]): FaceFinding[] {
  return RULES.map((r) => {
    const value = current[r.key];
    const past = history.map((h) => h[r.key]).filter((x): x is number => x !== null).slice(-7);
    const baseline = past.length >= FACE_BASELINE_MIN ? median(past) : null;
    if (value === null) return { key: r.key, label: r.label, value, unit: r.unit, baseline, flag: null, note: 'Not enough clean video this time.' };
    if (baseline === null)
      return { key: r.key, label: r.label, value, unit: r.unit, baseline, flag: null, note: `Calibrating ${past.length}/${FACE_BASELINE_MIN}` };
    const changed = r.changed(value, baseline);
    return { key: r.key, label: r.label, value, unit: r.unit, baseline: round(baseline, 3), flag: changed ? 'changed' : 'usual', note: changed ? r.note : r.usual };
  });
}

// ── Storage (this device) ────────────────────────────────────────────────────

export const FACE_STORAGE_KEY = 'argus.cognition.facevitals.v1';

export interface StoredFaceSummary extends FaceVitalsSummary {
  crewId: string;
  sessionId: string;
  timestampIso: string;
}

export function loadFaceHistory(crewId: string): StoredFaceSummary[] {
  try {
    const all = JSON.parse(localStorage.getItem(FACE_STORAGE_KEY) ?? '[]') as StoredFaceSummary[];
    return Array.isArray(all) ? all.filter((s) => s.crewId === crewId) : [];
  } catch {
    return [];
  }
}

export function saveFaceSummary(s: StoredFaceSummary): void {
  try {
    const all = JSON.parse(localStorage.getItem(FACE_STORAGE_KEY) ?? '[]') as StoredFaceSummary[];
    const next = [...(Array.isArray(all) ? all : []), s].slice(-200);
    localStorage.setItem(FACE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: keep this session only */
  }
}
