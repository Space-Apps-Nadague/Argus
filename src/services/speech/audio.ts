/**
 * Audio plumbing shared by every speech engine: PCM conversion, WAV encoding, and a
 * gapless queue player on one AudioContext so a single `stop()` silences everything
 * (barge-in). Pure helpers are exported for tests.
 */

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

/** 16-bit little-endian PCM → float samples in [-1, 1]. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function float32ToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Averaging downsampler (good enough for speech; avoids aliasing better than dropping samples). */
export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** Mono 16-bit WAV file bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcm = float32ToPcm16(samples);
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Root-mean-square level, 0–1. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Sample rate from a mime type such as `audio/pcm;rate=24000` or `audio/l16; rate=24000`. */
export function pcmRateFromMime(mime: string | undefined, fallback = 24000): number {
  const m = /rate=(\d+)/i.exec(mime ?? '');
  return m ? Number(m[1]) : fallback;
}

export function isRawPcmMime(mime: string | undefined): boolean {
  return /audio\/(pcm|l16)/i.test(mime ?? '');
}

// ── Playback ─────────────────────────────────────────────────────────────────

let sharedContext: AudioContext | null = null;

/** One AudioContext for the app. Must first be called from a user gesture to be allowed to play. */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new Ctor();
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => {});
  return sharedContext;
}

/**
 * Plays audio chunks back to back with no gaps. Chunks may be raw PCM (live session) or
 * encoded files (TTS route). `stop()` cuts everything immediately.
 */
export class QueuePlayer {
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private gain: GainNode | null = null;
  /** Called when the queue drains or is stopped. */
  onIdle: (() => void) | null = null;
  onStart: (() => void) | null = null;

  constructor(private readonly contextFactory: () => AudioContext | null = getAudioContext) {}

  get playing(): boolean {
    return this.sources.size > 0;
  }

  private output(ctx: AudioContext): GainNode {
    if (!this.gain || this.gain.context !== ctx) {
      this.gain = ctx.createGain();
      this.gain.connect(ctx.destination);
    }
    return this.gain;
  }

  /** Queues float PCM at `sampleRate`. Returns false when audio is unavailable. */
  enqueuePcm(samples: Float32Array, sampleRate: number, playbackRate = 1): boolean {
    const ctx = this.contextFactory();
    if (!ctx || !samples.length) return false;
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    this.schedule(ctx, buffer, playbackRate);
    return true;
  }

  /** Decodes and queues an encoded file (WAV, MP3…) or raw PCM by mime type. */
  async enqueueEncoded(base64: string, mimeType: string, playbackRate = 1): Promise<boolean> {
    const ctx = this.contextFactory();
    if (!ctx) return false;
    const generation = this.generation;
    const bytes = base64ToBytes(base64);
    if (isRawPcmMime(mimeType)) {
      return this.enqueuePcm(pcm16ToFloat32(bytes), pcmRateFromMime(mimeType), playbackRate);
    }
    try {
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      if (generation !== this.generation) return false; // stopped while decoding
      this.schedule(ctx, buffer, playbackRate);
      return true;
    } catch {
      return false;
    }
  }

  private schedule(ctx: AudioContext, buffer: AudioBuffer, playbackRate: number) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(this.output(ctx));
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextTime);
    this.nextTime = startAt + buffer.duration / playbackRate;
    const wasIdle = this.sources.size === 0;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onIdle?.();
    };
    source.start(startAt);
    if (wasIdle) this.onStart?.();
  }

  /** Seconds of audio still queued. */
  get queuedSeconds(): number {
    const ctx = this.contextFactory();
    return ctx ? Math.max(0, this.nextTime - ctx.currentTime) : 0;
  }

  /** Stops everything now (barge-in). */
  stop(): void {
    this.generation++;
    const had = this.sources.size > 0;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextTime = 0;
    if (had) this.onIdle?.();
  }
}
