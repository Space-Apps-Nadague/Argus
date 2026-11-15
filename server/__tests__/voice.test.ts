/**
 * Voice & Video AI Flight Surgeon endpoint tests (specs/04-ai-backend.md §4.1):
 * - Online mode (`live-api`): ephemeral token minting (`POST /api/ai/live-token`), non-blocking tool execution (`POST /api/ai/voice-tool`).
 * - Offline / Deep-Space Blackout mode (`on-ship-pipeline`): STT (`POST /api/ai/stt`), TTS (`POST /api/ai/tts`), and complete voice turns (`POST /api/ai/voice-turn`) presenting as `on-ship-local`.
 * - Deterministic triage guardrails, crisis language escalation, and PostgreSQL persistence (`conversations` + `messages`).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AiEnvelope,
  LiveTokenResponse,
  VoiceSttResponse,
  VoiceToolCallResponse,
  VoiceTtsResponse,
  VoiceTurnResponse,
} from '../../src/types/aiApi';
import { DEFAULT_CREW_ROSTER } from '../../src/data/telemetryScenarios';
import { createApp } from '../app';
import { openDb, setDbHandle } from '../db/client';
import { conversations, messages, ragCitations } from '../db/schema';
import { seedDatabase } from '../db/seed';
import { ingestKnowledge } from '../rag/ingest';
import { parseSpokenVitalLogCommand, synthesizeOfflineCueWavBase64 } from '../routes/voice';

const AI_ENV_PREFIXES = ['AI_', 'OPENROUTER_', 'GEMINI_', 'GROQ_'];

const app = createApp();
const crewMember = DEFAULT_CREW_ROSTER[0];
const originalFetch = globalThis.fetch;

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (AI_ENV_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Voice & Video AI Flight Surgeon routes', () => {
  it('POST /api/ai/live-token falls back cleanly to on-ship-pipeline when no Gemini key is configured', async () => {
    const res = await post('/api/ai/live-token', {
      scenarioId: 'nominal',
      crewMember,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiEnvelope<LiveTokenResponse>;
    expect(body.result.available).toBe(false);
    expect(body.result.mode).toBe('on-ship-pipeline');
    expect(body.result.nodeLabel).toBe('on-ship-local');
    expect(body.result.tools.map((t) => t.name)).toEqual([
      'get_crew_snapshot',
      'log_checkin_reading',
      'lookup_medical_protocol',
    ]);
    expect(body.result.tools.every((t) => t.behavior === 'NON_BLOCKING')).toBe(true);
  });

  it('POST /api/ai/live-token mints an ephemeral Gemini 3.8 Live token without exposing the master API key', async () => {
    const fakeMasterKey = 'AIzaSyFakeMasterKey_DO_NOT_LEAK';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'auth_tokens/ephemeral-token-xyz-987',
          expireTime: '2026-11-14T20:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch;

    const res = await post(
      '/api/ai/live-token',
      {
        scenarioId: 'sans_alert',
        crewMember,
        enableVideo: true,
      },
      { 'X-Argus-Api-Key': fakeMasterKey }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiEnvelope<LiveTokenResponse>;
    expect(body.result.available).toBe(true);
    expect(body.result.mode).toBe('live-api');
    expect(body.result.nodeLabel).toBe('gemini-live');
    expect(body.result.model).toBe('gemini-3.8-live');
    expect(body.result.token).toBe('auth_tokens/ephemeral-token-xyz-987');
    expect(body.result.wsUrl).toContain('BidiGenerateContentConstrained');
    expect(body.result.wsUrl).toContain('ephemeral-token-xyz-987');
    expect(JSON.stringify(body)).not.toContain(fakeMasterKey);
  });

  it('POST /api/ai/live-token respects forceOffline (Simulated Comm Blackout toggle)', async () => {
    const res = await post(
      '/api/ai/live-token',
      {
        scenarioId: 'nominal',
        crewMember,
        forceOffline: true,
      },
      { 'X-Argus-Api-Key': 'AIzaSyFakeMasterKey' }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiEnvelope<LiveTokenResponse>;
    expect(body.result.available).toBe(false);
    expect(body.result.mode).toBe('on-ship-pipeline');
    expect(body.result.nodeLabel).toBe('on-ship-local');
  });

  it('POST /api/ai/stt transcribes via behind-the-scenes Gemini while presenting as on-ship-local and flags crisis phrases', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          outputs: [{ type: 'text', text: 'My vision is blurry and I have a headache behind my eyes.' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch;

    const res = await post(
      '/api/ai/stt',
      {
        scenarioId: 'sans_alert',
        crewMember,
        audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        mode: 'on-ship-pipeline',
      },
      { 'X-Argus-Api-Key': 'AIzaSyFakeMasterKey' }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiEnvelope<VoiceSttResponse>;
    expect(body.result.transcript).toContain('blurry');
    expect(body.result.nodeLabel).toBe('on-ship-local');
    expect(body.result.crisisFlag).toBe(false);

    // Crisis phrase test
    const crisisRes = await post('/api/ai/stt', {
      scenarioId: 'nominal',
      crewMember,
      fallbackTranscript: 'I have been thinking about ending my life',
      mode: 'on-ship-pipeline',
    });
    const crisisBody = (await crisisRes.json()) as AiEnvelope<VoiceSttResponse>;
    expect(crisisBody.result.crisisFlag).toBe(true);
    expect(crisisBody.result.nodeLabel).toBe('on-ship-local');
  });

  it('POST /api/ai/tts synthesizes audio via Gemini TTS or returns a valid RIFF WAV cue in offline mode', async () => {
    // 1. Offline WAV cue fallback
    const offlineRes = await post('/api/ai/tts', {
      text: 'Valkyrie, readiness is 98 out of 100.',
      mode: 'on-ship-pipeline',
    });
    expect(offlineRes.status).toBe(200);
    const offlineBody = (await offlineRes.json()) as AiEnvelope<VoiceTtsResponse>;
    expect(offlineBody.result.nodeLabel).toBe('on-ship-local');
    expect(offlineBody.result.mimeType).toBe('audio/wav');
    expect(offlineBody.result.useBrowserSpeechFallback).toBe(true);
    const wavBytes = Buffer.from(offlineBody.result.audioBase64, 'base64');
    expect(wavBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');

    // 2. Behind-the-scenes Gemini TTS (`gemini-3.8-flash-lite-tts`)
    const sampleWavBase64 = synthesizeOfflineCueWavBase64(60);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          outputs: [{ type: 'audio', data: sampleWavBase64, mime_type: 'audio/wav' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch;

    const liveTtsRes = await post(
      '/api/ai/tts',
      {
        text: 'Valkyrie, readiness is 98 out of 100.',
        mode: 'on-ship-pipeline',
      },
      { 'X-Argus-Api-Key': 'AIzaSyFakeMasterKey' }
    );
    expect(liveTtsRes.status).toBe(200);
    const liveTtsBody = (await liveTtsRes.json()) as AiEnvelope<VoiceTtsResponse>;
    expect(liveTtsBody.result.nodeLabel).toBe('on-ship-local');
    expect(liveTtsBody.result.useBrowserSpeechFallback).toBe(false);
    expect(liveTtsBody.result.audioBase64).toBe(sampleWavBase64);
  });

  it('POST /api/ai/voice-tool executes get_crew_snapshot and log_checkin_reading deterministically', async () => {
    const snapRes = await post('/api/ai/voice-tool', {
      scenarioId: 'sans_alert',
      crewMember,
      toolName: 'get_crew_snapshot',
      callId: 'call-snap-1',
    });
    expect(snapRes.status).toBe(200);
    const snapBody = (await snapRes.json()) as AiEnvelope<VoiceToolCallResponse>;
    expect(snapBody.result.ok).toBe(true);
    expect(snapBody.result.zoneStatuses.neuro).toBe('red');
    expect(snapBody.result.earthConsultUrgency).toBe('immediate_emergency_packet');

    const logRes = await post('/api/ai/voice-tool', {
      scenarioId: 'nominal',
      crewMember,
      toolName: 'log_checkin_reading',
      callId: 'call-log-1',
      args: {
        zoneId: 'cardio',
        metricId: 'resting_hr',
        value: 68,
      },
    });
    expect(logRes.status).toBe(200);
    const logBody = (await logRes.json()) as AiEnvelope<VoiceToolCallResponse>;
    expect(logBody.result.ok).toBe(true);
    expect(logBody.result.loggedReading).toMatchObject({
      zoneId: 'cardio',
      metricId: 'resting_hr',
      value: 68,
      status: 'green',
    });

    const ragToolRes = await post('/api/ai/voice-tool', {
      scenarioId: 'sans_alert',
      crewMember,
      toolName: 'lookup_medical_protocol',
      callId: 'call-rag-1',
      args: {
        query: 'sumatriptan migraine nasal spray dosage',
        zoneId: 'neuro',
      },
    });
    expect(ragToolRes.status).toBe(200);
    const ragToolBody = (await ragToolRes.json()) as AiEnvelope<VoiceToolCallResponse>;
    expect(ragToolBody.result.ok).toBe(true);
    expect(ragToolBody.result.ragHits?.length).toBeGreaterThan(0);
    expect(ragToolBody.result.ragHits?.[0].documentId).toBe('reference/spaceflight-med-kit-formulary');
    expect(ragToolBody.result.ragHits?.[0].sourceId).toBe('SRC-004');
  });

  it('parseSpokenVitalLogCommand extracts spoken vital check-in commands', () => {
    expect(parseSpokenVitalLogCommand('Please log resting heart rate 68 bpm')).toEqual({
      zoneId: 'cardio',
      metricId: 'resting_hr',
      value: 68,
    });
    expect(parseSpokenVitalLogCommand('Record SpO2 97')).toEqual({
      zoneId: 'cardio',
      metricId: 'spo2',
      value: 97,
    });
  });

  it('POST /api/ai/voice-turn preserves deterministic triage, escalates crisis language, logs spoken vitals, and persists to Postgres', async () => {
    const h = openDb('pglite:memory');
    await h.migrate();
    await seedDatabase(h.db, {
      adminUsername: 'admin',
      adminPassword: 'admin-password-123',
      demoPassword: 'demo-password-123',
    });
    await ingestKnowledge(h.db);
    setDbHandle(h);

    try {
      const loginRes = await post('/api/auth/login', {
        username: 'valkyrie',
        password: 'demo-password-123',
      });
      expect(loginRes.status).toBe(200);
      const setCookie = loginRes.headers.get('set-cookie') ?? '';
      const cookie = /argus_session=[^;]+/.exec(setCookie)?.[0] ?? '';

      // 1. Spoken vital check-in + SANS alert scenario
      const turnRes = await post(
        '/api/ai/voice-turn',
        {
          scenarioId: 'sans_alert',
          crewMember,
          transcript: 'Log resting heart rate 68 bpm and check my eye pressure.',
          mode: 'on-ship-pipeline',
          synthesizeAudio: true,
        },
        { Cookie: cookie }
      );
      expect(turnRes.status).toBe(200);
      const turnBody = (await turnRes.json()) as AiEnvelope<VoiceTurnResponse>;
      expect(turnBody.result.mode).toBe('on-ship-pipeline');
      expect(turnBody.result.nodeLabel).toBe('on-ship-local');
      expect(turnBody.result.triageStatus).toBe('red');
      expect(turnBody.result.earthConsultUrgency).toBe('immediate_emergency_packet');
      expect(turnBody.result.toolCallsExecuted.length).toBe(1);
      expect(turnBody.result.toolCallsExecuted[0].loggedReading).toMatchObject({
        metricId: 'resting_hr',
        value: 68,
      });
      expect(turnBody.result.audioBase64).toBeTruthy();
      expect(turnBody.result.ragHits?.length).toBeGreaterThan(0);
      expect(
        turnBody.result.ragHits?.some(
          (h) => (h.sourceId && /^SRC-\d{3}$/.test(h.sourceId)) || h.documentId.startsWith('countermeasure/')
        )
      ).toBe(true);
      expect(turnBody.result.disclaimer).toMatch(/Decision support, not a medical diagnosis/i);

      // 2. Crisis phrase escalation (never lowered by AI)
      const crisisRes = await post(
        '/api/ai/voice-turn',
        {
          scenarioId: 'nominal',
          crewMember,
          transcript: 'I want to end my life',
          existingReplyText: 'Everything looks nominal.',
          mode: 'live-api',
        },
        { Cookie: cookie }
      );
      expect(crisisRes.status).toBe(200);
      const crisisBody = (await crisisRes.json()) as AiEnvelope<VoiceTurnResponse>;
      expect(crisisBody.result.crisisFlag).toBe(true);
      expect(crisisBody.result.triageStatus).toBe('red');
      expect(crisisBody.result.earthConsultUrgency).toBe('immediate_emergency_packet');
      expect(crisisBody.result.replyText).toMatch(/Crew Medical Officer/);

      // 3. Verify PostgreSQL persistence in `conversations`, `messages`, and `rag_citations`
      const savedConvs = await h.db.select().from(conversations);
      const savedMsgs = await h.db.select().from(messages);
      const savedCitations = await h.db.select().from(ragCitations);
      expect(savedConvs.length).toBeGreaterThanOrEqual(1);
      expect(
        savedMsgs.some(
          (m) => (m.contextSnapshot as { voiceMode?: string } | null)?.voiceMode === 'on-ship-pipeline'
        )
      ).toBe(true);
      expect(
        savedMsgs.some(
          (m) => (m.contextSnapshot as { voiceMode?: string } | null)?.voiceMode === 'live-api'
        )
      ).toBe(true);
      expect(savedMsgs.some((m) => m.crisisFlag === true)).toBe(true);
      expect(savedCitations.length).toBeGreaterThan(0);
      expect(savedCitations.some((c) => c.mode === 'on-ship-pipeline')).toBe(true);
    } finally {
      setDbHandle(null);
      await h.close();
    }
  }, 15_000);
});
