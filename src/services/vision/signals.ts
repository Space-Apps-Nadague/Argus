/**
 * Camera signal maths (specs/04-ai-backend.md §4.3). Pure functions over per-frame face
 * samples: blink rate, eye closure (PERCLOS), yawns, facial emotion, posture, restlessness
 * and a camera pulse estimate. Everything runs on-device; no image leaves the browser
 * from here.
 *
 * These are observations to prompt a question, not measurements or diagnoses.
 */

import {
  EMOTION_LABELS,
  type EmotionLabel,
  type ObservedAffect,
  type ObservedEmotion,
  type ObservedLevel,
  type ObservedPosture,
  type VisualObservation,
} from '../../types/assistant';

/** One analysed video frame. */
export interface FaceSample {
  /** Milliseconds (monotonic). */
  t: number;
  facePresent: boolean;
  /** Eye aspect ratio, mean of both eyes [SRC-097]. Open ≈ 0.3, closed < 0.2. */
  ear?: number;
  /** Mouth aspect ratio: inner-lip opening / mouth width. */
  mar?: number;
  /** Head yaw (-1 … 1, 0 = facing the camera) and roll in degrees. */
  yaw?: number;
  rollDeg?: number;
  /** Face centre and height relative to the frame (0–1). */
  cx?: number;
  cy?: number;
  size?: number;
  /** Emotion probabilities from the expression classifier [SRC-092]. */
  expressions?: Partial<Record<EmotionLabel, number>>;
  /** Mean green value of the forehead region (0–255), for the pulse estimate. */
  green?: number;
}

export const SIGNAL_LIMITS = {
  /** Eyes count as closed below this share of the person's own open-eye EAR. */
  closedEarRatio: 0.62,
  /** PERCLOS above these shares = moderate / high drowsiness signs [SRC-091]. */
  perclosModerate: 0.08,
  perclosHigh: 0.15,
  /** Resting blink rate is roughly 12–20/min; well above suggests strain or dry eyes [SRC-098]. */
  blinkRateHigh: 30,
  /** Mouth open this wide for this long counts as a yawn. */
  yawnMar: 0.55,
  yawnMinMs: 1200,
  yawnsModerate: 0.7,
  yawnsHigh: 2,
  /** Longest eye closure still counted as a blink rather than a doze. */
  blinkMaxMs: 500,
  /** Pulse band, Hz (42–180 bpm) [SRC-093]. */
  pulseMinHz: 0.7,
  pulseMaxHz: 3,
  pulseMinWindowSec: 10,
} as const;

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

/** Open-eye baseline for this person in this light: a high percentile of their own EAR. */
export function openEyeBaseline(samples: FaceSample[]): number {
  const ears = samples.filter((s) => s.facePresent && s.ear !== undefined).map((s) => s.ear!);
  return ears.length >= 5 ? Math.max(0.18, percentile(ears, 0.9)) : 0.3;
}

export interface EyeStats {
  blinks: number;
  /** Share of face-present time with eyes closed, 0–1. */
  perclos: number;
  /** Longest single closure, ms. */
  longestClosureMs: number;
}

/** Counts blinks (short closures) and total closed time. */
export function eyeStats(samples: FaceSample[]): EyeStats {
  const seen = samples.filter((s) => s.facePresent && s.ear !== undefined);
  if (seen.length < 5) return { blinks: 0, perclos: 0, longestClosureMs: 0 };
  const threshold = openEyeBaseline(seen) * SIGNAL_LIMITS.closedEarRatio;
  let blinks = 0;
  let closedMs = 0;
  let totalMs = 0;
  let longest = 0;
  let closedSince: number | null = null;
  for (let i = 0; i < seen.length; i++) {
    const s = seen[i];
    const dt = i > 0 ? Math.min(500, s.t - seen[i - 1].t) : 0;
    totalMs += dt;
    const closed = s.ear! < threshold;
    if (closed) {
      closedMs += dt;
      closedSince ??= s.t;
    } else if (closedSince !== null) {
      const duration = s.t - closedSince;
      longest = Math.max(longest, duration);
      if (duration <= SIGNAL_LIMITS.blinkMaxMs) blinks++;
      closedSince = null;
    }
  }
  if (closedSince !== null) longest = Math.max(longest, seen[seen.length - 1].t - closedSince);
  return { blinks, perclos: totalMs ? closedMs / totalMs : 0, longestClosureMs: longest };
}

/** Counts sustained wide mouth openings. */
export function countYawns(samples: FaceSample[]): number {
  let yawns = 0;
  let openSince: number | null = null;
  let counted = false;
  for (const s of samples) {
    const open = s.facePresent && (s.mar ?? 0) > SIGNAL_LIMITS.yawnMar;
    if (open) {
      openSince ??= s.t;
      if (!counted && s.t - openSince >= SIGNAL_LIMITS.yawnMinMs) {
        yawns++;
        counted = true;
      }
    } else {
      openSince = null;
      counted = false;
    }
  }
  return yawns;
}

/** Averages the classifier's per-frame probabilities over the window. */
export function summarizeEmotion(samples: FaceSample[]): ObservedEmotion | null {
  const withExpr = samples.filter((s) => s.facePresent && s.expressions);
  if (withExpr.length < 4) return null;
  const scores = Object.fromEntries(EMOTION_LABELS.map((l) => [l, 0])) as Record<EmotionLabel, number>;
  for (const s of withExpr) for (const l of EMOTION_LABELS) scores[l] += s.expressions![l] ?? 0;
  let total = 0;
  for (const l of EMOTION_LABELS) total += scores[l];
  if (total <= 0) return null;
  let label: EmotionLabel = 'neutral';
  for (const l of EMOTION_LABELS) {
    scores[l] = Math.round((scores[l] / total) * 1000) / 1000;
    if (scores[l] > scores[label]) label = l;
  }
  return { label, confidence: scores[label], scores };
}

export function affectFromEmotion(e: ObservedEmotion | null): ObservedAffect {
  if (!e) return 'unknown';
  if (e.scores.happy >= 0.35) return 'positive';
  if (e.scores.angry + e.scores.fearful + e.scores.disgusted >= 0.35) return 'tense';
  if (e.scores.sad >= 0.35) return 'flat';
  return 'neutral';
}

// ── Pulse estimate (remote photoplethysmography) ─────────────────────────────

export interface PulseEstimate {
  bpm: number;
  /** Share of band power at the peak, 0–1. Below 0.5 the estimate is not shown. */
  confidence: number;
}

/**
 * Estimates pulse from the forehead's green-channel brightness [SRC-093]: skin gets
 * very slightly darker in green with each heartbeat. Resamples to a fixed rate,
 * detrends, and takes the strongest frequency in the pulse band.
 */
export function estimatePulse(samples: FaceSample[]): PulseEstimate | null {
  const pts = samples.filter((s) => s.facePresent && s.green !== undefined);
  if (pts.length < 40) return null;
  const durationSec = (pts[pts.length - 1].t - pts[0].t) / 1000;
  if (durationSec < SIGNAL_LIMITS.pulseMinWindowSec) return null;

  // Resample to 10 Hz by linear interpolation (frames arrive unevenly).
  const rate = 10;
  const n = Math.floor(durationSec * rate);
  const signal = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = pts[0].t + (i * 1000) / rate;
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const f = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    signal[i] = a.green! + (b.green! - a.green!) * f;
  }
  // Detrend with a 1 s moving average, then apply a Hann window.
  const half = Math.floor(rate / 2);
  const detrended = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      sum += signal[k];
      count++;
    }
    detrended[i] = (signal[i] - sum / count) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  // Direct DFT over the pulse band at 1 bpm resolution.
  let bestPower = 0;
  let bestHz = 0;
  let totalPower = 0;
  for (let bpm = SIGNAL_LIMITS.pulseMinHz * 60; bpm <= SIGNAL_LIMITS.pulseMaxHz * 60; bpm++) {
    const hz = bpm / 60;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * hz * i) / rate;
      re += detrended[i] * Math.cos(angle);
      im -= detrended[i] * Math.sin(angle);
    }
    const power = re * re + im * im;
    totalPower += power;
    if (power > bestPower) {
      bestPower = power;
      bestHz = hz;
    }
  }
  if (totalPower <= 0) return null;
  // Peak share of band power, counting ±3 bpm around the peak as the peak.
  let peakPower = 0;
  for (let bpm = bestHz * 60 - 3; bpm <= bestHz * 60 + 3; bpm++) {
    const hz = bpm / 60;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * hz * i) / rate;
      re += detrended[i] * Math.cos(angle);
      im -= detrended[i] * Math.sin(angle);
    }
    peakPower += re * re + im * im;
  }
  return { bpm: Math.round(bestHz * 60), confidence: Math.min(1, peakPower / totalPower) };
}

// ── Summary ──────────────────────────────────────────────────────────────────

const levelMax = (a: ObservedLevel, b: ObservedLevel): ObservedLevel => {
  const rank = { low: 0, moderate: 1, high: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
};

/** Rolls the samples of the last `windowSec` seconds into one observation. */
export function summarize(samples: FaceSample[], now: number, windowSec = 30, capturedAt = new Date()): VisualObservation {
  const recent = samples.filter((s) => now - s.t <= windowSec * 1000);
  const seen = recent.filter((s) => s.facePresent);
  const spanSec = recent.length > 1 ? (recent[recent.length - 1].t - recent[0].t) / 1000 : 0;
  const presenceRatio = recent.length ? seen.length / recent.length : 0;
  const base: VisualObservation = {
    capturedAtIso: capturedAt.toISOString(),
    windowSec: Math.round(spanSec),
    facePresent: presenceRatio >= 0.3 && seen.length >= 3,
    presenceRatio: Math.round(presenceRatio * 100) / 100,
    blinkRatePerMin: null,
    perclos: null,
    yawnsPerMin: null,
    affect: 'unknown',
    emotion: null,
    fatigue: null,
    posture: 'unknown',
    restlessness: null,
    pulseBpmEstimate: null,
    pulseConfidence: null,
    notes: [],
  };
  if (!base.facePresent) {
    base.notes = recent.length ? ['Not in frame'] : [];
    return base;
  }

  const seenSec = Math.max(1, spanSec * presenceRatio);
  const minutes = seenSec / 60;
  const enough = seenSec >= 8;
  const eyes = eyeStats(seen);
  const yawns = countYawns(seen);
  const emotion = summarizeEmotion(seen);

  if (enough) {
    base.blinkRatePerMin = Math.round((eyes.blinks / minutes) * 10) / 10;
    base.perclos = Math.round(eyes.perclos * 1000) / 1000;
    base.yawnsPerMin = Math.round((yawns / minutes) * 10) / 10;
    let fatigue: ObservedLevel = 'low';
    if (eyes.perclos >= SIGNAL_LIMITS.perclosHigh) fatigue = 'high';
    else if (eyes.perclos >= SIGNAL_LIMITS.perclosModerate) fatigue = 'moderate';
    // Yawn counts need a longer look before they mean anything per minute.
    if (seenSec >= 20) {
      if (base.yawnsPerMin >= SIGNAL_LIMITS.yawnsHigh) fatigue = levelMax(fatigue, 'high');
      else if (base.yawnsPerMin >= SIGNAL_LIMITS.yawnsModerate) fatigue = levelMax(fatigue, 'moderate');
    } else if (yawns > 0) fatigue = levelMax(fatigue, 'moderate');
    if (eyes.longestClosureMs >= 1500) fatigue = levelMax(fatigue, 'high');
    base.fatigue = fatigue;
  }

  base.emotion = emotion;
  base.affect = affectFromEmotion(emotion);

  // Posture from where the head is and how it is tilted.
  const rolls = seen.filter((s) => s.rollDeg !== undefined).map((s) => s.rollDeg!);
  const cys = seen.filter((s) => s.cy !== undefined).map((s) => s.cy!);
  if (rolls.length >= 3) {
    const roll = Math.abs(mean(rolls));
    const low = cys.length ? mean(cys) > 0.68 : false;
    base.posture = low ? 'slumped' : roll > 14 ? 'leaning' : 'upright';
  }

  // Restlessness: how much the head moves around, relative to face size.
  const cxs = seen.filter((s) => s.cx !== undefined).map((s) => s.cx!);
  const yaws = seen.filter((s) => s.yaw !== undefined).map((s) => s.yaw!);
  if (cxs.length >= 8) {
    const size = Math.max(0.05, mean(seen.map((s) => s.size ?? 0.3)));
    const movement = (std(cxs) + std(cys)) / size + std(yaws) * 0.6;
    base.restlessness = movement > 0.55 ? 'high' : movement > 0.28 ? 'moderate' : 'low';
  }

  const pulse = estimatePulse(seen);
  if (pulse) {
    base.pulseBpmEstimate = pulse.bpm;
    base.pulseConfidence = Math.round(pulse.confidence * 100) / 100;
  }

  const notes: string[] = [];
  if (emotion && emotion.label !== 'neutral' && emotion.confidence >= 0.35) notes.push(`Looks ${emotion.label}`);
  if (base.fatigue === 'high') notes.push('Looks very tired');
  else if (base.fatigue === 'moderate') notes.push('Looks tired');
  if (base.blinkRatePerMin !== null && base.blinkRatePerMin >= SIGNAL_LIMITS.blinkRateHigh) notes.push('Blinking a lot');
  if (base.posture === 'slumped') notes.push('Slumped');
  if (base.restlessness === 'high') notes.push('Restless');
  base.notes = notes;
  return base;
}

export const POSTURE_LABELS: Record<ObservedPosture, string> = { upright: 'Upright', slumped: 'Slumped', leaning: 'Leaning', unknown: '—' };
