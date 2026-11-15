/**
 * Speaks a streamed reply sentence by sentence (specs/04-ai-backend.md §4.2).
 *
 * The first sentence is synthesized as soon as it is complete, later sentences are
 * synthesized ahead while earlier ones play, and `cancel()` stops everything at once
 * for barge-in. The server picks the engine for the comm tier (Earth voice or on-ship
 * voice); if it has none, the browser's own voice is used for the rest of the reply.
 */

import type { CommTier } from '../../../shared/commProfile';
import type { VoiceEngineId } from '../../types/assistant';
import { QueuePlayer } from './audio';
import { SentenceChunker } from './sentenceChunker';

export interface SynthResult {
  audioBase64: string;
  mimeType: string;
  useBrowserSpeechFallback: boolean;
  engine?: VoiceEngineId;
}

export interface SpeechOutputDeps {
  synthesize: (text: string, signal: AbortSignal) => Promise<SynthResult>;
  player?: QueuePlayer;
  /** Browser speech; injectable for tests. */
  browserSpeak?: (text: string, opts: { voiceName?: string; rate: number }) => Promise<void>;
  browserCancel?: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onEngine?: (engine: VoiceEngineId) => void;
  /** Milliseconds from `begin()` to first audio, for the latency readout. */
  onFirstAudio?: (ms: number) => void;
}

export interface SpeechSettings {
  rate: number;
  browserVoiceName?: string;
}

/** Picks a pleasant default when the crew member has not chosen a browser voice. */
export function pickBrowserVoice(voices: SpeechSynthesisVoice[], preferred?: string): SpeechSynthesisVoice | undefined {
  if (preferred) {
    const exact = voices.find((v) => v.name === preferred);
    if (exact) return exact;
  }
  const english = voices.filter((v) => /^en/i.test(v.lang));
  return (
    english.find((v) => /natural|neural|online/i.test(v.name)) ??
    english.find((v) => /samantha|daniel|karen|google (uk|us) english/i.test(v.name)) ??
    english.find((v) => v.default) ??
    english[0] ??
    voices[0]
  );
}

function defaultBrowserSpeak(text: string, opts: { voiceName?: string; rate: number }): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickBrowserVoice(window.speechSynthesis.getVoices(), opts.voiceName);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = opts.rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export class SpeechOutput {
  private chunker = new SentenceChunker();
  private player: QueuePlayer;
  private abort: AbortController | null = null;
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private useBrowser = false;
  private pending = 0;
  private speaking = false;
  private startedAt = 0;
  private firstAudioReported = false;
  settings: SpeechSettings = { rate: 1 };

  constructor(private readonly deps: SpeechOutputDeps) {
    this.player = deps.player ?? new QueuePlayer();
    this.player.onIdle = () => this.refreshSpeaking();
    this.player.onStart = () => this.refreshSpeaking();
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Starts a new reply; anything still playing is cut. */
  begin(): void {
    this.cancel();
    this.abort = new AbortController();
    this.startedAt = performance.now();
    this.firstAudioReported = false;
    this.useBrowser = false;
  }

  /** Feeds streamed text. */
  push(text: string): void {
    if (!this.abort) this.begin();
    for (const sentence of this.chunker.push(text)) this.enqueue(sentence);
  }

  /** Marks the end of the reply and speaks the remainder. */
  end(): void {
    for (const sentence of this.chunker.flush()) this.enqueue(sentence);
  }

  /** Speaks a complete text (previews, fixed messages). */
  say(text: string): void {
    this.begin();
    this.push(`${text} `);
    this.end();
  }

  /** Barge-in: stop now and drop everything queued. */
  cancel(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.chunker.reset();
    this.chain = Promise.resolve();
    this.pending = 0;
    this.player.stop();
    (this.deps.browserCancel ?? (() => typeof window !== 'undefined' && window.speechSynthesis?.cancel()))();
    this.refreshSpeaking();
  }

  private enqueue(sentence: string): void {
    if (!sentence || !this.abort) return;
    const generation = this.generation;
    const signal = this.abort.signal;
    this.pending++;
    this.refreshSpeaking();
    // Synthesis starts now (in parallel with playback of earlier sentences)…
    const audio = this.useBrowser
      ? Promise.resolve<SynthResult | null>(null)
      : this.deps.synthesize(sentence, signal).catch(() => null);
    // …but sentences are queued for playback strictly in order.
    this.chain = this.chain.then(async () => {
      if (generation !== this.generation) return;
      const result = await audio;
      if (generation !== this.generation) return;
      let played = false;
      if (result && !result.useBrowserSpeechFallback && result.audioBase64) {
        played = await this.player.enqueueEncoded(result.audioBase64, result.mimeType, this.settings.rate);
        if (played) this.deps.onEngine?.(result.engine ?? 'gemini');
      }
      if (generation !== this.generation) return;
      if (played) {
        this.reportFirstAudio();
      } else {
        // No server voice: the browser speaks this and the rest of the reply, so the voice does not switch mid-answer.
        this.useBrowser = true;
        this.deps.onEngine?.('browser');
        // Let already-queued server audio finish first.
        while (this.player.playing && generation === this.generation) await new Promise((r) => setTimeout(r, 60));
        if (generation !== this.generation) return;
        this.reportFirstAudio();
        await (this.deps.browserSpeak ?? defaultBrowserSpeak)(sentence, { voiceName: this.settings.browserVoiceName, rate: this.settings.rate });
      }
      if (generation === this.generation) {
        this.pending = Math.max(0, this.pending - 1);
        this.refreshSpeaking();
      }
    });
  }

  private reportFirstAudio(): void {
    if (this.firstAudioReported) return;
    this.firstAudioReported = true;
    this.deps.onFirstAudio?.(Math.round(performance.now() - this.startedAt));
  }

  private refreshSpeaking(): void {
    const now = this.pending > 0 || this.player.playing;
    if (now !== this.speaking) {
      this.speaking = now;
      this.deps.onSpeakingChange?.(now);
    }
  }
}

/** Which engine family speaks for a tier, before any fallback. */
export function primaryVoiceEngine(tier: CommTier): VoiceEngineId {
  return tier === 'autonomous' ? 'local' : 'gemini';
}
