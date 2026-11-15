/// <reference lib="webworker" />
/**
 * On-device speech worker (specs/04-ai-backend.md §4.2): Kokoro TTS and Whisper STT running in
 * the browser with transformers.js [SRC-109]. Models download once and are cached by the browser;
 * after that, speech works with no server, no key and no network.
 */

import type { KokoroTTS } from 'kokoro-js';

export type WorkerRequest =
  | { id: number; type: 'tts'; text: string; voice: string; speed: number }
  | { id: number; type: 'stt'; samples: Float32Array; language?: string }
  | { id: number; type: 'preload'; what: 'tts' | 'stt' };

export type WorkerResponse =
  | { id: number; type: 'tts'; samples: Float32Array; rate: number }
  | { id: number; type: 'stt'; text: string }
  | { id: number; type: 'ready' }
  | { id: number; type: 'error'; message: string }
  | { id: -1; type: 'progress'; model: 'tts' | 'stt'; progress: number };

export const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const STT_MODEL = 'onnx-community/whisper-base';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
/** WebGPU only when a real adapter exists (navigator.gpu can be present with no usable GPU). */
let webGpu: Promise<boolean> | null = null;
function hasWebGpu(): Promise<boolean> {
  webGpu ??= (async () => {
    const gpu = (self as unknown as { navigator?: { gpu?: { requestAdapter(): Promise<unknown> } } }).navigator?.gpu;
    if (!gpu) return false;
    try {
      return Boolean(await gpu.requestAdapter());
    } catch {
      return false;
    }
  })();
  return webGpu;
}

type Asr = (input: Float32Array, opts?: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;

let tts: Promise<KokoroTTS> | null = null;
let asr: Promise<Asr> | null = null;

const progress = (model: 'tts' | 'stt') => (p: { status?: string; progress?: number }) => {
  if (p.status === 'progress' && typeof p.progress === 'number') ctx.postMessage({ id: -1, type: 'progress', model, progress: p.progress } satisfies WorkerResponse);
};

function loadTts(): Promise<KokoroTTS> {
  tts ??= (async () => {
    const { KokoroTTS } = await import('kokoro-js');
    const opts = (device: 'webgpu' | 'wasm') => ({
      dtype: device === 'webgpu' ? ('fp32' as const) : ('q8' as const),
      device,
      progress_callback: progress('tts'),
    });
    if (await hasWebGpu()) {
      try {
        return await KokoroTTS.from_pretrained(TTS_MODEL, opts('webgpu'));
      } catch {
        // fall back to WebAssembly
      }
    }
    return KokoroTTS.from_pretrained(TTS_MODEL, opts('wasm'));
  })();
  tts.catch(() => (tts = null));
  return tts;
}

function loadAsr(): Promise<Asr> {
  asr ??= (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const make = (device: 'webgpu' | 'wasm') =>
      pipeline('automatic-speech-recognition', STT_MODEL, {
        device,
        dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: progress('stt'),
      }) as unknown as Promise<Asr>;
    if (await hasWebGpu()) {
      try {
        return await make('webgpu');
      } catch {
        // fall back to WebAssembly
      }
    }
    return make('wasm');
  })();
  asr.catch(() => (asr = null));
  return asr;
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'preload') {
      await (req.what === 'tts' ? loadTts() : loadAsr());
      ctx.postMessage({ id: req.id, type: 'ready' } satisfies WorkerResponse);
    } else if (req.type === 'tts') {
      const model = await loadTts();
      const audio = await model.generate(req.text, { voice: req.voice as never, speed: req.speed });
      const samples = audio.audio as Float32Array;
      ctx.postMessage({ id: req.id, type: 'tts', samples, rate: audio.sampling_rate } satisfies WorkerResponse, [samples.buffer]);
    } else if (req.type === 'stt') {
      const model = await loadAsr();
      const out = await model(req.samples, {
        language: req.language ?? 'english',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim();
      ctx.postMessage({ id: req.id, type: 'stt', text } satisfies WorkerResponse);
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, type: 'error', message: (err as Error).message || String(err) } satisfies WorkerResponse);
  }
};
