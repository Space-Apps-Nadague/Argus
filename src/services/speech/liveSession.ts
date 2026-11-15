/**
 * Full-duplex session with Earth AI for the `live` comm tier
 * (specs/04-ai-backend.md §4.2). The browser talks straight to Gemini Live over a
 * WebSocket opened with a short-lived token from `/api/ai/live-session`:
 * 16 kHz microphone PCM and ~1 fps camera frames go up, 24 kHz speech, transcripts and
 * tool calls come down. Speech is played through the shared queue player, so barge-in
 * uses the same `stop()` as every other engine.
 */

import { bytesToBase64, base64ToBytes, float32ToPcm16, pcm16ToFloat32, pcmRateFromMime, QueuePlayer } from './audio';

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveSessionEvents {
  onOpen?: () => void;
  /** Socket closed or failed; the caller should fall back to the relay tier. */
  onClose?: (reason: string) => void;
  /** Running transcript of what the crew member is saying. */
  onInputTranscript?: (text: string, final: boolean) => void;
  /** Text of what ARGUS is saying, as it arrives. */
  onOutputText?: (delta: string) => void;
  /** The model finished its turn. `input` and `output` are the full transcripts. */
  onTurnComplete?: (turn: { input: string; output: string }) => void;
  /** The model was cut off by the crew member speaking. */
  onInterrupted?: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
  /** Resolve with the tool result to send back to the model. */
  onToolCall?: (call: LiveToolCall) => Promise<Record<string, unknown>>;
}

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export interface LiveSessionOptions {
  wsUrl: string;
  /** First message (`{ setup: … }`) from the server. */
  setup: unknown;
  player?: QueuePlayer;
  socketFactory?: (url: string) => SocketLike;
  playbackRate?: number;
}

interface ServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
    modelTurn?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> };
    interimInputTranscription?: { text?: string };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
  goAway?: unknown;
}

export class LiveSession {
  private ws: SocketLike | null = null;
  private ready = false;
  private closed = false;
  private input = '';
  private output = '';
  readonly player: QueuePlayer;

  constructor(
    private readonly options: LiveSessionOptions,
    private readonly events: LiveSessionEvents = {}
  ) {
    this.player = options.player ?? new QueuePlayer();
    this.player.onStart = () => this.events.onSpeakingChange?.(true);
    this.player.onIdle = () => this.events.onSpeakingChange?.(false);
  }

  get isOpen(): boolean {
    return this.ready && !this.closed;
  }

  /** Opens the socket and resolves once the session is ready, or rejects after `timeoutMs`. */
  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(reason));
        }
        this.shutdown(reason);
      };
      const timer = setTimeout(() => fail('Earth AI did not answer in time.'), timeoutMs);
      try {
        this.ws = (this.options.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike))(this.options.wsUrl);
      } catch (err) {
        clearTimeout(timer);
        return fail((err as Error).message);
      }
      this.ws.onopen = () => this.ws?.send(JSON.stringify(this.options.setup));
      this.ws.onerror = () => {
        clearTimeout(timer);
        fail('Connection to Earth AI failed.');
      };
      this.ws.onclose = (ev) => {
        clearTimeout(timer);
        fail(ev?.reason || 'Earth AI session ended.');
      };
      this.ws.onmessage = (ev) => {
        void this.parse(ev.data).then((msg) => {
          if (!msg) return;
          if (msg.setupComplete !== undefined && !this.ready) {
            this.ready = true;
            clearTimeout(timer);
            if (!settled) {
              settled = true;
              resolve();
            }
            this.events.onOpen?.();
          }
          void this.handle(msg);
        });
      };
    });
  }

  private async parse(data: unknown): Promise<ServerMessage | null> {
    try {
      const text = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : new TextDecoder().decode(data as ArrayBuffer);
      return JSON.parse(text) as ServerMessage;
    } catch {
      return null;
    }
  }

  /** Handles one server message. Public for tests. */
  async handle(msg: ServerMessage): Promise<void> {
    const content = msg.serverContent;
    if (content) {
      if (content.interrupted) {
        this.player.stop();
        this.events.onInterrupted?.();
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          this.player.enqueuePcm(pcm16ToFloat32(base64ToBytes(part.inlineData.data)), pcmRateFromMime(part.inlineData.mimeType), this.options.playbackRate ?? 1);
        }
      }
      const interim = content.interimInputTranscription?.text;
      if (interim) this.events.onInputTranscript?.(`${this.input} ${interim}`.trim(), false);
      const heard = content.inputTranscription?.text;
      if (heard) {
        this.input = `${this.input}${this.input && !/^\s/.test(heard) ? ' ' : ''}${heard}`.replace(/\s+/g, ' ').trim();
        this.events.onInputTranscript?.(this.input, false);
      }
      const said = content.outputTranscription?.text;
      if (said) {
        this.output += said;
        this.events.onOutputText?.(said);
      }
      if (content.turnComplete) {
        const turn = { input: this.input.trim(), output: this.output.trim() };
        if (turn.input) this.events.onInputTranscript?.(turn.input, true);
        this.input = '';
        this.output = '';
        if (turn.input || turn.output) this.events.onTurnComplete?.(turn);
      }
    }

    const calls = msg.toolCall?.functionCalls ?? [];
    if (calls.length) {
      const functionResponses = [];
      for (const call of calls) {
        const id = call.id ?? `call-${Date.now()}`;
        const name = call.name ?? '';
        let result: Record<string, unknown> = { ok: true };
        try {
          result = (await this.events.onToolCall?.({ id, name, args: call.args ?? {} })) ?? result;
        } catch (err) {
          result = { ok: false, error: (err as Error).message };
        }
        functionResponses.push({ id, name, response: { result } });
      }
      this.sendJson({ toolResponse: { functionResponses } });
    }
  }

  private sendJson(payload: unknown): void {
    if (this.ws && this.ws.readyState === 1 && !this.closed) this.ws.send(JSON.stringify(payload));
  }

  /** One 16 kHz mono frame from the microphone. */
  sendAudio(samples16k: Float32Array): void {
    if (!this.isOpen) return;
    this.sendJson({ realtimeInput: { audio: { data: bytesToBase64(float32ToPcm16(samples16k)), mimeType: 'audio/pcm;rate=16000' } } });
  }

  /** One JPEG camera frame (base64, no data-URL prefix). */
  sendFrame(jpegBase64: string): void {
    if (!this.isOpen) return;
    this.sendJson({ realtimeInput: { video: { data: jpegBase64, mimeType: 'image/jpeg' } } });
  }

  /** Typed message from the crew member. */
  sendText(text: string): void {
    if (!this.isOpen) return;
    this.input = text;
    this.sendJson({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }

  /** Context the model should know but not answer (camera summary, mental-state update). */
  sendContext(text: string): void {
    if (!this.isOpen) return;
    this.sendJson({ clientContent: { turns: [{ role: 'user', parts: [{ text: `[Context update, do not reply to this] ${text}` }] }], turnComplete: false } });
  }

  /** Stop ARGUS speaking right now (local barge-in; the server also detects it from the audio). */
  interrupt(): void {
    this.player.stop();
  }

  close(): void {
    this.shutdown('closed');
  }

  private shutdown(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.player.stop();
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
    if (reason !== 'closed') this.events.onClose?.(reason);
  }
}
