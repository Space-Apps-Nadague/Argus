/**
 * ARGUS — Real-Time Voice & Video AI Flight Surgeon Routes (specs/04-ai-backend.md §4.1)
 *
 * Supports two seamless transport modes:
 * 1. Online Mode (`live-api`):
 *    - `POST /api/ai/live-token` mints a short-lived Gemini Live API ephemeral token (`v1beta/auth_tokens`)
 *      so no long-lived API key ever ships to the browser.
 *    - `POST /api/ai/voice-tool` executes non-blocking deterministic tools (`get_crew_snapshot`,
 *      `log_checkin_reading`) invoked during Live WebSocket sessions.
 * 2. Offline / Deep-Space Blackout Mode (`on-ship-pipeline`):
 *    - Sequential `STT → Regular LLM → TTS` pipeline (`POST /api/ai/stt`, `POST /api/ai/voice-turn`,
 *      `POST /api/ai/tts`).
 *    - Uses Gemini behind the scenes when internet is available while presenting and behaving
 *      in telemetry as the On-Ship Local Flight Surgeon (`nodeLabel: 'on-ship-local'`), and
 *      falls back gracefully to Ollama (`AI_PROVIDERS=local`) or deterministic onboard protocols
 *      when truly disconnected.
 *
 * Deterministic Guardrails (AGENTS.md §2.4):
 * - Green/Yellow/Red triage evaluation (`triageEngine.ts`) and crisis detection (`wellbeingModel.ts`)
 *   are 100% deterministic TypeScript. The voice AI can raise urgency, never lower it.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { BodyZoneId, CheckInEntry, MetricId, TriageStatus } from '../../src/types/argus';
import type {
  AiEnvelope,
  EarthConsultUrgency,
  LiveTokenRequest,
  LiveTokenResponse,
  RagHit,
  VoiceNodeLabel,
  VoiceSttResponse,
  VoiceToolCallRequest,
  VoiceToolCallResponse,
  VoiceToolDeclaration,
  VoiceTransportMode,
  VoiceTtsResponse,
  VoiceTurnResponse,
} from '../../src/types/aiApi';
import { BODY_ZONES, getOfflineFlightSurgeonGuidance } from '../../src/data/telemetryScenarios';
import { applyCheckIns, latestMissionDay, validateCheckInValue } from '../../src/utils/checkIns';
import { matchOfflineSymptomGuidance } from '../../src/utils/symptomFallback';
import {
  calculateCrewReadinessScore,
  evaluateAllZones,
  evaluateMetricStatus,
  isMetricId,
  METRIC_INPUT_RANGES,
  STATUS_LABELS,
} from '../../src/utils/triageEngine';
import { type ChatMessage, completeJson } from '../ai/llm';
import { currentPrivacy } from '../ai/privacy';
import type { AppEnv } from '../auth/types';
import { getOrStartConversation, latestTriageEventId, logMessage } from '../db/chatLog';
import { type CrewSnapshot, buildCrewSnapshot, formatSnapshotForPrompt } from '../models/crewSnapshot';
import { CRISIS_ESCALATION_MESSAGE, detectCrisisLanguage } from '../models/wellbeingModel';
import { ARGUS_PERSONA, jsonInstruction } from '../prompts';
import { logCitations } from '../rag/citations';
import { searchKnowledge } from '../rag/retriever';
import { formatKnowledgeForPrompt, LOOKUP_MEDICAL_PROTOCOL_TOOL, lookupMedicalProtocol } from '../rag/tool';
import {
  LiveTokenRequestSchema,
  UrgencySchema,
  VoiceSttRequestSchema,
  VoiceToolCallRequestSchema,
  VoiceTtsRequestSchema,
  VoiceTurnRequestSchema,
} from '../schemas';
import { keyFromHeader, liveMeta, OFFLINE_META, parseBody } from './util';
import { DEFAULT_GEMINI_VOICE, GEMINI_VOICES, isGeminiVoice } from '../ai/geminiVoices';
import { onShipStrict } from '../ai/providers';
import { LOCAL_VOICES, localSpeechConfig, localSynthesize, localTranscribe, probeLocalSpeech } from '../ai/localSpeech';
import type { VoicesResponse } from '../../src/types/assistant';

export const voiceRoutes = new Hono<AppEnv>();

export const VOICE_CLINICAL_DISCLAIMER = 'Decision support, not a medical diagnosis.';
export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
export const DEFAULT_STT_MODEL = 'gemini-3.5-transcribe';
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
/** Gemini 2.5 fallbacks (standard `generateContent` API) used when the 3.x speech models fail. */
export const FALLBACK_STT_MODEL = 'gemini-2.5-flash';
export const FALLBACK_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

export const VOICE_TOOL_DECLARATIONS: VoiceToolDeclaration[] = [
  {
    name: 'get_crew_snapshot',
    description:
      'Returns the active astronaut deterministic 6-zone triage statuses, readiness score, personal baselines, and flagged metric drift.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        zoneId: {
          type: 'STRING',
          description: 'Optional anatomical zone filter: neuro, cardio, musculo, metabolic, immune, or behavioral.',
        },
      },
    },
  },
  {
    name: 'log_checkin_reading',
    description:
      'Validates and logs a measured vital sign reading for the active astronaut and returns updated deterministic triage status and readiness score.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        zoneId: {
          type: 'STRING',
          description: 'Anatomical zone (neuro, cardio, musculo, metabolic, immune, behavioral).',
        },
        metricId: {
          type: 'STRING',
          description:
            'Canonical metric ID (onsd, iop, cabin_co2, resting_hr, hrv_rmssd, spo2, systolic_bp, hydration_intake, bmd_delta, ared_load, blood_glucose, caloric_intake, rad_dose, wbc_lymph, core_temp, sleep_eff, pvt_lapses, daily_sleep_hours, mood_index, diastolic_bp, sleep_resp_rate, vo2_max, hemoglobin, urine_sg, grip_strength, body_mass_delta, crp, cortisol, reaction_time, headache_severity, hyperopic_shift).',
        },
        value: {
          type: 'NUMBER',
          description: 'Numeric measurement value in canonical units.',
        },
        note: {
          type: 'STRING',
          description: 'Optional clinical note for the logged reading.',
        },
      },
      required: ['metricId', 'value'],
    },
  },
  LOOKUP_MEDICAL_PROTOCOL_TOOL as VoiceToolDeclaration,
];

const URGENCY_RANK: Record<EarthConsultUrgency, number> = {
  routine_downlink: 0,
  priority_packet: 1,
  immediate_emergency_packet: 2,
};

const STATUS_RANK: Record<TriageStatus, number> = {
  green: 0,
  yellow: 1,
  red: 2,
};

export function maxUrgency(a: EarthConsultUrgency, b: EarthConsultUrgency): EarthConsultUrgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

export function maxTriageStatus(a: TriageStatus, b: TriageStatus): TriageStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function worstZoneStatus(zoneStatuses: Record<BodyZoneId, TriageStatus>): TriageStatus {
  let worst: TriageStatus = 'green';
  for (const status of Object.values(zoneStatuses)) {
    worst = maxTriageStatus(worst, status);
  }
  return worst;
}

export function urgencyFloorForStatus(status: TriageStatus): EarthConsultUrgency {
  if (status === 'red') return 'immediate_emergency_packet';
  if (status === 'yellow') return 'priority_packet';
  return 'routine_downlink';
}

export function findZoneForMetric(snapshot: CrewSnapshot, metricId: string): BodyZoneId {
  for (const zoneId of Object.keys(snapshot.zones) as BodyZoneId[]) {
    if (snapshot.zones[zoneId].some((r) => r.metricId === metricId)) {
      return zoneId;
    }
  }
  return 'cardio';
}

/**
 * Resolves a server-side Gemini API key (or per-request `X-AI-Key` starting with `AIza`).
 * Returns `undefined` when `ai_consent = false` or when `AI_PROVIDERS` explicitly restricts to `local`.
 */
export function resolveGeminiApiKey(
  env: Record<string, string | undefined> = process.env,
  keyOverride?: string
): string | undefined {
  if (currentPrivacy().offlineOnly) return undefined;
  const override = keyOverride?.trim();
  if (override && override.startsWith('AIza')) return override;

  const providersList = (env.AI_PROVIDERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (providersList.length > 0 && providersList.every((p) => p === 'local')) {
    return undefined;
  }

  const geminiKey = env.GEMINI_API_KEY?.trim();
  if (geminiKey) return geminiKey;

  const genericKey = env.AI_API_KEY?.trim();
  if (genericKey && genericKey.startsWith('AIza')) return genericKey;

  return undefined;
}

export function buildVoiceSystemInstruction(
  snapshot: CrewSnapshot,
  mode: VoiceTransportMode,
  ragReferenceBlock?: string
): string {
  const modeNote =
    mode === 'on-ship-pipeline'
      ? 'Operating in On-Ship Local Autonomous Mode (STT → Local LLM → TTS) during deep-space communications blackout.'
      : 'Operating in Real-Time Bidirectional Flight Surgeon Live Mode.';
  const ragRule =
    mode === 'live-api'
      ? '- Before giving any procedure, checklist step, medication dose, or treatment, call `lookup_medical_protocol` and speak a concise 2 to 3 step plain-language summary while the HUD displays the full cited protocol card ([SRC-xxx]).'
      : '- Ground procedural steps, countermeasures, and dosages in the verified REFERENCE chunks below (citing their [SRC-xxx] ID) and speak a concise 2 to 3 step plain-language summary while the HUD displays the full cited protocol card.';
  return [
    ARGUS_PERSONA,
    modeNote,
    'Voice Delivery Rules:',
    '- Respond in 2 to 4 concise spoken sentences suitable for immediate audio playback to an astronaut.',
    '- Do not use markdown tables, bullet lists, or code blocks.',
    '- Ground every number in the astronaut DATA below and never invent vital readings.',
    ragRule,
    `- Clinical framing: ${VOICE_CLINICAL_DISCLAIMER}`,
    `DATA\n${formatSnapshotForPrompt(snapshot, { allMetrics: true })}`,
    ragReferenceBlock ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> };
  }>;
}

async function geminiGenerateContent(
  apiKey: string,
  model: string,
  body: unknown,
  timeoutMs: number
): Promise<GenerateContentResponse | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(`[ARGUS Voice] ${model} failed (${res.status}):`, errText.slice(0, 240));
    return null;
  }
  return (await res.json()) as GenerateContentResponse;
}

/** Wraps raw 16-bit little-endian mono PCM in a WAV header so `<audio>` can play it. */
export function pcmToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

/** Gemini 2.5 transcription fallback. Returns the transcript, or `null` on any failure. */
export async function fallbackTranscribe(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
  model = FALLBACK_STT_MODEL
): Promise<string | null> {
  try {
    const data = await geminiGenerateContent(
      apiKey,
      model,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Transcribe the astronaut speech verbatim. Return only the spoken words with no extra commentary.' },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
      },
      12_000
    );
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
      .trim();
    return text || null;
  } catch (err) {
    console.warn('[ARGUS Voice STT] Gemini 2.5 fallback failed:', err);
    return null;
  }
}

/** Gemini 2.5 speech-synthesis fallback. Returns WAV audio, or `null` on any failure. */
export async function fallbackSynthesize(
  apiKey: string,
  text: string,
  voice: string,
  style: string,
  model = FALLBACK_TTS_MODEL
): Promise<{ audioBase64: string; mimeType: string } | null> {
  try {
    const data = await geminiGenerateContent(
      apiKey,
      model,
      {
        contents: [{ role: 'user', parts: [{ text: `Say in a ${style} voice: ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      },
      20_000
    );
    const inline = data?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!inline?.data) return null;
    const mime = (inline.mimeType ?? '').toLowerCase();
    if (mime.includes('wav')) return { audioBase64: inline.data, mimeType: 'audio/wav' };
    // Gemini TTS returns raw PCM, e.g. `audio/L16;codec=pcm;rate=24000`.
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;
    return { audioBase64: pcmToWavBase64(inline.data, rate), mimeType: 'audio/wav' };
  } catch (err) {
    console.warn('[ARGUS Voice TTS] Gemini 2.5 fallback failed:', err);
    return null;
  }
}

/**
 * Generates a valid, playable 16-bit mono PCM WAV audio buffer (base64) for deterministic
 * offline TTS fallback so `<audio>` elements and audio pipelines always receive valid WAV bytes.
 */
export function synthesizeOfflineCueWavBase64(
  textOrDuration: string | number = 'cue',
  sampleRate = 16000
): string {
  const durationSec =
    typeof textOrDuration === 'number'
      ? Math.min(1.0, Math.max(0.05, textOrDuration / 1000))
      : Math.min(0.45, Math.max(0.18, textOrDuration.length * 0.003));
  const numSamples = Math.max(640, Math.floor(sampleRate * durationSec));
  const dataBytes = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels = 1 (mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  // Soft dual-tone spacecraft telemetry chime (440 Hz -> 587.33 Hz with smooth envelope)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const progress = i / numSamples;
    const freq = progress < 0.5 ? 440 : 587.33;
    const envelope = Math.sin(Math.PI * progress) * 0.18;
    const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * envelope * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer.toString('base64');
}

/** Executes a deterministic voice tool call (`get_crew_snapshot` or `log_checkin_reading`). */
export function executeVoiceToolCall(req: VoiceToolCallRequest): VoiceToolCallResponse {
  const snapshot = buildCrewSnapshot(req);
  const callId = req.callId || `call-${Date.now()}`;

  if (req.toolName === 'get_crew_snapshot') {
    const zoneFilter = req.args?.zoneId;
    const worst = worstZoneStatus(snapshot.zoneStatuses);
    const urgency = urgencyFloorForStatus(worst);
    if (zoneFilter && snapshot.zones[zoneFilter]) {
      const readings = snapshot.zones[zoneFilter]
        .map((r) => `${r.label} ${r.currentValue} ${r.unit}`)
        .join(', ');
      return {
        callId,
        toolName: 'get_crew_snapshot',
        ok: true,
        summary: `${BODY_ZONES[zoneFilter].name} status is ${STATUS_LABELS[snapshot.zoneStatuses[zoneFilter]]}: ${readings}. Overall readiness ${snapshot.readinessScore}%.`,
        readinessScore: snapshot.readinessScore,
        zoneStatuses: snapshot.zoneStatuses,
        earthConsultUrgency: urgency,
      };
    }

    const flagged = snapshot.flaggedTrends
      .slice(0, 4)
      .map((t) => `${t.label} ${t.currentValue} ${t.unit} (${t.status.toUpperCase()})`)
      .join('; ');
    return {
      callId,
      toolName: 'get_crew_snapshot',
      ok: true,
      summary: `Crew readiness is ${snapshot.readinessScore}%. ${flagged ? `Flagged metrics: ${flagged}.` : 'All 5 anatomical zones are nominal.'}`,
      readinessScore: snapshot.readinessScore,
      zoneStatuses: snapshot.zoneStatuses,
      earthConsultUrgency: urgency,
    };
  }

  // Tool: `log_checkin_reading`
  const rawMetricId = (req.args?.metricId ?? '').trim();
  const rawValue = req.args?.value;

  if (!isMetricId(rawMetricId)) {
    const worst = worstZoneStatus(snapshot.zoneStatuses);
    return {
      callId,
      toolName: 'log_checkin_reading',
      ok: false,
      summary: `Unknown metric ID "${rawMetricId}". Valid metrics include resting_hr, hrv_rmssd, spo2, systolic_bp, onsd, iop, cabin_co2, sleep_eff, and rad_dose.`,
      readinessScore: snapshot.readinessScore,
      zoneStatuses: snapshot.zoneStatuses,
      earthConsultUrgency: urgencyFloorForStatus(worst),
    };
  }

  const validation = validateCheckInValue(rawMetricId, rawValue);
  if (validation.ok !== true) {
    const range = METRIC_INPUT_RANGES[rawMetricId];
    const worst = worstZoneStatus(snapshot.zoneStatuses);
    return {
      callId,
      toolName: 'log_checkin_reading',
      ok: false,
      summary: `Reading for ${rawMetricId} out of plausible range (${range.min}–${range.max}).`,
      readinessScore: snapshot.readinessScore,
      zoneStatuses: snapshot.zoneStatuses,
      earthConsultUrgency: urgencyFloorForStatus(worst),
    };
  }

  const zoneId = req.args?.zoneId ?? findZoneForMetric(snapshot, rawMetricId);
  const targetDay = latestMissionDay(snapshot.zones) || 30;
  const entry: CheckInEntry = {
    id: `voice-ci-${Date.now()}`,
    crewId: req.crewMember?.id ?? 'crew-default',
    missionDay: targetDay,
    timestampIso: new Date().toISOString(),
    values: { [rawMetricId]: validation.value },
    note: req.args?.note ?? `Voice check-in: ${rawMetricId} = ${validation.value}`,
  };

  const overlaidZones = applyCheckIns(snapshot.zones, [entry]);
  const updatedStatuses = evaluateAllZones(overlaidZones, snapshot.environment);
  const updatedReadiness = calculateCrewReadinessScore(overlaidZones, snapshot.environment);
  const metricStatus = evaluateMetricStatus(rawMetricId, validation.value, snapshot.environment);
  const metricReading = overlaidZones[zoneId]?.find((r) => r.metricId === rawMetricId);
  const label = metricReading?.label ?? rawMetricId;
  const unit = metricReading?.unit ?? '';
  const worst = worstZoneStatus(updatedStatuses);

  return {
    callId,
    toolName: 'log_checkin_reading',
    ok: true,
    summary: `Logged ${label} = ${validation.value} ${unit} (${STATUS_LABELS[metricStatus]}). Updated readiness score is ${updatedReadiness}%.`,
    readinessScore: updatedReadiness,
    zoneStatuses: updatedStatuses,
    loggedReading: {
      zoneId,
      metricId: rawMetricId,
      value: validation.value,
      status: metricStatus,
    },
    earthConsultUrgency: urgencyFloorForStatus(worst),
  };
}

const SPOKEN_METRIC_ALIASES: Array<{ pattern: RegExp; metricId: MetricId; zoneId: BodyZoneId }> = [
  { pattern: /\b(?:resting\s+heart\s+rate|resting\s+hr|heart\s+rate|pulse)\b/i, metricId: 'resting_hr', zoneId: 'cardio' },
  { pattern: /\b(?:hrv|heart\s+rate\s+variability)\b/i, metricId: 'hrv_rmssd', zoneId: 'cardio' },
  { pattern: /\b(?:spo2|oxygen\s+saturation|blood\s+oxygen)\b/i, metricId: 'spo2', zoneId: 'cardio' },
  { pattern: /\b(?:systolic|blood\s+pressure)\b/i, metricId: 'systolic_bp', zoneId: 'cardio' },
  { pattern: /\b(?:onsd|optic\s+nerve)\b/i, metricId: 'onsd', zoneId: 'neuro' },
  { pattern: /\b(?:iop|eye\s+pressure|intraocular)\b/i, metricId: 'iop', zoneId: 'neuro' },
  { pattern: /\b(?:cabin\s+co2|co2|carbon\s+dioxide)\b/i, metricId: 'cabin_co2', zoneId: 'neuro' },
  { pattern: /\b(?:core\s+temp|body\s+temperature|temperature)\b/i, metricId: 'core_temp', zoneId: 'immune' },
  { pattern: /\b(?:sleep\s+efficiency)\b/i, metricId: 'sleep_eff', zoneId: 'behavioral' },
  { pattern: /\b(?:sleep\s+hours|hours\s+of\s+sleep)\b/i, metricId: 'daily_sleep_hours', zoneId: 'behavioral' },
  { pattern: /\b(?:blood\s+glucose|glucose|blood\s+sugar)\b/i, metricId: 'blood_glucose', zoneId: 'metabolic' },
  { pattern: /\b(?:caloric\s+intake|calories|calorie\s+intake)\b/i, metricId: 'caloric_intake', zoneId: 'musculo' },
  { pattern: /\b(?:hydration\s+intake|hydration|water\s+intake|fluid\s+intake)\b/i, metricId: 'hydration_intake', zoneId: 'cardio' },
];

/**
 * Detects if a spoken transcript requests logging a vital sign reading (e.g. "Log resting heart rate 68 bpm").
 */
export function parseSpokenVitalLogCommand(
  transcript: string
): { zoneId: BodyZoneId; metricId: MetricId; value: number } | null {
  if (!/\b(log|record|save|enter|check-in|checkin)\b/i.test(transcript)) return null;
  const cleanedForNum = transcript.replace(/\b(?:spo2|co2|vo2)\b/gi, ' ');
  const numMatch = cleanedForNum.match(/(-?\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const value = Number(numMatch[1]);
  if (!Number.isFinite(value)) return null;

  for (const entry of SPOKEN_METRIC_ALIASES) {
    if (entry.pattern.test(transcript)) {
      return { zoneId: entry.zoneId, metricId: entry.metricId, value };
    }
  }
  return null;
}

const VOICE_ZONE_KEYWORDS: Array<[BodyZoneId, RegExp]> = [
  ['neuro', /\b(eye|eyes|vision|blurry|head|headache|onsd|iop|pressure|brain|co2|carbon|sans|sumatriptan|acetaminophen)\b/i],
  ['cardio', /\b(heart|pulse|hr|hrv|chest|oxygen|spo2|breath|breathing|cardiac|cpr|aed|epinephrine)\b/i],
  ['musculo', /\b(bone|bones|muscle|muscles|back|ared|exercise|workout|strength|ibuprofen|strain)\b/i],
  ['immune', /\b(radiation|dose|solar|storm|spe|alara|immune|infection|sick|fever|blood|rash|diphenhydramine)\b/i],
  ['behavioral', /\b(sleep|tired|fatigue|stress|stressed|mood|sad|lonely|anxious|anxiety|focus|reaction|melatonin|zolpidem)\b/i],
];

export function inferVoiceZone(transcript: string, snapshot: CrewSnapshot): BodyZoneId | undefined {
  const matched = VOICE_ZONE_KEYWORDS.find(([, re]) => re.test(transcript))?.[0];
  if (matched) return matched;
  return snapshot.flaggedTrends[0]?.zoneId;
}

/**
 * Deterministic spoken response fallback grounded in the astronaut's snapshot, symptom rules, RAG chunks, and tool results.
 */
export function buildOfflineVoiceReply(
  snapshot: CrewSnapshot,
  transcript: string,
  toolCalls: VoiceToolCallResponse[] = [],
  ragHits: RagHit[] = []
): {
  replyText: string;
  triageStatus: TriageStatus;
  earthConsultUrgency: EarthConsultUrgency;
} {
  const callsign = snapshot.crewMember?.callsign ?? 'Crew';
  const baseStatus = worstZoneStatus(snapshot.zoneStatuses);
  const baseUrgency = urgencyFloorForStatus(baseStatus);
  const topHit = ragHits[0];

  if (toolCalls.length > 0 && toolCalls[0].ok) {
    const tool = toolCalls[0];
    const toolStatus = tool.loggedReading?.status ?? worstZoneStatus(tool.zoneStatuses);
    const combinedStatus = maxTriageStatus(baseStatus, toolStatus);
    const combinedUrgency = maxUrgency(baseUrgency, tool.earthConsultUrgency);
    return {
      replyText: `${callsign}, ${tool.summary} ${
        toolStatus === 'red'
          ? 'This reading is in the Alert range; initiate the zone protocol immediately and queue an emergency packet.'
          : toolStatus === 'yellow'
          ? 'This reading is in the Caution band; monitor closely and review your countermeasure steps.'
          : 'This reading is within nominal spaceflight limits.'
      } ${VOICE_CLINICAL_DISCLAIMER}`,
      triageStatus: combinedStatus,
      earthConsultUrgency: combinedUrgency,
    };
  }

  const symptomMatch = matchOfflineSymptomGuidance({
    symptoms: transcript,
    scenarioId: snapshot.scenarioId,
    environment: snapshot.environment,
    crewMember: snapshot.crewMember,
  });

  if (symptomMatch && !symptomMatch.headline.startsWith('Autonomous Clinical Guidance: Crew Query Recorded')) {
    const firstStep = symptomMatch.guidedSteps[0];
    const combinedStatus = maxTriageStatus(baseStatus, symptomMatch.triageStatus);
    const combinedUrgency = maxUrgency(baseUrgency, symptomMatch.earthConsultUrgency);
    const citeNote = topHit ? ` Cited protocol: ${topHit.title} [${topHit.sourceId ?? 'in-repo'}].` : '';
    return {
      replyText: `${callsign}, ${symptomMatch.plainLanguageExplanation}${
        firstStep ? ` First step: ${firstStep.title} — ${firstStep.plainInstruction}` : ''
      }${citeNote} ${VOICE_CLINICAL_DISCLAIMER}`,
      triageStatus: combinedStatus,
      earthConsultUrgency: combinedUrgency,
    };
  }

  if (topHit) {
    const conciseSteps = topHit.content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('When:') && !l.startsWith('Steps:'))
      .slice(0, 2)
      .join(' ');
    const isEmergency = topHit.kind === 'emergency_checklist';
    const combinedStatus = isEmergency ? maxTriageStatus(baseStatus, 'red') : baseStatus;
    const combinedUrgency = isEmergency ? maxUrgency(baseUrgency, 'immediate_emergency_packet') : baseUrgency;
    return {
      replyText: `${callsign}, per ${topHit.title} (${topHit.heading}) [${topHit.sourceId ?? 'in-repo'}]: ${conciseSteps} Full checklist is displayed on your HUD. ${VOICE_CLINICAL_DISCLAIMER}`,
      triageStatus: combinedStatus,
      earthConsultUrgency: combinedUrgency,
    };
  }

  const flagged = snapshot.flaggedTrends
    .slice(0, 2)
    .map((t) => `${t.label} at ${t.currentValue} ${t.unit} (${STATUS_LABELS[t.status]})`)
    .join(' and ');

  if (flagged) {
    const topZone = snapshot.flaggedTrends[0].zoneId;
    const guidance = getOfflineFlightSurgeonGuidance(
      snapshot.scenarioId,
      topZone,
      snapshot.environment,
      snapshot.crewMember
    );
    const step = guidance.guidedSteps[0];
    return {
      replyText: `${callsign}, your readiness is ${snapshot.readinessScore}% with ${flagged}. ${
        step ? `Recommended countermeasure: ${step.title} (${step.estimatedMinutes} minutes).` : guidance.headline
      } ${VOICE_CLINICAL_DISCLAIMER}`,
      triageStatus: baseStatus,
      earthConsultUrgency: baseUrgency,
    };
  }

  return {
    replyText: `${callsign}, your crew readiness is ${snapshot.readinessScore}% and all five physiological zones are nominal for ${snapshot.environment.replace('_', ' ')}. Continue your scheduled countermeasure routine and let me know if any symptoms arise. ${VOICE_CLINICAL_DISCLAIMER}`,
    triageStatus: baseStatus,
    earthConsultUrgency: baseUrgency,
  };
}

const VoiceTurnLlmSchema = z.object({
  replyText: z.string().min(1).max(1600),
  earthConsultUrgency: UrgencySchema.optional(),
});

// ── 1. POST /api/ai/live-token ───────────────────────────────────────────────

voiceRoutes.post('/live-token', async (c) => {
  const body = await parseBody(c, LiveTokenRequestSchema);
  if (!body.ok) return body.response;
  const req: LiveTokenRequest = body.data;

  const started = Date.now();
  const snapshot = buildCrewSnapshot(req);
  const worst = worstZoneStatus(snapshot.zoneStatuses);
  const urgencyFloor = urgencyFloorForStatus(worst);
  const systemInstruction = buildVoiceSystemInstruction(snapshot, req.forceOffline ? 'on-ship-pipeline' : 'live-api');

  const headerKey = keyFromHeader(c) || c.req.header('X-Argus-Api-Key')?.trim();
  const geminiKey = req.forceOffline ? undefined : resolveGeminiApiKey(process.env, headerKey);
  const liveModel = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;

  if (geminiKey) {
    try {
      const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = (await res.json()) as { name?: string };
        const tokenName = data.name?.trim();
        if (tokenName) {
          const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(tokenName)}`;
          const envelope: AiEnvelope<LiveTokenResponse> = {
            result: {
              available: true,
              mode: 'live-api',
              nodeLabel: 'gemini-live',
              recommendedMode: 'live-api',
              token: tokenName,
              wsUrl,
              model: liveModel,
              expiresAtIso: expireTime,
              systemInstruction,
              tools: VOICE_TOOL_DECLARATIONS,
              snapshotSummary: {
                readinessScore: snapshot.readinessScore,
                zoneStatuses: snapshot.zoneStatuses,
                earthConsultUrgency: urgencyFloor,
              },
              disclaimer: VOICE_CLINICAL_DISCLAIMER,
            },
            meta: {
              source: 'live_ai',
              provider: 'gemini',
              model: liveModel,
              latencyMs: Date.now() - started,
            },
          };
          return c.json(envelope);
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[ARGUS Voice] Ephemeral token request failed (${res.status}) — routing to on-ship pipeline:`, errText);
      }
    } catch (err) {
      console.warn('[ARGUS Voice] Ephemeral token provisioning failed — routing to on-ship pipeline:', err);
    }
  }

  const offlineEnvelope: AiEnvelope<LiveTokenResponse> = {
    result: {
      available: false,
      mode: 'on-ship-pipeline',
      nodeLabel: 'on-ship-local',
      recommendedMode: 'on-ship-pipeline',
      systemInstruction: buildVoiceSystemInstruction(snapshot, 'on-ship-pipeline'),
      tools: VOICE_TOOL_DECLARATIONS,
      snapshotSummary: {
        readinessScore: snapshot.readinessScore,
        zoneStatuses: snapshot.zoneStatuses,
        earthConsultUrgency: urgencyFloor,
      },
      disclaimer: VOICE_CLINICAL_DISCLAIMER,
    },
    meta: OFFLINE_META,
  };
  return c.json(offlineEnvelope);
});

// ── 2. POST /api/ai/stt ──────────────────────────────────────────────────────

voiceRoutes.post('/stt', async (c) => {
  const body = await parseBody(c, VoiceSttRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const started = Date.now();
  const mode: VoiceTransportMode = req.mode ?? 'on-ship-pipeline';
  const nodeLabel: VoiceNodeLabel = mode === 'on-ship-pipeline' ? 'on-ship-local' : 'gemini-live';
  const headerKey = keyFromHeader(c) || c.req.header('X-Argus-Api-Key')?.trim();
  // On-ship tier: on-ship speech first; Earth speech stands in unless strict (spec 04 §4.2).
  const geminiKey = req.tier === 'autonomous' && onShipStrict() ? undefined : resolveGeminiApiKey(process.env, headerKey);
  const localSpeech = currentPrivacy().offlineOnly ? null : localSpeechConfig();

  let transcript = '';
  let usedLiveStt = false;
  let usedLocalStt = false;

  if (req.tier === 'autonomous' && req.audioBase64 && localSpeech) {
    const local = await localTranscribe(localSpeech, req.audioBase64, req.mimeType, req.languageCode);
    if (local) {
      transcript = local;
      usedLocalStt = true;
    }
  }

  const primarySttModel = process.env.GEMINI_STT_MODEL?.trim() || 'gemini-3.8-flash';
  let liveSttModel = primarySttModel;
  if (!transcript && req.audioBase64 && geminiKey) {
    try {
      const mimeType = (req.mimeType || 'audio/webm').split(';')[0].trim();
      const sttModel = primarySttModel;
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          model: sttModel,
          input: [
            {
              type: 'text',
              text: 'Transcribe the astronaut speech verbatim. Return only the spoken words with no extra commentary.',
            },
            {
              type: 'audio',
              data: req.audioBase64,
              mime_type: mimeType,
            },
          ],
        }),
        signal: AbortSignal.timeout(12_000),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          output_text?: string;
          outputs?: Array<{ type?: string; text?: string }>;
          steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
        };
        const extracted =
          data.output_text?.trim() ||
          data.outputs
            ?.filter((o) => o.type === 'text' && o.text)
            .map((o) => o.text!.trim())
            .join(' ')
            .trim() ||
          data.steps
            ?.filter((s) => s.type === 'model_output')
            .flatMap((s) => s.content ?? [])
            .filter((part) => part.type === 'text' && part.text)
            .map((part) => part.text!.trim())
            .join(' ')
            .trim() ||
          '';
        if (extracted) {
          transcript = extracted;
          usedLiveStt = true;
        }
      }
    } catch (err) {
      console.warn('[ARGUS Voice STT] Behind-the-scenes transcription fallback:', err);
    }
  }

  if (!transcript && req.audioBase64 && geminiKey) {
    const mimeType = (req.mimeType || 'audio/webm').split(';')[0].trim();
    const fallback = await fallbackTranscribe(geminiKey, req.audioBase64, mimeType);
    if (fallback) {
      transcript = fallback;
      usedLiveStt = true;
      liveSttModel = FALLBACK_STT_MODEL;
    }
  }

  if (!transcript && !usedLocalStt && req.tier !== 'autonomous' && req.audioBase64 && localSpeech) {
    const local = await localTranscribe(localSpeech, req.audioBase64, req.mimeType, req.languageCode);
    if (local) {
      transcript = local;
      usedLocalStt = true;
    }
  }

  if (!transcript) {
    // With a tier the caller is the unified console: an empty transcript means "heard nothing".
    transcript = req.fallbackTranscript?.trim() || (req.tier ? '' : 'Check my current readiness and zone vitals.');
  }

  const crisis = detectCrisisLanguage(transcript);
  const urgency: EarthConsultUrgency = crisis.crisis ? 'immediate_emergency_packet' : 'routine_downlink';

  const envelope: AiEnvelope<VoiceSttResponse> = {
    result: {
      transcript,
      mode,
      nodeLabel,
      pipelineStage: 'stt',
      crisisFlag: crisis.crisis,
      earthConsultUrgency: urgency,
      confidence: usedLiveStt ? 0.96 : 0.9,
    },
    meta: usedLocalStt
      ? { source: 'live_ai', provider: 'local', model: localSpeech!.sttModel, latencyMs: Date.now() - started }
      : usedLiveStt
        ? {
            source: 'live_ai',
            provider: req.tier ? 'gemini' : mode === 'on-ship-pipeline' ? 'local' : 'gemini',
            model: req.tier ? liveSttModel : mode === 'on-ship-pipeline' ? 'on-ship-stt-v1' : liveSttModel === FALLBACK_STT_MODEL ? FALLBACK_STT_MODEL : DEFAULT_STT_MODEL,
            latencyMs: Date.now() - started,
          }
        : OFFLINE_META,
  };
  return c.json(envelope);
});

// ── 3. POST /api/ai/tts ──────────────────────────────────────────────────────

voiceRoutes.post('/tts', async (c) => {
  const body = await parseBody(c, VoiceTtsRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const started = Date.now();
  const mode: VoiceTransportMode = req.mode ?? 'on-ship-pipeline';
  const nodeLabel: VoiceNodeLabel = mode === 'on-ship-pipeline' ? 'on-ship-local' : 'gemini-live';
  const cleanText = req.text.replace(/[*#_`]/g, '').trim();
  const headerKey = keyFromHeader(c) || c.req.header('X-Argus-Api-Key')?.trim();
  const geminiKey = req.tier === 'autonomous' && onShipStrict() ? undefined : resolveGeminiApiKey(process.env, headerKey);
  const localSpeech = currentPrivacy().offlineOnly ? null : localSpeechConfig();
  const localVoiceResponse = async () => {
    if (!localSpeech || !cleanText) return null;
    const local = await localSynthesize(localSpeech, cleanText, req.voice, req.speed);
    if (!local) return null;
    const envelope: AiEnvelope<VoiceTtsResponse> = {
      result: {
        audioBase64: local.audioBase64,
        mimeType: local.mimeType,
        mode,
        nodeLabel: 'on-ship-local',
        pipelineStage: 'tts',
        useBrowserSpeechFallback: false,
        durationEstimateMs: Math.max(1200, cleanText.split(/\s+/).length * 360),
      },
      meta: { source: 'live_ai', provider: 'local', model: localSpeech.ttsModel, latencyMs: Date.now() - started },
    };
    return envelope;
  };
  // On-ship tier: the on-ship voice speaks first.
  if (req.tier === 'autonomous') {
    const local = await localVoiceResponse();
    if (local) return c.json(local);
  }
  const ttsModel = process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const geminiVoice = isGeminiVoice(req.voice) ? req.voice : req.tier ? DEFAULT_GEMINI_VOICE : 'Kore';

  if (geminiKey && cleanText) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          model: ttsModel,
          input: [
            {
              type: 'user_input',
              content: [
                {
                  type: 'text',
                  text: cleanText,
                  annotations: [
                    {
                      type: 'speech_metadata',
                      style: req.style || (req.tier ? 'warm, calm and unhurried, like a trusted doctor talking with a friend' : 'calm, clear clinical flight surgeon'),
                    },
                  ],
                },
              ],
            },
          ],
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [{ voice: geminiVoice }],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          output_audio?: { data?: string; mime_type?: string };
          outputs?: Array<{ type?: string; data?: string; mime_type?: string }>;
          steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }>;
        };
        const audioBlock =
          data.output_audio?.data
            ? data.output_audio
            : data.outputs?.find((o) => o.type === 'audio' && o.data) ||
              data.steps
                ?.filter((s) => s.type === 'model_output')
                .flatMap((s) => s.content ?? [])
                .filter((part) => part.type === 'audio' && part.data)
                .pop();

        if (audioBlock?.data) {
          const envelope: AiEnvelope<VoiceTtsResponse> = {
            result: {
              audioBase64: audioBlock.data,
              mimeType: audioBlock.mime_type || 'audio/wav',
              mode,
              nodeLabel,
              pipelineStage: 'tts',
              useBrowserSpeechFallback: false,
              durationEstimateMs: Math.max(1200, cleanText.split(/\s+/).length * 360),
            },
            meta: {
              source: 'live_ai',
              provider: req.tier ? 'gemini' : mode === 'on-ship-pipeline' ? 'local' : 'gemini',
              model: req.tier ? ttsModel : mode === 'on-ship-pipeline' ? 'on-ship-tts-v1' : ttsModel,
              latencyMs: Date.now() - started,
            },
          };
          return c.json(envelope);
        }
      }
    } catch (err) {
      console.warn('[ARGUS Voice TTS] Behind-the-scenes synthesis fallback:', err);
    }
  }

  if (geminiKey && cleanText) {
    const style = req.style || (req.tier ? 'warm, calm and unhurried' : 'calm, clear clinical');
    const fallback = await fallbackSynthesize(geminiKey, cleanText, geminiVoice, style);
    if (fallback) {
      const envelope: AiEnvelope<VoiceTtsResponse> = {
        result: {
          audioBase64: fallback.audioBase64,
          mimeType: fallback.mimeType,
          mode,
          nodeLabel,
          pipelineStage: 'tts',
          useBrowserSpeechFallback: false,
          durationEstimateMs: Math.max(1200, cleanText.split(/\s+/).length * 360),
        },
        meta: {
          source: 'live_ai',
          provider: mode === 'on-ship-pipeline' && !req.tier ? 'local' : 'gemini',
          model: mode === 'on-ship-pipeline' && !req.tier ? 'on-ship-tts-v1' : FALLBACK_TTS_MODEL,
          latencyMs: Date.now() - started,
        },
      };
      return c.json(envelope);
    }
  }

  if (req.tier !== 'autonomous') {
    const local = await localVoiceResponse();
    if (local) return c.json(local);
  }

  const wavBase64 = synthesizeOfflineCueWavBase64(cleanText);
  const offlineEnvelope: AiEnvelope<VoiceTtsResponse> = {
    result: {
      audioBase64: wavBase64,
      mimeType: 'audio/wav',
      mode,
      nodeLabel,
      pipelineStage: 'tts',
      useBrowserSpeechFallback: true,
      durationEstimateMs: Math.max(1000, cleanText.split(/\s+/).length * 350),
    },
    meta: OFFLINE_META,
  };
  return c.json(offlineEnvelope);
});

// ── 4. POST /api/ai/voice-tool ───────────────────────────────────────────────

voiceRoutes.post('/voice-tool', async (c) => {
  const body = await parseBody(c, VoiceToolCallRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  if (req.toolName === 'lookup_medical_protocol') {
    const snapshot = buildCrewSnapshot(req);
    const worst = worstZoneStatus(snapshot.zoneStatuses);
    const urgency = urgencyFloorForStatus(worst);
    const callId = req.callId || `call-${Date.now()}`;
    const query = (req.args?.query ?? '').trim();
    const lookup = await lookupMedicalProtocol(
      { query, zoneId: req.args?.zoneId },
      { db: c.get('db'), astronautId: req.crewMember?.id ?? null, mode: 'live-api' }
    );
    const summary = lookup.found
      ? `Retrieved ${lookup.chunks.length} verified protocol chunk${lookup.chunks.length === 1 ? '' : 's'}: ${lookup.chunks
          .map((ch) => `${ch.title} — ${ch.heading} [${ch.sourceId}]`)
          .join('; ')}.`
      : lookup.note ?? `No verified protocol matched "${query}".`;
    const result: VoiceToolCallResponse = {
      callId,
      toolName: 'lookup_medical_protocol',
      ok: lookup.found,
      summary,
      readinessScore: snapshot.readinessScore,
      zoneStatuses: snapshot.zoneStatuses,
      earthConsultUrgency: urgency,
      ragHits: lookup.hits,
    };
    const envelope: AiEnvelope<VoiceToolCallResponse> = {
      result,
      meta: OFFLINE_META,
    };
    return c.json(envelope);
  }

  const result = executeVoiceToolCall(req);
  const envelope: AiEnvelope<VoiceToolCallResponse> = {
    result,
    meta: OFFLINE_META,
  };
  return c.json(envelope);
});

// ── 5. POST /api/ai/voice-turn ───────────────────────────────────────────────

voiceRoutes.post('/voice-turn', async (c) => {
  const body = await parseBody(c, VoiceTurnRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const mode: VoiceTransportMode = req.mode ?? 'on-ship-pipeline';
  const nodeLabel: VoiceNodeLabel = mode === 'on-ship-pipeline' ? 'on-ship-local' : 'gemini-live';
  const transcript = req.transcript.trim() || 'Status check';

  const snapshot = buildCrewSnapshot(req);
  const crisis = detectCrisisLanguage(transcript);
  const db = c.get('db');

  // Execute deterministic inline vital logging if spoken by the astronaut
  const toolCallsExecuted: VoiceToolCallResponse[] = [];
  const spokenCommand = parseSpokenVitalLogCommand(transcript);
  if (spokenCommand) {
    toolCallsExecuted.push(
      executeVoiceToolCall({
        ...req,
        toolName: 'log_checkin_reading',
        callId: `voice-auto-${Date.now()}`,
        args: spokenCommand,
      })
    );
  }

  // Hybrid RAG retrieval (specs/04-ai-backend.md §4.2): retrieve verified clinical chunks for the spoken query
  const ragResult = await searchKnowledge({
    query: transcript,
    zoneId: inferVoiceZone(transcript, snapshot),
    limit: 3,
    db,
  });
  const ragHits = ragResult.hits;
  const ragReferenceBlock = formatKnowledgeForPrompt(ragHits);

  const effectiveZoneStatuses =
    toolCallsExecuted[0]?.ok ? toolCallsExecuted[0].zoneStatuses : snapshot.zoneStatuses;
  const effectiveReadinessScore =
    toolCallsExecuted[0]?.ok ? toolCallsExecuted[0].readinessScore : snapshot.readinessScore;

  const offlineFallback = buildOfflineVoiceReply(snapshot, transcript, toolCallsExecuted, ragHits);
  const deterministicStatus: TriageStatus = crisis.crisis
    ? 'red'
    : maxTriageStatus(worstZoneStatus(effectiveZoneStatuses), offlineFallback.triageStatus);
  const deterministicUrgencyFloor: EarthConsultUrgency = crisis.crisis
    ? 'immediate_emergency_packet'
    : maxUrgency(urgencyFloorForStatus(deterministicStatus), offlineFallback.earthConsultUrgency);

  let replyText = req.existingReplyText?.trim() ?? '';
  let llmMeta = OFFLINE_META;

  if (!replyText) {
    const userContent: ChatMessage['content'] =
      req.imageBase64 && req.imageMimeType
        ? [
            {
              type: 'text',
              text: `Astronaut spoken input: "${transcript}"\n${
                toolCallsExecuted.length
                  ? `Deterministic tool result: ${toolCallsExecuted.map((t) => t.summary).join(' ')}\n`
                  : ''
              }${jsonInstruction('{\n  "replyText": "2-4 spoken sentences",\n  "earthConsultUrgency": "routine_downlink | priority_packet | immediate_emergency_packet"\n}')}`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${req.imageMimeType};base64,${req.imageBase64}` },
            },
          ]
        : `Astronaut spoken input: "${transcript}"\n${
            toolCallsExecuted.length
              ? `Deterministic tool result: ${toolCallsExecuted.map((t) => t.summary).join(' ')}\n`
              : ''
          }${jsonInstruction('{\n  "replyText": "2-4 spoken sentences",\n  "earthConsultUrgency": "routine_downlink | priority_packet | immediate_emergency_packet"\n}')}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: buildVoiceSystemInstruction(snapshot, mode, ragReferenceBlock) },
      ...(req.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: 'user', content: userContent },
    ];

    const llm = await completeJson(VoiceTurnLlmSchema, messages, {
      feature: 'chat',
      keyOverride: keyFromHeader(c),
      vision: Boolean(req.imageBase64),
      temperature: 0.3,
      maxTokens: 600,
    });

    if (llm) {
      replyText = llm.data.replyText.trim();
      llmMeta =
        mode === 'on-ship-pipeline'
          ? {
              source: 'live_ai',
              provider: 'local',
              model: 'on-ship-local-llm',
              latencyMs: llm.latencyMs,
            }
          : liveMeta(llm);
    } else {
      replyText = offlineFallback.replyText;
    }
  } else {
    llmMeta = {
      source: 'live_ai',
      provider: mode === 'on-ship-pipeline' ? 'local' : 'gemini',
      model: mode === 'on-ship-pipeline' ? 'on-ship-local-llm' : DEFAULT_LIVE_MODEL,
    };
  }

  // Deterministic crisis escalation preamble (AGENTS.md §2.4, specs/04-ai-backend.md §4)
  if (crisis.crisis && !replyText.includes(CRISIS_ESCALATION_MESSAGE)) {
    replyText = `${CRISIS_ESCALATION_MESSAGE} ${replyText}`;
  }

  // Optional inline TTS synthesis when requested
  const stagesCompleted: Array<'stt' | 'llm' | 'tts'> = ['stt', 'llm'];
  let audioBase64: string | undefined;
  let audioMimeType: string | undefined;
  let useBrowserSpeechFallback = true;

  if (req.synthesizeAudio) {
    stagesCompleted.push('tts');
    audioBase64 = synthesizeOfflineCueWavBase64(replyText);
    audioMimeType = 'audio/wav';
  }

  // Audit & Persistence (specs/05-data-platform.md §3.5 & §3.6): log voice turns and RAG citations to Postgres when DATABASE_URL is active
  const user = c.get('user');
  const astronautId = req.crewMember?.id;
  if (db && astronautId && transcript) {
    try {
      const conversationId = await getOrStartConversation(db, astronautId, user?.id ?? null);
      await logMessage(db, {
        conversationId,
        role: 'user',
        authorUserId: user?.id ?? null,
        content: transcript,
        crisisFlag: crisis.crisis,
      });
      const assistantMessageId = await logMessage(db, {
        conversationId,
        role: 'assistant',
        content: replyText,
        provider: llmMeta.provider ?? null,
        model: llmMeta.model ?? null,
        source: llmMeta.source === 'live_ai' ? 'ai' : 'offline_verified_cache',
        contextSnapshot: {
          voiceMode: mode,
          nodeLabel,
          scenarioId: snapshot.scenarioId,
          locationId: req.locationId ?? null,
          readinessScore: effectiveReadinessScore,
          zoneStatuses: effectiveZoneStatuses,
          toolCallsExecuted: toolCallsExecuted.map((t) => ({
            toolName: t.toolName,
            ok: t.ok,
            loggedReading: t.loggedReading ?? null,
          })),
          citations: ragHits.map((h) => ({
            documentId: h.documentId,
            sourceId: h.sourceId,
            rank: h.rank,
          })),
        },
        triageEventId: await latestTriageEventId(db, astronautId),
        crisisFlag: crisis.crisis,
      });
      if (ragHits.length > 0) {
        await logCitations(db, {
          mode: mode === 'live-api' ? 'live-api' : 'on-ship-pipeline',
          query: transcript,
          hits: ragHits,
          astronautId,
          messageId: assistantMessageId,
        });
      }
    } catch (err) {
      console.error('[ARGUS Voice] could not store voice turn in database', err);
    }
  }

  const envelope: AiEnvelope<VoiceTurnResponse> = {
    result: {
      transcript,
      replyText,
      mode,
      nodeLabel,
      pipelineStagesCompleted: stagesCompleted,
      audioBase64,
      audioMimeType,
      useBrowserSpeechFallback,
      crisisFlag: crisis.crisis,
      triageStatus: deterministicStatus,
      readinessScore: effectiveReadinessScore,
      zoneStatuses: effectiveZoneStatuses,
      earthConsultUrgency: deterministicUrgencyFloor,
      toolCallsExecuted,
      ragHits,
      disclaimer: VOICE_CLINICAL_DISCLAIMER,
    },
    meta: llmMeta,
  };
  return c.json(envelope);
});

// ── 6. GET /api/ai/voices ────────────────────────────────────────────────────

/** Voices the crew can choose, per engine, and which engines are reachable right now. */
voiceRoutes.get('/voices', async (c) => {
  const headerKey = keyFromHeader(c) || c.req.header('X-Argus-Api-Key')?.trim();
  const geminiKey = resolveGeminiApiKey(process.env, headerKey);
  const localSpeech = currentPrivacy().offlineOnly ? null : localSpeechConfig();
  const localUp = localSpeech ? await probeLocalSpeech(localSpeech) : false;
  const body: VoicesResponse = {
    voices: [...GEMINI_VOICES, ...LOCAL_VOICES],
    defaults: { gemini: DEFAULT_GEMINI_VOICE, local: localSpeech?.defaultVoice ?? LOCAL_VOICES[0].id },
    engines: {
      gemini: { available: Boolean(geminiKey), model: process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL },
      local: { available: localUp, model: localSpeech?.ttsModel },
    },
  };
  return c.json(body);
});
