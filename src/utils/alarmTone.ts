/**
 * Alarm for dangerous readings: one beep + spoken "Alert", then a spoken message saying what
 * was detected and what to do (WebAudio beeps, the browser's built-in speech synthesis; on the device,
 * no audio files, no online service).
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

/**
 * Unlocks audio and speech on the first user gesture (browsers block both before one).
 * Returns a cleanup function.
 */
export function primeAlarmAudio(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const unlock = () => {
    try {
      void getContext()?.resume();
    } catch {
      /* audio unavailable */
    }
    try {
      // A silent utterance unlocks speech (Safari/iOS) and makes the browser load its voices.
      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* speech unavailable */
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

/** Spoken units, so "38.5 °C" is read as "38.5 degrees Celsius". */
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

/** "Stop strenuous work, …" → "stop strenuous work, …" (it follows "You should"). */
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * The explanation spoken after the three "Alert"s, e.g.
 * "38.5 degrees Celsius body temperature detected for VEGA. You should stop strenuous work, … now."
 */
export function alertSpeech(threats: LifeThreat[], callsign?: string): string {
  if (!threats.length) return '';
  const parts: string[] = [];
  threats.forEach((t, i) => {
    const unit = SPOKEN_UNITS[t.unit] ?? t.unit;
    const who = i === 0 && callsign ? ` for ${callsign}` : '';
    parts.push(`${spokenNumber(t.value)}${unit ? ` ${unit}` : ''} ${t.label.toLowerCase()} detected${who}.`);
  });
  const actions = [...new Set(threats.map((t) => t.action.trim().replace(/[.\s]+$/, '')).filter(Boolean))];
  for (const a of actions) parts.push(`You should ${lowerFirst(a.replace(/\s+now$/i, ''))} now.`);
  return parts.join(' ');
}

/** Short single beep between the spoken "Alert"s. */
export function playBeep(seconds = 0.4): void {
  try {
    const ac = getContext();
    if (!ac) return;
    void ac.resume();
    const t0 = ac.currentTime + 0.02;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    gain.gain.setValueAtTime(0.2, t0 + seconds - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.05);
  } catch {
    /* audio unavailable */
  }
}

/** Kept in a module variable: Chrome stops an utterance that gets garbage-collected while speaking. */
let utterance: SpeechSynthesisUtterance | null = null;

/** An English voice, preferring one installed on the device. */
function englishVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  return (
    voices.find((v) => /^en[-_]US/i.test(v.lang) && v.localService) ??
    voices.find((v) => /^en[-_]US/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null
  );
}

/** One step of the alert sequence. */
export type AlertStep = { kind: 'beep' } | { kind: 'say'; text: string };

/** Beep + "Alert" (once by default), then the explanation. */
export function alertSteps(message: string, repeats = 1): AlertStep[] {
  const steps: AlertStep[] = [];
  for (let i = 0; i < repeats; i++) steps.push({ kind: 'beep' }, { kind: 'say', text: 'Alert!' });
  if (message) steps.push({ kind: 'say', text: message });
  return steps;
}

/**
 * Plays the alert: one beep, "Alert", then the spoken explanation. Each step waits for
 * the previous one (speech `onend`, with a time-out in case a browser never fires it).
 * Without speech support only the beeps play. Returns a function that stops everything.
 */
export function runAlertSequence(message: string, repeats = 1): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const steps = alertSteps(message, repeats).filter((s) => s.kind === 'beep' || synth);
  let cancelled = false;
  let timer = 0;
  const next = (i: number) => {
    if (cancelled || i >= steps.length) return;
    const step = steps[i];
    if (step.kind === 'beep') {
      playBeep(0.4);
      timer = window.setTimeout(() => next(i + 1), 500);
      return;
    }
    try {
      const u = new SpeechSynthesisUtterance(step.text);
      u.lang = 'en-US';
      u.rate = step.text === 'Alert!' ? 1 : 0.95;
      u.volume = 1;
      const voice = englishVoice(synth!);
      if (voice) u.voice = voice;
      let advanced = false;
      const go = () => {
        if (advanced) return;
        advanced = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => next(i + 1), 150);
      };
      u.onend = go;
      u.onerror = go;
      utterance = u;
      synth!.resume();
      synth!.speak(u);
      // Fallback if onend never fires: about 70 ms per character, at least 1.5 s.
      timer = window.setTimeout(go, Math.max(1500, step.text.length * 70));
    } catch {
      next(i + 1);
    }
  };
  // Chrome drops a speak() issued right after cancel(), so clear old speech and wait a moment.
  try {
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
  } catch {
    /* ignore */
  }
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    /* no vibration */
  }
  timer = window.setTimeout(() => next(0), 120);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    try {
      if (synth && (synth.speaking || synth.pending)) synth.cancel();
    } catch {
      /* ignore */
    }
    utterance = null;
  };
}
