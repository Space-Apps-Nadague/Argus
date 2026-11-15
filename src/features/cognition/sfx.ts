/** Tiny WebAudio blips for game feedback. Silent when muted or audio is unavailable. */
let ctx: AudioContext | null = null;
let muted = false;

export const setGameMuted = (m: boolean) => {
  muted = m;
};
export const isGameMuted = () => muted;

function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.05) {
  if (muted) return;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g).connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t);
    o.stop(t + ms / 1000);
  } catch {
    /* no audio */
  }
}

export const sfx = {
  hit: () => tone(880, 90, 'triangle'),
  miss: () => tone(160, 160, 'sawtooth', 0.03),
  tick: () => tone(520, 60, 'square', 0.02),
  go: () => tone(1046, 160, 'triangle'),
  burst: () => tone(90, 300, 'sawtooth', 0.06),
  bank: () => {
    tone(660, 90, 'triangle');
    setTimeout(() => tone(990, 120, 'triangle'), 90);
  },
};
