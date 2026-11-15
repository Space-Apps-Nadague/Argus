/**
 * Alarm for life-threatening readings: one two-tone beep (WebAudio, no audio file needed), then a
 * spoken message saying what is wrong and what to do (the browser's built-in speech synthesis,
 * on the device, no online service).
 * Browsers only allow sound after a user gesture, so `primeAlarmAudio` unlocks the
 * audio context on the first click or key press.
 */

import type { LifeThreat } from './vitalLimits';

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = ctx ?? new AC();
  return ctx;
}

/** Unlocks audio on the first user gesture. Returns a cleanup function. */
export function primeAlarmAudio(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const unlock = () => {
    try {
      void getContext()?.resume();
    } catch {
      /* audio unavailable */
    }
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

/** Plays one 1.5 s two-tone alarm (and a vibration on devices that support it). */
export function playAlarmTone(): void {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    /* no vibration */
  }
  try {
    const ac = getContext();
    if (!ac) return;
    void ac.resume();
    const t0 = ac.currentTime + 0.02;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    for (let i = 0; i < 6; i++) osc.frequency.setValueAtTime(i % 2 ? 660 : 880, t0 + i * 0.25);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.03);
    gain.gain.setValueAtTime(0.2, t0 + 1.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 1.55);
  } catch {
    /* audio unavailable: the on-screen alert still shows */
  }
}

/** Spoken units, so "42 °C" is read as "42 degrees Celsius". */
const SPOKEN_UNITS: Record<string, string> = {
  '°C': 'degrees Celsius',
  bpm: 'beats per minute',
  '%': 'percent',
  mmHg: 'millimeters of mercury',
  'mg/dL': 'milligrams per deciliter',
  mSv: 'millisieverts',
  mGy: 'milligray',
  ms: 'milliseconds',
  mm: 'millimeters',
};

const spokenNumber = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** The sentence the alarm speaks, e.g. "Emergency alert. Body temperature 42 degrees Celsius. Stop all work…". */
export function alertSpeech(threats: LifeThreat[], callsign?: string): string {
  if (!threats.length) return '';
  const parts = [callsign ? `Emergency alert for ${callsign}.` : 'Emergency alert.'];
  for (const t of threats) {
    const unit = SPOKEN_UNITS[t.unit] ?? t.unit;
    parts.push(`${t.label} ${spokenNumber(t.value)}${unit ? ` ${unit}` : ''}.`);
  }
  const actions = [...new Set(threats.map((t) => t.action.trim()).filter(Boolean))];
  parts.push(...actions);
  return parts.join(' ');
}

/** Speaks the message after the beep (≈1.6 s). Returns a function that cancels it. */
export function speakAlert(text: string, delayMs = 1600): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return () => undefined;
  const timer = window.setTimeout(() => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.95;
      u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech unavailable: the beep and the on-screen alert still work */
    }
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  };
}
