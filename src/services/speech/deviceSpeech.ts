/**
 * On-device speech (Kokoro TTS, Whisper STT) in a Web Worker, so voice works with no Gemini key
 * and no speech server (specs/04-ai-backend.md §4.2). In the on-ship tier this *is* the on-ship
 * engine: it runs on the crew's own machine.
 */

import type { WorkerRequest, WorkerResponse } from './deviceSpeech.worker';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface DeviceSpeechStatus {
  tts: 'idle' | 'loading' | 'ready' | 'failed';
  stt: 'idle' | 'loading' | 'ready' | 'failed';
  /** Download progress 0–100 of the model currently loading. */
  progress: number | null;
}

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

export const DEFAULT_DEVICE_VOICE = 'af_heart';

class DeviceSpeech {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(s: DeviceSpeechStatus) => void>();
  status: DeviceSpeechStatus = { tts: 'idle', stt: 'idle', progress: null };

  get supported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  }

  subscribe(fn: (s: DeviceSpeechStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<DeviceSpeechStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((fn) => fn(this.status));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./deviceSpeech.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        this.set({ progress: Math.round(msg.progress) });
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'On-device speech worker failed'));
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  private call(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++;
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  private async track<T>(kind: 'tts' | 'stt', work: () => Promise<T>): Promise<T> {
    if (this.status[kind] !== 'ready') this.set({ [kind]: 'loading', progress: null } as Partial<DeviceSpeechStatus>);
    try {
      const out = await work();
      this.set({ [kind]: 'ready', progress: null } as Partial<DeviceSpeechStatus>);
      return out;
    } catch (err) {
      this.set({ [kind]: 'failed', progress: null } as Partial<DeviceSpeechStatus>);
      throw err;
    }
  }

  /** Starts the model download in the background (first use only). */
  preload(what: 'tts' | 'stt'): void {
    if (!this.supported || this.status[what] === 'ready' || this.status[what] === 'loading') return;
    void this.track(what, () => this.call({ type: 'preload', what })).catch(() => {});
  }

  async speak(text: string, voice = DEFAULT_DEVICE_VOICE, speed = 1): Promise<{ samples: Float32Array; rate: number }> {
    if (!this.supported) throw new Error('On-device speech is not supported in this browser.');
    const r = await this.track('tts', () => this.call({ type: 'tts', text, voice, speed }));
    if (r.type !== 'tts') throw new Error('Unexpected on-device TTS reply');
    return { samples: r.samples, rate: r.rate };
  }

  async transcribe(samples16k: Float32Array, language = 'english'): Promise<string> {
    if (!this.supported) throw new Error('On-device speech is not supported in this browser.');
    const copy = samples16k.slice();
    const r = await this.track('stt', () => this.call({ type: 'stt', samples: copy, language }, [copy.buffer]));
    if (r.type !== 'stt') throw new Error('Unexpected on-device STT reply');
    return r.text;
  }
}

export const deviceSpeech = new DeviceSpeech();

/** Float samples from a 16-bit mono WAV produced by `encodeWav`. */
export function wavToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const n = Math.floor(Math.min(size, bytes.length - offset - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getInt16(offset + 8 + i * 2, true) / 32768;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  return new Float32Array(0);
}
