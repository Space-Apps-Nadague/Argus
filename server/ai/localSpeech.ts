/**
 * On-ship speech (specs/04-ai-backend.md §4.2): a local OpenAI-compatible speech server
 * (Speaches: faster-whisper for STT, Kokoro for TTS) [SRC-105]. Used for the `autonomous`
 * comm tier and as the fallback when Earth speech services cannot be reached.
 *
 * Off unless `AI_LOCAL_SPEECH_BASE_URL` is set, so machines without the stack never wait
 * on a dead port.
 */

import OpenAI, { toFile } from 'openai';
import type { VoiceOption } from '../../src/types/assistant';

type Env = Record<string, string | undefined>;

export interface LocalSpeechConfig {
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  defaultVoice: string;
  timeoutMs: number;
}

export const DEFAULT_LOCAL_STT_MODEL = 'Systran/faster-whisper-small';
export const DEFAULT_LOCAL_TTS_MODEL = 'speaches-ai/Kokoro-82M-v1.0-ONNX';
export const DEFAULT_LOCAL_VOICE = 'af_heart';

/** Kokoro v1.0 English voices (a = American, b = British; f/m = female/male). */
export const LOCAL_VOICES: VoiceOption[] = [
  { id: 'af_heart', label: 'Heart', engine: 'local', style: 'Warm', language: 'en-US' },
  { id: 'af_bella', label: 'Bella', engine: 'local', style: 'Bright', language: 'en-US' },
  { id: 'af_nicole', label: 'Nicole', engine: 'local', style: 'Soft', language: 'en-US' },
  { id: 'af_sarah', label: 'Sarah', engine: 'local', style: 'Clear', language: 'en-US' },
  { id: 'am_michael', label: 'Michael', engine: 'local', style: 'Steady', language: 'en-US' },
  { id: 'am_fenrir', label: 'Fenrir', engine: 'local', style: 'Deep', language: 'en-US' },
  { id: 'am_puck', label: 'Puck', engine: 'local', style: 'Upbeat', language: 'en-US' },
  { id: 'bf_emma', label: 'Emma', engine: 'local', style: 'Calm', language: 'en-GB' },
  { id: 'bf_isabella', label: 'Isabella', engine: 'local', style: 'Gentle', language: 'en-GB' },
  { id: 'bm_george', label: 'George', engine: 'local', style: 'Measured', language: 'en-GB' },
  { id: 'bm_fable', label: 'Fable', engine: 'local', style: 'Storyteller', language: 'en-GB' },
];

export function localSpeechConfig(env: Env = process.env): LocalSpeechConfig | null {
  const baseUrl = env.AI_LOCAL_SPEECH_BASE_URL?.trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    sttModel: env.AI_LOCAL_STT_MODEL?.trim() || DEFAULT_LOCAL_STT_MODEL,
    ttsModel: env.AI_LOCAL_TTS_MODEL?.trim() || DEFAULT_LOCAL_TTS_MODEL,
    defaultVoice: env.AI_LOCAL_TTS_VOICE?.trim() || DEFAULT_LOCAL_VOICE,
    timeoutMs: Number(env.AI_LOCAL_SPEECH_TIMEOUT_MS) || 30_000,
  };
}

function client(cfg: LocalSpeechConfig): OpenAI {
  return new OpenAI({ apiKey: 'not-needed', baseURL: cfg.baseUrl, timeout: cfg.timeoutMs, maxRetries: 0 });
}

const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
};

/** Transcribes audio on the ship. Returns `null` on any failure. */
export async function localTranscribe(
  cfg: LocalSpeechConfig,
  audioBase64: string,
  mimeType = 'audio/webm',
  language?: string
): Promise<string | null> {
  try {
    const mime = mimeType.split(';')[0].trim();
    const file = await toFile(Buffer.from(audioBase64, 'base64'), `speech.${EXT[mime] ?? 'webm'}`, { type: mime });
    const res = await client(cfg).audio.transcriptions.create({
      file,
      model: cfg.sttModel,
      ...(language ? { language: language.slice(0, 2).toLowerCase() } : {}),
    });
    const text = typeof res === 'string' ? res : res.text;
    return text?.trim() || null;
  } catch (err) {
    console.warn('[ARGUS local STT] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Synthesizes speech on the ship as WAV. Returns `null` on any failure. */
export async function localSynthesize(
  cfg: LocalSpeechConfig,
  text: string,
  voice?: string,
  speed?: number
): Promise<{ audioBase64: string; mimeType: string } | null> {
  try {
    const known = voice && LOCAL_VOICES.some((v) => v.id === voice) ? voice : cfg.defaultVoice;
    const res = await client(cfg).audio.speech.create({
      model: cfg.ttsModel,
      voice: known,
      input: text,
      response_format: 'wav',
      ...(speed ? { speed: Math.min(2, Math.max(0.5, speed)) } : {}),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) return null;
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/wav' };
  } catch (err) {
    console.warn('[ARGUS local TTS] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Reachability probe for `/api/ai/voices` and `npm run ai:local`. */
export async function probeLocalSpeech(cfg: LocalSpeechConfig): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}
