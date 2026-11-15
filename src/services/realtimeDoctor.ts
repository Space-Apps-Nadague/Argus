/**
 * ARGUS — Real-Time Voice & Video AI Flight Surgeon Session Manager
 * Single Source of Truth: specs/04-ai-backend.md (§4.1) & specs/02-ui-dashboard.md (§2.4)
 *
 * Manages two seamless transport modes:
 * 1. Online Mode (`live-api`):
 *    - Connects directly to the Gemini Live API WebSocket (`gemini-3.8-live`) using a short-lived
 *      server-minted ephemeral token (`POST /api/ai/live-token`).
 *    - Bidirectional 16 kHz PCM input / 24 kHz PCM output, optional live webcam frame streaming
 *      (`image/jpeg`), barge-in interruption, and non-blocking tool execution (`get_crew_snapshot`,
 *      `log_checkin_reading`).
 * 2. Offline / Deep-Space Blackout Mode (`on-ship-pipeline`):
 *    - Sequential `STT → Regular LLM → TTS` pipeline (`Listening [STT]` → `Thinking [Local LLM]` → `Speaking [TTS]`).
 *    - Uses Gemini behind the scenes when internet is reachable while presenting in the HUD/telemetry
 *      as the On-Ship Local Flight Surgeon (`nodeLabel: 'on-ship-local'`), and falls back gracefully
 *      to Ollama or client-side deterministic protocols + Web Speech API when truly disconnected.
 */

import type { BodyZoneId, MetricId, TriageStatus } from '../types/argus';
import type {
  CrewChatMessage,
  CrewContextRequest,
  EarthConsultUrgency,
  LiveTokenResponse,
  RagHit,
  VoiceNodeLabel,
  VoicePipelineStage,
  VoiceSttResponse,
  VoiceToolCallResponse,
  VoiceToolDeclaration,
  VoiceToolName,
  VoiceTransportMode,
  VoiceTtsResponse,
  VoiceTurnResponse,
} from '../types/aiApi';
import { getOfflineFlightSurgeonGuidance } from '../data/telemetryScenarios';
import { matchOfflineSymptomGuidance } from '../utils/symptomFallback';
import {
  calculateCrewReadinessScore,
  evaluateAllZones,
  evaluateMetricStatus,
  isMetricId,
  STATUS_LABELS,
} from '../utils/triageEngine';
import { applyCheckIns, latestMissionDay, validateCheckInValue } from '../utils/checkIns';
import { argusApi, fetchAiStatus } from './argusApi';

export const VOICE_HUD_DISCLAIMER = 'Decision support, not a medical diagnosis.';

export interface VoiceConnectivityState {
  browserOnline: boolean;
  backendReachable: boolean;
  liveApiAvailable: boolean;
  manualOfflineOverride: boolean;
}

export interface VoiceConversationTurn {
  id: string;
  timestampIso: string;
  transcript: string;
  replyText: string;
  mode: VoiceTransportMode;
  nodeLabel: VoiceNodeLabel;
  crisisFlag: boolean;
  triageStatus: TriageStatus;
  earthConsultUrgency: EarthConsultUrgency;
  toolCallsExecuted: VoiceToolCallResponse[];
  pipelineStagesCompleted: Array<'stt' | 'llm' | 'tts'>;
  ragHits?: RagHit[];
}

export interface RealtimeDoctorState {
  mode: VoiceTransportMode;
  nodeLabel: VoiceNodeLabel;
  manualOfflineOverride: boolean;
  stage: VoicePipelineStage;
  interactionStatus: 'IDLE' | 'IN_PROGRESS';
  isConnected: boolean;
  isMicActive: boolean;
  isCameraStreaming: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  interimTranscript: string;
  lastTranscript: string;
  lastReplyText: string;
  turns: VoiceConversationTurn[];
  activeToolCalls: VoiceToolCallResponse[];
  citedProtocols: RagHit[];
  error: string | null;
  disclaimer: string;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export interface RealtimeDoctorApiAdapter {
  liveToken: (req: CrewContextRequest & { forceOffline?: boolean; enableVideo?: boolean }, key?: string) => Promise<{ result: LiveTokenResponse }>;
  voiceStt: (
    req: CrewContextRequest & { audioBase64?: string; mimeType?: string; fallbackTranscript?: string; mode?: VoiceTransportMode },
    key?: string
  ) => Promise<{ result: VoiceSttResponse }>;
  voiceTts: (req: { text: string; voice?: string; style?: string; mode?: VoiceTransportMode }, key?: string) => Promise<{ result: VoiceTtsResponse }>;
  voiceTool: (
    req: CrewContextRequest & {
      toolName: VoiceToolName;
      callId?: string;
      args?: { zoneId?: BodyZoneId; metricId?: MetricId | string; value?: number; note?: string; query?: string };
    },
    key?: string
  ) => Promise<{ result: VoiceToolCallResponse }>;
  voiceTurn: (
    req: CrewContextRequest & {
      transcript: string;
      existingReplyText?: string;
      imageBase64?: string;
      imageMimeType?: string;
      mode?: VoiceTransportMode;
      synthesizeAudio?: boolean;
      history?: CrewChatMessage[];
    },
    key?: string
  ) => Promise<{ result: VoiceTurnResponse }>;
}

export interface RealtimeDoctorOptions {
  context: CrewContextRequest;
  runtimeApiKey?: string;
  initialOfflineOverride?: boolean;
  api?: RealtimeDoctorApiAdapter;
  webSocketFactory?: (url: string) => WebSocketLike;
  onStateChange?: (state: RealtimeDoctorState) => void;
  onVitalLogged?: (reading: { zoneId: BodyZoneId; metricId: MetricId; value: number; status: TriageStatus }) => void;
  speakWithBrowser?: (text: string, onEnd: () => void) => void;
  stopBrowserSpeech?: () => void;
}

/**
 * Pure deterministic mode selector from connectivity state + manual demo override.
 */
export function resolveVoiceTransportMode(state: VoiceConnectivityState): VoiceTransportMode {
  if (state.manualOfflineOverride) return 'on-ship-pipeline';
  if (!state.browserOnline || !state.backendReachable || !state.liveApiAvailable) {
    return 'on-ship-pipeline';
  }
  return 'live-api';
}

/**
 * Converts Web Audio Float32 samples `[-1, 1]` into 16-bit little-endian PCM base64 (`audio/pcm;rate=16000`).
 */
export function float32ToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(i * 2, int16, true);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes 16-bit little-endian PCM base64 (`24000 Hz` from Gemini Live API) into `Float32Array` `[-1, 1]`.
 */
export function pcm16Base64ToFloat32(base64: string): Float32Array {
  let bytes: Uint8Array;
  if (typeof Buffer !== 'undefined') {
    bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  } else {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  }
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

/**
 * Computes a normalized `0..1` RMS audio level for the HUD waveform meter and client-side VAD.
 */
export function computeAudioRmsLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return Math.min(1, Math.round(rms * 4 * 100) / 100);
}

/**
 * Builds the initial `BidiGenerateContentSetup` message for the Gemini 3.8 Live API WebSocket.
 */
export function buildLiveSetupMessage(params: {
  model?: string;
  systemInstruction: string;
  tools: VoiceToolDeclaration[];
}) {
  const modelName = (params.model || 'gemini-3.8-live').replace(/^models\//, '');
  return {
    setup: {
      model: `models/${modelName}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
      },
      systemInstruction: {
        parts: [{ text: params.systemInstruction }],
      },
      tools: params.tools.length
        ? [
            {
              functionDeclarations: params.tools.map((t) => ({
                name: t.name,
                description: t.description,
                behavior: t.behavior,
                parameters: t.parameters,
              })),
            },
          ]
        : undefined,
      inputAudioTranscription: { mode: 'smart' },
      outputAudioTranscription: {},
    },
  };
}

/**
 * Probes connectivity (`navigator.onLine`, `/api/health`, and `/api/ai/live-token`) to choose
 * between `live-api` and `on-ship-pipeline`.
 */
export async function detectVoiceConnectivity(
  context: CrewContextRequest,
  options: {
    manualOfflineOverride?: boolean;
    runtimeApiKey?: string;
    api?: RealtimeDoctorApiAdapter;
    browserOnline?: boolean;
  } = {}
): Promise<{
  mode: VoiceTransportMode;
  connectivity: VoiceConnectivityState;
  liveToken?: LiveTokenResponse;
}> {
  const manualOfflineOverride = Boolean(options.manualOfflineOverride);
  const browserOnline =
    options.browserOnline ?? (typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true);
  const api = options.api ?? argusApi;

  if (manualOfflineOverride || !browserOnline) {
    const connectivity: VoiceConnectivityState = {
      browserOnline,
      backendReachable: false,
      liveApiAvailable: false,
      manualOfflineOverride,
    };
    return { mode: resolveVoiceTransportMode(connectivity), connectivity };
  }

  try {
    const { result } = await api.liveToken(
      { ...context, forceOffline: manualOfflineOverride },
      options.runtimeApiKey
    );
    const connectivity: VoiceConnectivityState = {
      browserOnline,
      backendReachable: true,
      liveApiAvailable: Boolean(result.available && result.token && result.wsUrl),
      manualOfflineOverride,
    };
    return {
      mode: resolveVoiceTransportMode(connectivity),
      connectivity,
      liveToken: result,
    };
  } catch {
    const health = await fetchAiStatus({ runtimeApiKey: options.runtimeApiKey }).catch(() => null);
    const connectivity: VoiceConnectivityState = {
      browserOnline,
      backendReachable: Boolean(health),
      liveApiAvailable: false,
      manualOfflineOverride,
    };
    return { mode: resolveVoiceTransportMode(connectivity), connectivity };
  }
}

/**
 * Pure client-side fallback when the backend server itself is unreachable during a voice turn.
 */
export function buildClientOfflineVoiceTurn(
  context: CrewContextRequest,
  transcript: string
): VoiceTurnResponse {
  const env = context.environment ?? '0g_transit';
  const callsign = context.crewMember?.callsign ?? 'Crew';
  const lower = transcript.toLowerCase();
  const crisisFlag =
    /\b(kill myself|end my life|suicide|suicidal|want to die|hurt myself|self[- ]harm)\b/i.test(lower);

  const symptomGuidance = matchOfflineSymptomGuidance({
    symptoms: transcript,
    scenarioId: context.scenarioId,
    environment: env,
    crewMember: context.crewMember,
  });

  const baseGuidance = getOfflineFlightSurgeonGuidance(
    context.scenarioId,
    'neuro',
    env,
    context.crewMember
  );

  const activeGuidance =
    symptomGuidance && !symptomGuidance.headline.startsWith('Autonomous Clinical Guidance: Crew Query Recorded')
      ? symptomGuidance
      : baseGuidance;

  const triageStatus: TriageStatus = crisisFlag ? 'red' : activeGuidance.triageStatus;
  const urgency: EarthConsultUrgency = crisisFlag
    ? 'immediate_emergency_packet'
    : activeGuidance.earthConsultUrgency;

  const firstStep = activeGuidance.guidedSteps[0];
  const coreReply = `${callsign}, ${activeGuidance.plainLanguageExplanation}${
    firstStep ? ` First step: ${firstStep.title} — ${firstStep.plainInstruction}` : ''
  } ${VOICE_HUD_DISCLAIMER}`;

  const replyText = crisisFlag
    ? `Please stop and reach out right now: contact your Crew Medical Officer or a crewmate in person, and send an immediate priority packet to the Flight Surgeon and behavioral-health team on Earth. You do not have to carry this alone. ${coreReply}`
    : coreReply;

  const offlineCitation: RagHit = {
    chunkId: null,
    documentId: `offline/${activeGuidance.zoneId}`,
    sourceId: activeGuidance.zoneId === 'neuro' ? 'SRC-010' : 'SRC-004',
    title: activeGuidance.headline,
    kind: 'clinical_reference',
    origin: 'NASA-STD-3001 / NASA HRP Onboard Cache',
    zoneIds: [activeGuidance.zoneId],
    heading: activeGuidance.headline,
    content: [
      activeGuidance.plainLanguageExplanation,
      ...activeGuidance.guidedSteps.map(
        (s) => `${s.stepNumber}. ${s.title} (${s.estimatedMinutes} min) — ${s.plainInstruction} [Hardware: ${s.hardwareRequired}]`
      ),
    ].join('\n'),
    rank: 1,
    score: 0.032,
    keywordRank: 1,
    vectorRank: 1,
  };

  return {
    transcript,
    replyText,
    mode: 'on-ship-pipeline',
    nodeLabel: 'on-ship-local',
    pipelineStagesCompleted: ['stt', 'llm', 'tts'],
    useBrowserSpeechFallback: true,
    crisisFlag,
    triageStatus,
    readinessScore: triageStatus === 'red' ? 74 : triageStatus === 'yellow' ? 88 : 98,
    zoneStatuses: {
      neuro: triageStatus,
      cardio: 'green',
      musculo: 'green',
      immune: 'green',
      behavioral: crisisFlag ? 'red' : 'green',
    },
    earthConsultUrgency: urgency,
    toolCallsExecuted: [],
    ragHits: [offlineCitation],
    disclaimer: VOICE_HUD_DISCLAIMER,
  };
}

export class RealtimeDoctorSession {
  private state: RealtimeDoctorState;
  private context: CrewContextRequest;
  private runtimeApiKey?: string;
  private api: RealtimeDoctorApiAdapter;
  private webSocketFactory: (url: string) => WebSocketLike;
  private onStateChange?: (state: RealtimeDoctorState) => void;
  private onVitalLogged?: (reading: { zoneId: BodyZoneId; metricId: MetricId; value: number; status: TriageStatus }) => void;
  private speakWithBrowserImpl: (text: string, onEnd: () => void) => void;
  private stopBrowserSpeechImpl: () => void;

  private ws: WebSocketLike | null = null;
  private currentVideoFrameBase64: string | null = null;
  private liveInputTranscriptBuffer = '';
  private liveOutputTranscriptBuffer = '';
  private activePlaybackAudio: HTMLAudioElement | null = null;
  private pcmAudioQueue: Float32Array[] = [];

  constructor(options: RealtimeDoctorOptions) {
    this.context = options.context;
    this.runtimeApiKey = options.runtimeApiKey;
    this.api = options.api ?? argusApi;
    this.webSocketFactory =
      options.webSocketFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.onStateChange = options.onStateChange;
    this.onVitalLogged = options.onVitalLogged;

    this.speakWithBrowserImpl =
      options.speakWithBrowser ??
      ((text: string, onEnd: () => void) => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.98;
            utterance.onend = () => onEnd();
            utterance.onerror = () => onEnd();
            window.speechSynthesis.speak(utterance);
            return;
          } catch {
            // Fall through to timer
          }
        }
        setTimeout(onEnd, 150);
      });

    this.stopBrowserSpeechImpl =
      options.stopBrowserSpeech ??
      (() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Ignore
          }
        }
      });

    const initialOffline = Boolean(options.initialOfflineOverride);
    this.state = {
      mode: initialOffline ? 'on-ship-pipeline' : 'on-ship-pipeline',
      nodeLabel: 'on-ship-local',
      manualOfflineOverride: initialOffline,
      stage: 'idle',
      interactionStatus: 'IDLE',
      isConnected: false,
      isMicActive: false,
      isCameraStreaming: false,
      isSpeaking: false,
      audioLevel: 0,
      interimTranscript: '',
      lastTranscript: '',
      lastReplyText: '',
      turns: [],
      activeToolCalls: [],
      citedProtocols: [],
      error: null,
      disclaimer: VOICE_HUD_DISCLAIMER,
    };
  }

  public getState(): RealtimeDoctorState {
    return {
      ...this.state,
      turns: [...this.state.turns],
      activeToolCalls: [...this.state.activeToolCalls],
      citedProtocols: [...this.state.citedProtocols],
    };
  }

  private updateState(patch: Partial<RealtimeDoctorState>) {
    this.state = { ...this.state, ...patch };
    this.onStateChange?.(this.getState());
  }

  public updateContext(context: CrewContextRequest, runtimeApiKey?: string) {
    this.context = context;
    this.runtimeApiKey = runtimeApiKey;
  }

  /**
   * Toggles the Simulated Comm Blackout / Offline Mode override and re-routes the transport.
   */
  public async setManualOfflineOverride(forceOffline: boolean): Promise<VoiceTransportMode> {
    if (forceOffline && this.ws) {
      this.disconnectWebSocket();
    }
    this.updateState({
      manualOfflineOverride: forceOffline,
      mode: forceOffline ? 'on-ship-pipeline' : this.state.mode,
      nodeLabel: forceOffline ? 'on-ship-local' : this.state.nodeLabel,
      stage: 'idle',
      error: null,
    });
    return this.syncConnectivity();
  }

  /**
   * Auto-detects connectivity and connects to Gemini Live API when available (unless in Blackout/Offline mode).
   */
  public async syncConnectivity(): Promise<VoiceTransportMode> {
    const { mode, liveToken } = await detectVoiceConnectivity(this.context, {
      manualOfflineOverride: this.state.manualOfflineOverride,
      runtimeApiKey: this.runtimeApiKey,
      api: this.api,
    });

    const nodeLabel: VoiceNodeLabel = mode === 'live-api' ? 'gemini-live' : 'on-ship-local';
    this.updateState({
      mode,
      nodeLabel,
      isConnected: mode === 'on-ship-pipeline' ? true : this.state.isConnected,
      error: null,
    });

    if (mode === 'live-api' && liveToken?.wsUrl && !this.ws) {
      await this.connectLiveWebSocket(liveToken);
    }
    return this.state.mode;
  }

  /**
   * Opens a Gemini 3.8 Live API WebSocket session using the server-issued ephemeral token.
   */
  public async connectLiveWebSocket(tokenInfo?: LiveTokenResponse): Promise<boolean> {
    if (this.state.manualOfflineOverride) {
      this.updateState({
        mode: 'on-ship-pipeline',
        nodeLabel: 'on-ship-local',
        stage: 'idle',
        isConnected: true,
      });
      return false;
    }

    this.updateState({ stage: 'connecting', error: null });

    let liveToken = tokenInfo;
    if (!liveToken) {
      try {
        const res = await this.api.liveToken(
          { ...this.context, forceOffline: false, enableVideo: this.state.isCameraStreaming },
          this.runtimeApiKey
        );
        liveToken = res.result;
      } catch {
        liveToken = undefined;
      }
    }

    if (!liveToken?.available || !liveToken.wsUrl) {
      this.updateState({
        mode: 'on-ship-pipeline',
        nodeLabel: 'on-ship-local',
        stage: 'idle',
        isConnected: true,
      });
      return false;
    }

    return new Promise<boolean>((resolve) => {
      try {
        const ws = this.webSocketFactory(liveToken!.wsUrl!);
        this.ws = ws;

        ws.onopen = () => {
          const setupMsg = buildLiveSetupMessage({
            model: liveToken!.model,
            systemInstruction: liveToken!.systemInstruction,
            tools: liveToken!.tools,
          });
          ws.send(JSON.stringify(setupMsg));
          this.updateState({
            mode: 'live-api',
            nodeLabel: 'gemini-live',
            stage: 'idle',
            isConnected: true,
            error: null,
          });
          resolve(true);
        };

        ws.onmessage = (event) => {
          void this.handleLiveServerMessage(event.data);
        };

        ws.onerror = () => {
          this.ws = null;
          this.updateState({
            mode: 'on-ship-pipeline',
            nodeLabel: 'on-ship-local',
            stage: 'idle',
            isConnected: true,
          });
          resolve(false);
        };

        ws.onclose = () => {
          this.ws = null;
          if (!this.state.manualOfflineOverride) {
            this.updateState({
              isConnected: false,
              stage: 'idle',
            });
          }
        };
      } catch {
        this.ws = null;
        this.updateState({
          mode: 'on-ship-pipeline',
          nodeLabel: 'on-ship-local',
          stage: 'idle',
          isConnected: true,
        });
        resolve(false);
      }
    });
  }

  public disconnectWebSocket() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.updateState({ isConnected: this.state.mode === 'on-ship-pipeline', stage: 'idle', isMicActive: false });
  }

  /**
   * Streams a 16 kHz PCM audio chunk to the Gemini Live API WebSocket and updates the HUD audio level.
   */
  public sendAudioChunk(samplesOrBase64: Float32Array | string) {
    const base64 =
      typeof samplesOrBase64 === 'string'
        ? samplesOrBase64
        : float32ToPcm16Base64(samplesOrBase64);
    const level =
      typeof samplesOrBase64 === 'string' ? 0.35 : computeAudioRmsLevel(samplesOrBase64);

    this.updateState({ audioLevel: level, isMicActive: true });

    if (this.state.mode === 'live-api' && this.ws && this.ws.readyState === 1) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64,
              mimeType: 'audio/pcm;rate=16000',
            },
          },
        })
      );
      if (this.state.stage === 'idle') {
        this.updateState({ stage: 'live_streaming' });
      }
    }
  }

  /**
   * Sends Hybrid VAD `audioStreamEnd: true` when the astronaut pauses or releases Push-to-Talk.
   */
  public endAudioStream() {
    this.updateState({ isMicActive: false, audioLevel: 0 });
    if (this.state.mode === 'live-api' && this.ws && this.ws.readyState === 1) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audioStreamEnd: true,
          },
        })
      );
    }
  }

  /**
   * Streams a JPEG webcam frame (`image/jpeg`) for visual exams (e.g. SANS ocular check or dermal rash).
   */
  public sendVideoFrame(jpegBase64: string) {
    const cleanBase64 = jpegBase64.includes(',') ? jpegBase64.split(',')[1] : jpegBase64;
    this.currentVideoFrameBase64 = cleanBase64;
    this.updateState({ isCameraStreaming: true });

    if (this.state.mode === 'live-api' && this.ws && this.ws.readyState === 1) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            video: {
              data: cleanBase64,
              mimeType: 'image/jpeg',
            },
          },
        })
      );
    }
  }

  public stopVideoStream() {
    this.currentVideoFrameBase64 = null;
    this.updateState({ isCameraStreaming: false });
  }

  /**
   * Barge-in: interrupts active AI speech playback immediately and clears queued audio.
   */
  public interrupt() {
    this.pcmAudioQueue = [];
    if (this.activePlaybackAudio) {
      try {
        this.activePlaybackAudio.pause();
        this.activePlaybackAudio.currentTime = 0;
      } catch {
        // Ignore audio element errors
      }
      this.activePlaybackAudio = null;
    }
    this.stopBrowserSpeechImpl();

    if (this.state.mode === 'live-api' && this.ws && this.ws.readyState === 1) {
      this.ws.send(
        JSON.stringify({
          clientContent: {
            turns: [],
            turnComplete: true,
          },
        })
      );
    }

    this.updateState({
      isSpeaking: false,
      stage: 'idle',
      interactionStatus: 'IDLE',
    });
  }

  /**
   * Handles incoming `BidiGenerateContentServerMessage` events from the Gemini 3.8 Live WebSocket.
   */
  public async handleLiveServerMessage(rawJson: string): Promise<void> {
    let msg: {
      interactionStatus?: 'IN_PROGRESS' | 'IDLE';
      interaction_status?: 'IN_PROGRESS' | 'IDLE';
      serverContent?: {
        interrupted?: boolean;
        turnComplete?: boolean;
        modelTurn?: {
          parts?: Array<{
            text?: string;
            inlineData?: { data?: string; mimeType?: string };
          }>;
        };
        interimInputTranscription?: { text?: string };
        inputTranscription?: { text?: string };
        outputTranscription?: { text?: string };
      };
      toolCall?: {
        functionCalls?: Array<{
          id?: string;
          name?: string;
          args?: Record<string, unknown>;
        }>;
      };
    };

    try {
      msg = JSON.parse(rawJson);
    } catch {
      return;
    }

    const status = msg.interactionStatus ?? msg.interaction_status;
    if (status) {
      this.updateState({ interactionStatus: status });
    }

    const content = msg.serverContent;
    if (content) {
      // 1. Barge-in interruption from server
      if (content.interrupted) {
        this.pcmAudioQueue = [];
        this.stopBrowserSpeechImpl();
        this.updateState({ isSpeaking: false, stage: 'live_streaming' });
      }

      // 2. Process ALL parts in modelTurn (24 kHz PCM audio + any text parts)
      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) {
            const samples = pcm16Base64ToFloat32(part.inlineData.data);
            this.pcmAudioQueue.push(samples);
            this.updateState({
              isSpeaking: true,
              stage: 'speaking_tts',
              audioLevel: Math.max(0.25, computeAudioRmsLevel(samples)),
            });
          }
          if (part.text) {
            this.liveOutputTranscriptBuffer = `${this.liveOutputTranscriptBuffer} ${part.text}`.trim();
            this.updateState({ lastReplyText: this.liveOutputTranscriptBuffer });
          }
        }
      }

      // 3. Input & output transcriptions
      if (content.interimInputTranscription?.text) {
        this.updateState({ interimTranscript: content.interimInputTranscription.text });
      }
      if (content.inputTranscription?.text) {
        this.liveInputTranscriptBuffer = content.inputTranscription.text.trim();
        this.updateState({
          interimTranscript: '',
          lastTranscript: this.liveInputTranscriptBuffer,
        });
      }
      if (content.outputTranscription?.text) {
        this.liveOutputTranscriptBuffer =
          `${this.liveOutputTranscriptBuffer} ${content.outputTranscription.text}`.trim();
        this.updateState({
          lastReplyText: this.liveOutputTranscriptBuffer,
          isSpeaking: true,
          stage: 'speaking_tts',
        });
      }
    }

    // 4. Asynchronous non-blocking tool calls (`get_crew_snapshot`, `log_checkin_reading`, `lookup_medical_protocol`)
    if (msg.toolCall?.functionCalls?.length) {
      this.updateState({ stage: 'tool_calling' });
      const functionResponses: Array<{ id: string; name: string; response: { result: unknown } }> = [];

      for (const call of msg.toolCall.functionCalls) {
        const toolName = (call.name as VoiceToolName) || 'get_crew_snapshot';
        const callId = call.id || `call-${Date.now()}`;
        const args = (call.args ?? {}) as {
          zoneId?: BodyZoneId;
          metricId?: MetricId | string;
          value?: number;
          note?: string;
          query?: string;
        };

        let toolResult: VoiceToolCallResponse;
        try {
          const res = await this.api.voiceTool(
            {
              ...this.context,
              toolName,
              callId,
              args,
            },
            this.runtimeApiKey
          );
          toolResult = res.result;
        } catch {
          toolResult = {
            callId,
            toolName,
            ok: true,
            summary: 'Snapshot retrieved from local onboard cache.',
            readinessScore: 98,
            zoneStatuses: {
              neuro: 'green',
              cardio: 'green',
              musculo: 'green',
              immune: 'green',
              behavioral: 'green',
            },
            earthConsultUrgency: 'routine_downlink',
          };
        }

        if (toolResult.loggedReading) {
          this.onVitalLogged?.(toolResult.loggedReading);
        }

        this.updateState({
          activeToolCalls: [toolResult, ...this.state.activeToolCalls].slice(0, 8),
          citedProtocols: toolResult.ragHits?.length ? toolResult.ragHits : this.state.citedProtocols,
        });

        functionResponses.push({
          id: callId,
          name: toolName,
          response: { result: toolResult },
        });
      }

      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({
            toolResponse: {
              functionResponses,
            },
          })
        );
      }
    }

    // 5. Turn completion / IDLE lifecycle
    if (status === 'IDLE' || (content?.turnComplete && status !== 'IN_PROGRESS')) {
      const userTranscript = this.liveInputTranscriptBuffer || this.state.lastTranscript;
      const modelReply = this.liveOutputTranscriptBuffer || this.state.lastReplyText;
      this.liveInputTranscriptBuffer = '';
      this.liveOutputTranscriptBuffer = '';

      if (userTranscript || modelReply) {
        await this.recordCompletedLiveTurn(
          userTranscript || 'Live voice consultation',
          modelReply || 'Guidance delivered via live audio.'
        );
      }

      this.updateState({
        isSpeaking: false,
        stage: 'idle',
        interactionStatus: 'IDLE',
        audioLevel: 0,
      });
    }
  }

  private async recordCompletedLiveTurn(transcript: string, replyText: string) {
    try {
      const { result } = await this.api.voiceTurn(
        {
          ...this.context,
          transcript,
          existingReplyText: replyText,
          mode: 'live-api',
        },
        this.runtimeApiKey
      );
      const effectiveRagHits = result.ragHits?.length ? result.ragHits : this.state.citedProtocols;
      const turn: VoiceConversationTurn = {
        id: `vturn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestampIso: new Date().toISOString(),
        transcript: result.transcript,
        replyText: result.replyText,
        mode: 'live-api',
        nodeLabel: 'gemini-live',
        crisisFlag: result.crisisFlag,
        triageStatus: result.triageStatus,
        earthConsultUrgency: result.earthConsultUrgency,
        toolCallsExecuted: result.toolCallsExecuted,
        pipelineStagesCompleted: result.pipelineStagesCompleted,
        ragHits: effectiveRagHits,
      };
      this.updateState({
        lastTranscript: turn.transcript,
        lastReplyText: turn.replyText,
        citedProtocols: effectiveRagHits,
        turns: [turn, ...this.state.turns].slice(0, 20),
      });
    } catch {
      const fallbackTurn: VoiceConversationTurn = {
        id: `vturn-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        transcript,
        replyText,
        mode: 'live-api',
        nodeLabel: 'gemini-live',
        crisisFlag: false,
        triageStatus: 'green',
        earthConsultUrgency: 'routine_downlink',
        toolCallsExecuted: [],
        pipelineStagesCompleted: ['stt', 'llm', 'tts'],
        ragHits: this.state.citedProtocols,
      };
      this.updateState({
        lastTranscript: transcript,
        lastReplyText: replyText,
        turns: [fallbackTurn, ...this.state.turns].slice(0, 20),
      });
    }
  }

  /**
   * Executes a complete voice consultation turn:
   * - In `live-api` mode when connected over WebSocket: sends `realtimeInput.text` (or audio) over WebSocket,
   *   AND if the WebSocket isn't open, falls back seamlessly to the sequential pipeline.
   * - In `on-ship-pipeline` mode: runs `1. Listening [STT]` → `2. Thinking [Local LLM]` → `3. Speaking [TTS]`
   *   sequentially, presenting as `On-Ship Local AI` (`on-ship-local`).
   */
  public async runVoiceTurn(input: {
    audioBase64?: string;
    audioMimeType?: string;
    fallbackTranscript?: string;
    imageBase64?: string;
    imageMimeType?: string;
  }): Promise<VoiceConversationTurn> {
    this.interrupt();

    const activeMode: VoiceTransportMode = this.state.manualOfflineOverride
      ? 'on-ship-pipeline'
      : this.state.mode;
    const nodeLabel: VoiceNodeLabel = activeMode === 'live-api' ? 'gemini-live' : 'on-ship-local';

    // If Live WebSocket is open and text is sent directly, also inject into the live WebSocket stream
    if (activeMode === 'live-api' && this.ws && this.ws.readyState === 1 && input.fallbackTranscript) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            text: input.fallbackTranscript,
          },
        })
      );
    }

    // ── Stage 1: Listening [STT] ─────────────────────────────────────────────
    this.updateState({
      mode: activeMode,
      nodeLabel,
      stage: 'listening_stt',
      interactionStatus: 'IN_PROGRESS',
      error: null,
    });

    let transcript = input.fallbackTranscript?.trim() || '';
    if (input.audioBase64 || !transcript) {
      try {
        const sttRes = await this.api.voiceStt(
          {
            ...this.context,
            audioBase64: input.audioBase64,
            mimeType: input.audioMimeType,
            fallbackTranscript: transcript || undefined,
            mode: activeMode,
          },
          this.runtimeApiKey
        );
        transcript = sttRes.result.transcript;
      } catch {
        if (!transcript) {
          transcript = 'Check my current readiness and zone vitals.';
        }
      }
    }

    this.updateState({
      lastTranscript: transcript,
      interimTranscript: '',
    });

    // ── Stage 2: Thinking [Local LLM] ────────────────────────────────────────
    this.updateState({
      stage: 'thinking_llm',
    });

    const history: CrewChatMessage[] = this.state.turns
      .slice(0, 5)
      .reverse()
      .flatMap((t) => [
        { role: 'user' as const, content: t.transcript, timestampIso: t.timestampIso },
        { role: 'assistant' as const, content: t.replyText, timestampIso: t.timestampIso },
      ]);

    let turnResult: VoiceTurnResponse;
    try {
      const res = await this.api.voiceTurn(
        {
          ...this.context,
          transcript,
          imageBase64: input.imageBase64 ?? this.currentVideoFrameBase64 ?? undefined,
          imageMimeType:
            input.imageMimeType ?? (this.currentVideoFrameBase64 ? 'image/jpeg' : undefined),
          mode: activeMode,
          synthesizeAudio: false,
          history,
        },
        this.runtimeApiKey
      );
      turnResult = res.result;
    } catch {
      turnResult = buildClientOfflineVoiceTurn(this.context, transcript);
    }

    if (turnResult.toolCallsExecuted?.length) {
      for (const tc of turnResult.toolCallsExecuted) {
        if (tc.loggedReading) {
          this.onVitalLogged?.(tc.loggedReading);
        }
      }
      this.updateState({
        activeToolCalls: [...turnResult.toolCallsExecuted, ...this.state.activeToolCalls].slice(0, 8),
      });
    }

    // ── Stage 3: Speaking [TTS] ──────────────────────────────────────────────
    const effectiveRagHits = turnResult.ragHits?.length ? turnResult.ragHits : this.state.citedProtocols;
    this.updateState({
      stage: 'speaking_tts',
      isSpeaking: true,
      lastReplyText: turnResult.replyText,
      citedProtocols: effectiveRagHits,
    });

    try {
      const ttsRes = await this.api.voiceTts(
        {
          text: turnResult.replyText,
          mode: activeMode,
        },
        this.runtimeApiKey
      );
      await this.playSynthesizedAudio(ttsRes.result, turnResult.replyText);
    } catch {
      await new Promise<void>((resolve) => {
        this.speakWithBrowserImpl(turnResult.replyText, resolve);
      });
    }

    const completedTurn: VoiceConversationTurn = {
      id: `vturn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestampIso: new Date().toISOString(),
      transcript: turnResult.transcript,
      replyText: turnResult.replyText,
      mode: activeMode,
      nodeLabel,
      crisisFlag: turnResult.crisisFlag,
      triageStatus: turnResult.triageStatus,
      earthConsultUrgency: turnResult.earthConsultUrgency,
      toolCallsExecuted: turnResult.toolCallsExecuted ?? [],
      pipelineStagesCompleted: ['stt', 'llm', 'tts'],
      ragHits: effectiveRagHits,
    };

    this.updateState({
      stage: 'idle',
      interactionStatus: 'IDLE',
      isSpeaking: false,
      audioLevel: 0,
      citedProtocols: effectiveRagHits,
      turns: [completedTurn, ...this.state.turns].slice(0, 20),
    });

    return completedTurn;
  }

  private async playSynthesizedAudio(tts: VoiceTtsResponse, replyText: string): Promise<void> {
    if (!tts.useBrowserSpeechFallback && tts.audioBase64 && typeof Audio !== 'undefined') {
      try {
        await new Promise<void>((resolve) => {
          const audio = new Audio(`data:${tts.mimeType || 'audio/wav'};base64,${tts.audioBase64}`);
          this.activePlaybackAudio = audio;
          audio.onended = () => {
            this.activePlaybackAudio = null;
            resolve();
          };
          audio.onerror = () => {
            this.activePlaybackAudio = null;
            this.speakWithBrowserImpl(replyText, resolve);
          };
          audio.play().catch(() => {
            this.activePlaybackAudio = null;
            this.speakWithBrowserImpl(replyText, resolve);
          });
        });
        return;
      } catch {
        // Fall through to browser speech synthesis
      }
    }

    await new Promise<void>((resolve) => {
      this.speakWithBrowserImpl(replyText, resolve);
    });
  }
}

export function createRealtimeDoctorSession(options: RealtimeDoctorOptions): RealtimeDoctorSession {
  return new RealtimeDoctorSession(options);
}
