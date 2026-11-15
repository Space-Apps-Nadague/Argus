/**
 * Single alarm sound for life-threatening readings (WebAudio, no audio file needed).
 * Browsers only allow sound after a user gesture, so `primeAlarmAudio` unlocks the
 * audio context on the first click or key press.
 */

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
