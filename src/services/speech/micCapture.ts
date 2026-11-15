/**
 * Microphone capture: one PCM path for everything (specs/04-ai-backend.md §4.2).
 *
 * - `onFrame` gets 16 kHz mono frames, for streaming to a live session.
 * - Push-to-talk and hands-free (VAD) both produce a 16 kHz WAV for the STT route,
 *   with a short pre-roll so the first word is not clipped.
 * - `onSpeechStart` fires as soon as the crew member starts talking, for barge-in.
 */

import { bytesToBase64, downsample, encodeWav, getAudioContext, rms } from './audio';
import { DEFAULT_VAD, Vad, type VadOptions } from './vad';

export const CAPTURE_RATE = 16000;
const PRE_ROLL_MS = 350;

const WORKLET_SOURCE = `
class ArgusCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('argus-capture', ArgusCapture);
`;

export interface Utterance {
  wavBase64: string;
  mimeType: 'audio/wav';
  durationMs: number;
}

export interface MicCaptureEvents {
  onFrame?: (samples16k: Float32Array) => void;
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
  /** Hands-free: a finished utterance. */
  onUtterance?: (utterance: Utterance) => void;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private node: AudioNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private vad: Vad;
  private handsFree = false;
  private recording = false;
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private muted = false;

  constructor(private readonly events: MicCaptureEvents = {}, vadOptions: VadOptions = DEFAULT_VAD) {
    this.vad = new Vad(vadOptions);
  }

  get active(): boolean {
    return Boolean(this.stream);
  }

  /** Opens the microphone. Throws when permission is denied or audio is unavailable. */
  async start(): Promise<void> {
    if (this.stream) return;
    const ctx = getAudioContext();
    if (!ctx || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone is not available in this browser.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    const onSamples = (input: Float32Array) => this.handle(downsample(input, ctx.sampleRate, CAPTURE_RATE));

    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const worklet = new AudioWorkletNode(ctx, 'argus-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
      this.source.connect(worklet);
      this.node = worklet;
    } catch {
      // Older browsers: ScriptProcessor still works everywhere.
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
      const silent = ctx.createGain();
      silent.gain.value = 0;
      this.source.connect(proc);
      proc.connect(silent);
      silent.connect(ctx.destination);
      this.node = proc;
    }
  }

  stop(): void {
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.node = null;
    this.recording = false;
    this.chunks = [];
    this.preRoll = [];
    this.preRollSamples = 0;
    this.vad.reset();
    this.events.onLevel?.(0);
  }

  /** While muted, frames are dropped (used so ARGUS does not hear itself when echo cancellation is weak). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.vad.reset();
  }

  setHandsFree(on: boolean): void {
    this.handsFree = on;
    this.vad.reset();
    if (!on && this.recording) this.chunks = [];
  }

  /** Push-to-talk: start collecting. */
  beginUtterance(): void {
    this.chunks = [...this.preRoll];
    this.recording = true;
  }

  /** Push-to-talk: stop and return what was said (null if nothing audible). */
  endUtterance(): Utterance | null {
    if (!this.recording) return null;
    this.recording = false;
    return this.buildUtterance();
  }

  cancelUtterance(): void {
    this.recording = false;
    this.chunks = [];
  }

  private buildUtterance(): Utterance | null {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    if (total < CAPTURE_RATE * 0.25) {
      this.chunks = [];
      return null;
    }
    const all = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    if (rms(all) < 0.003) return null;
    return { wavBase64: bytesToBase64(encodeWav(all, CAPTURE_RATE)), mimeType: 'audio/wav', durationMs: Math.round((total / CAPTURE_RATE) * 1000) };
  }

  private handle(samples: Float32Array): void {
    if (this.muted || !samples.length) return;
    const level = rms(samples);
    this.events.onLevel?.(Math.min(1, level * 6));
    this.events.onFrame?.(samples);

    if (this.recording) this.chunks.push(samples);

    // Rolling pre-roll so the first syllable survives.
    this.preRoll.push(samples);
    this.preRollSamples += samples.length;
    const maxPre = (CAPTURE_RATE * PRE_ROLL_MS) / 1000;
    while (this.preRollSamples > maxPre && this.preRoll.length > 1) {
      this.preRollSamples -= this.preRoll.shift()!.length;
    }

    const event = this.vad.push(level, (samples.length / CAPTURE_RATE) * 1000);
    if (event === 'start') {
      this.events.onSpeechStart?.();
      if (this.handsFree && !this.recording) {
        this.chunks = [...this.preRoll];
        this.recording = true;
      }
    } else if (this.handsFree && this.recording && (event === 'end' || event === 'discard')) {
      this.recording = false;
      const utterance = event === 'end' ? this.buildUtterance() : null;
      this.chunks = [];
      if (utterance) this.events.onUtterance?.(utterance);
    }
  }
}
