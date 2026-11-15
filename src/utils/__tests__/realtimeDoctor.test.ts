/**
 * Unit tests for `src/services/realtimeDoctor.ts` (specs/04-ai-backend.md §4.1 & specs/02-ui-dashboard.md §2.4):
 * - Mode selection (`resolveVoiceTransportMode`, `detectVoiceConnectivity`) & Simulated Comm Blackout override.
 * - PCM 16 kHz / 24 kHz audio conversion (`float32ToPcm16Base64`, `pcm16Base64ToFloat32`, `computeAudioRmsLevel`).
 * - Gemini 3.8 Live API WebSocket session (`connectLiveWebSocket`, `sendAudioChunk`, `sendVideoFrame`, `interrupt`, async `toolCall` -> `toolResponse`).
 * - Sequential Offline / Deep-Space Blackout pipeline (`listening_stt` -> `thinking_llm` -> `speaking_tts` -> `idle`).
 */

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CREW_ROSTER } from '../../data/telemetryScenarios';
import type {
  LiveTokenResponse,
  VoicePipelineStage,
  VoiceToolCallResponse,
} from '../../types/aiApi';
import {
  buildClientOfflineVoiceTurn,
  buildLiveSetupMessage,
  computeAudioRmsLevel,
  createRealtimeDoctorSession,
  detectVoiceConnectivity,
  float32ToPcm16Base64,
  pcm16Base64ToFloat32,
  type RealtimeDoctorApiAdapter,
  resolveVoiceTransportMode,
  type WebSocketLike,
} from '../../services/realtimeDoctor';

const crewMember = DEFAULT_CREW_ROSTER[0];
const baseContext = {
  scenarioId: 'sans_alert' as const,
  environment: '0g_transit' as const,
  crewMember,
};

function createMockApi(overrides: Partial<RealtimeDoctorApiAdapter> = {}): RealtimeDoctorApiAdapter {
  const defaultLiveToken: LiveTokenResponse = {
    available: true,
    mode: 'live-api',
    nodeLabel: 'gemini-live',
    model: 'gemini-3.8-live',
    token: 'auth_tokens/test-ephemeral-123',
    wsUrl:
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Ftest-ephemeral-123',
    systemInstruction: 'You are ARGUS Flight Surgeon.',
    tools: [
      {
        name: 'get_crew_snapshot',
        description: 'Return crew snapshot.',
        behavior: 'NON_BLOCKING',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'log_checkin_reading',
        description: 'Log check-in vital reading.',
        behavior: 'NON_BLOCKING',
        parameters: { type: 'OBJECT', properties: {} },
      },
    ],
  };

  return {
    liveToken: vi.fn().mockResolvedValue({ result: defaultLiveToken }),
    voiceStt: vi.fn().mockImplementation(async (req) => ({
      result: {
        transcript: req.fallbackTranscript || 'My vision is blurry and I have a headache.',
        mode: req.mode ?? 'on-ship-pipeline',
        nodeLabel: req.mode === 'live-api' ? 'gemini-live' : 'on-ship-local',
        crisisFlag: false,
      },
    })),
    voiceTts: vi.fn().mockImplementation(async (req) => ({
      result: {
        audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        mode: req.mode ?? 'on-ship-pipeline',
        nodeLabel: req.mode === 'live-api' ? 'gemini-live' : 'on-ship-local',
        useBrowserSpeechFallback: true,
      },
    })),
    voiceTool: vi.fn().mockImplementation(async (req) => ({
      result: {
        callId: req.callId || 'call-1',
        toolName: req.toolName,
        ok: true,
        summary: 'Logged resting_hr = 68',
        readinessScore: 95,
        zoneStatuses: {
          neuro: 'red',
          cardio: 'green',
          musculo: 'green',
          immune: 'green',
          behavioral: 'green',
        },
        earthConsultUrgency: 'immediate_emergency_packet',
        loggedReading:
          req.toolName === 'log_checkin_reading'
            ? {
                zoneId: req.args?.zoneId || 'cardio',
                metricId: 'resting_hr',
                value: req.args?.value ?? 68,
                status: 'green',
              }
            : undefined,
      } satisfies VoiceToolCallResponse,
    })),
    voiceTurn: vi.fn().mockImplementation(async (req) => ({
      result: {
        transcript: req.transcript,
        replyText: `Valkyrie, Neuro status is Alert. Check optic nerve sheath diameter. Decision support, not a medical diagnosis.`,
        mode: req.mode ?? 'on-ship-pipeline',
        nodeLabel: req.mode === 'live-api' ? 'gemini-live' : 'on-ship-local',
        pipelineStagesCompleted: ['stt', 'llm', 'tts'],
        useBrowserSpeechFallback: true,
        crisisFlag: false,
        triageStatus: 'red',
        readinessScore: 76,
        zoneStatuses: {
          neuro: 'red',
          cardio: 'green',
          musculo: 'green',
          immune: 'green',
          behavioral: 'green',
        },
        earthConsultUrgency: 'immediate_emergency_packet',
        toolCallsExecuted: [],
        disclaimer: 'Decision support, not a medical diagnosis.',
      },
    })),
    ...overrides,
  };
}

class MockWebSocket implements WebSocketLike {
  public readyState = 1;
  public sentMessages: unknown[] = [];
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;
  public onclose: ((ev: unknown) => void) | null = null;

  public send(data: string) {
    this.sentMessages.push(JSON.parse(data));
  }

  public close() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

describe('realtimeDoctor utilities & session manager', () => {
  it('resolveVoiceTransportMode selects live-api only when online, reachable, and not overridden', () => {
    expect(
      resolveVoiceTransportMode({
        browserOnline: true,
        backendReachable: true,
        liveApiAvailable: true,
        manualOfflineOverride: false,
      })
    ).toBe('live-api');

    expect(
      resolveVoiceTransportMode({
        browserOnline: true,
        backendReachable: true,
        liveApiAvailable: true,
        manualOfflineOverride: true,
      })
    ).toBe('on-ship-pipeline');

    expect(
      resolveVoiceTransportMode({
        browserOnline: false,
        backendReachable: true,
        liveApiAvailable: true,
        manualOfflineOverride: false,
      })
    ).toBe('on-ship-pipeline');
  });

  it('encodes Float32 PCM samples to 16-bit PCM base64 and decodes back accurately', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const encoded = float32ToPcm16Base64(input);
    const decoded = pcm16Base64ToFloat32(encoded);
    expect(decoded.length).toBe(input.length);
    expect(decoded[0]).toBeCloseTo(0, 3);
    expect(decoded[1]).toBeCloseTo(0.5, 2);
    expect(decoded[2]).toBeCloseTo(-0.5, 2);
    expect(decoded[3]).toBeCloseTo(1, 2);
    expect(decoded[4]).toBeCloseTo(-1, 2);
    expect(computeAudioRmsLevel(input)).toBeGreaterThan(0.5);
  });

  it('detectVoiceConnectivity probes /api/ai/live-token and respects manualOfflineOverride', async () => {
    const api = createMockApi();
    const online = await detectVoiceConnectivity(baseContext, { api, browserOnline: true });
    expect(online.mode).toBe('live-api');
    expect(online.liveToken?.token).toBe('auth_tokens/test-ephemeral-123');

    const blackout = await detectVoiceConnectivity(baseContext, {
      api,
      browserOnline: true,
      manualOfflineOverride: true,
    });
    expect(blackout.mode).toBe('on-ship-pipeline');
  });

  it('buildLiveSetupMessage formats Gemini 3.8 Live setup with NON_BLOCKING tools', () => {
    const setup = buildLiveSetupMessage({
      model: 'gemini-3.8-live',
      systemInstruction: 'ARGUS system prompt',
      tools: [
        {
          name: 'get_crew_snapshot',
          description: 'Fetch crew snapshot',
          behavior: 'NON_BLOCKING',
          parameters: { type: 'OBJECT', properties: {} },
        },
      ],
    });
    expect(setup.setup.model).toBe('models/gemini-3.8-live');
    expect(setup.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.setup.tools?.[0].functionDeclarations[0].behavior).toBe('NON_BLOCKING');
  });

  it('connects to Gemini Live WebSocket, streams audio/video, handles barge-in and async tool calls', async () => {
    let wsInstance: MockWebSocket | null = null;
    const loggedVitals: Array<{ metricId: string; value: number }> = [];
    const api = createMockApi();

    const session = createRealtimeDoctorSession({
      context: baseContext,
      api,
      webSocketFactory: () => {
        wsInstance = new MockWebSocket();
        queueMicrotask(() => wsInstance?.onopen?.({}));
        return wsInstance;
      },
      onVitalLogged: (reading) => loggedVitals.push(reading),
      speakWithBrowser: (_text, onEnd) => onEnd(),
      stopBrowserSpeech: () => {},
    });

    const mode = await session.syncConnectivity();
    expect(mode).toBe('live-api');
    expect(session.getState().nodeLabel).toBe('gemini-live');
    expect(wsInstance).not.toBeNull();
    expect(wsInstance!.sentMessages[0]).toMatchObject({
      setup: { model: 'models/gemini-3.8-live' },
    });

    // Stream 16kHz PCM audio chunk + JPEG video frame + audioStreamEnd
    session.sendAudioChunk(new Float32Array([0.2, -0.2, 0.3, -0.3]));
    session.sendVideoFrame('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    session.endAudioStream();

    expect(wsInstance!.sentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          realtimeInput: {
            audio: expect.objectContaining({ mimeType: 'audio/pcm;rate=16000' }),
          },
        }),
        expect.objectContaining({
          realtimeInput: {
            video: { data: '/9j/4AAQSkZJRg==', mimeType: 'image/jpeg' },
          },
        }),
        { realtimeInput: { audioStreamEnd: true } },
      ])
    );

    // Simulate incoming non-blocking tool call (`log_checkin_reading`) from Gemini 3.8 Live
    await session.handleLiveServerMessage(
      JSON.stringify({
        interactionStatus: 'IN_PROGRESS',
        toolCall: {
          functionCalls: [
            {
              id: 'call-99',
              name: 'log_checkin_reading',
              args: { zoneId: 'cardio', metricId: 'resting_hr', value: 68 },
            },
          ],
        },
      })
    );

    expect(loggedVitals).toEqual([
      expect.objectContaining({ metricId: 'resting_hr', value: 68 }),
    ]);
    expect(wsInstance!.sentMessages[wsInstance!.sentMessages.length - 1]).toMatchObject({
      toolResponse: {
        functionResponses: [
          expect.objectContaining({ id: 'call-99', name: 'log_checkin_reading' }),
        ],
      },
    });

    // Simulate server audio output + turn completion
    const pcmChunk = float32ToPcm16Base64(new Float32Array([0.25, -0.25]));
    await session.handleLiveServerMessage(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'Log resting heart rate 68 bpm' },
          outputTranscription: { text: 'Logged 68 bpm in Cardio.' },
          modelTurn: {
            parts: [{ inlineData: { data: pcmChunk, mimeType: 'audio/pcm;rate=24000' } }],
          },
        },
      })
    );
    expect(session.getState().isSpeaking).toBe(true);

    // Barge-in interrupt
    session.interrupt();
    expect(session.getState().isSpeaking).toBe(false);
  });

  it('runs sequential Listening [STT] -> Thinking [Local LLM] -> Speaking [TTS] stages in on-ship-pipeline mode', async () => {
    const observedStages: VoicePipelineStage[] = [];
    const api = createMockApi();

    const session = createRealtimeDoctorSession({
      context: baseContext,
      initialOfflineOverride: true,
      api,
      onStateChange: (st) => {
        if (observedStages[observedStages.length - 1] !== st.stage) {
          observedStages.push(st.stage);
        }
      },
      speakWithBrowser: (_text, onEnd) => onEnd(),
      stopBrowserSpeech: () => {},
    });

    const turn = await session.runVoiceTurn({
      fallbackTranscript: 'Throbbing headache behind my eyes and blurry near vision.',
    });

    expect(turn.mode).toBe('on-ship-pipeline');
    expect(turn.nodeLabel).toBe('on-ship-local');
    expect(turn.triageStatus).toBe('red');
    expect(observedStages).toEqual(
      expect.arrayContaining(['listening_stt', 'thinking_llm', 'speaking_tts', 'idle'])
    );

    // Verify client-side fallback when backend is completely unreachable
    const offlineTurn = buildClientOfflineVoiceTurn(
      baseContext,
      'I want to end my life'
    );
    expect(offlineTurn.crisisFlag).toBe(true);
    expect(offlineTurn.triageStatus).toBe('red');
    expect(offlineTurn.earthConsultUrgency).toBe('immediate_emergency_packet');
    expect(offlineTurn.nodeLabel).toBe('on-ship-local');
  });
});
