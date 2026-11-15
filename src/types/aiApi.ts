/**
 * ARGUS — AI Backend API Contract (shared by `server/` and the React client)
 * Single Source of Truth: specs/04-ai-backend.md
 *
 * Guardrail (AGENTS.md §2.4): every TriageStatus below is computed deterministically
 * by `src/utils/triageEngine.ts` or the server's deterministic models — never by an LLM.
 */

import type {
  BodyZoneId,
  CheckInEntry,
  CrewMemberProfile,
  FlightSurgeonGuidance,
  GravityEnvironment,
  MetricId,
  ScenarioId,
  SpaceLocationId,
  TriageStatus,
  VisualExamAnalysis,
  VisualExamSample,
} from './argus';

// ── Providers ────────────────────────────────────────────────────────────────

export type AiProviderId = 'local' | 'gemini' | 'groq' | 'custom';

export type AiFeature =
  | 'guidance'
  | 'vision'
  | 'diagnostics'
  | 'recommendations'
  | 'wellbeing'
  | 'chat';

export type AiSource = 'live_ai' | 'offline_verified_cache';

export type EarthConsultUrgency = FlightSurgeonGuidance['earthConsultUrgency'];

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  model: string;
  visionModel?: string;
  hasKey: boolean;
  isLocal: boolean;
  /** Only present when `/api/health?probe=1` was requested. */
  reachable?: boolean;
}

export interface AiProviderStatus {
  aiAvailable: boolean;
  visionAvailable: boolean;
  /** Ordered fallback chain used when no per-feature route is configured. */
  chain: AiProviderInfo[];
  /** Per-feature chains (only features with an `AI_ROUTE_<FEATURE>` override). */
  routes: Partial<Record<AiFeature, AiProviderId[]>>;
}

export interface AiResultMeta {
  source: AiSource;
  provider?: AiProviderId;
  model?: string;
  latencyMs?: number;
}

export interface AiEnvelope<T> {
  result: T;
  meta: AiResultMeta;
}

// ── Requests ─────────────────────────────────────────────────────────────────

export interface CrewContextRequest {
  crewMember?: CrewMemberProfile;
  scenarioId: ScenarioId;
  environment?: GravityEnvironment;
  /** Mission location (specs/01-data-schema.md §8); added to prompts. */
  locationId?: SpaceLocationId;
  /** Sprint 7 vital check-ins (specs/01-data-schema.md §6); overlaid via `applyCheckIns` before triage/trends. */
  telemetryCheckIns?: CheckInEntry[];
}

export interface GuidanceRequest extends CrewContextRequest {
  zoneId: BodyZoneId;
  crewSymptoms?: string;
}

export interface VisionRequest {
  sampleId?: VisualExamSample['id'];
  uploadedFile?: { fileName: string; base64Data: string; mimeType: string };
  environment?: GravityEnvironment;
}

export type GuidanceResponse = AiEnvelope<FlightSurgeonGuidance>;
export type VisionResponse = AiEnvelope<VisualExamAnalysis>;

// ── Trend models (deterministic) ─────────────────────────────────────────────

export type TrendLevel = 'steady' | 'watch' | 'drifting';
export type TrendDirection = 'up' | 'down' | 'flat';

export interface MetricTrend {
  metricId: string;
  label: string;
  unit: string;
  zoneId: BodyZoneId;
  currentValue: number;
  status: TriageStatus;
  /** OLS slope over the last 10 mission days (units per day). */
  slopePerDay: number;
  /** Latest value vs. personal baseline (first 7 days), in SDs. */
  zScore: number;
  /** EWMA-smoothed z-score (alpha 0.3). */
  ewmaZ: number;
  level: TrendLevel;
  direction: TrendDirection;
  /** Projected mission days until the red band at the current slope (0 = already red). */
  daysToRed: number | null;
  /** Regression projection 3 days ahead. */
  forecast3d: number | null;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export type Likelihood = 'low' | 'moderate' | 'high';

export interface DiagnosticHypothesis {
  id: string;
  condition: string;
  hrpRisk: string;
  likelihood: Likelihood;
  /** 0–1 */
  confidence: number;
  supportingMetricIds: string[];
  rationale: string;
  suggestedConfirmation: string;
}

export interface DiagnosticsReport {
  crewId?: string;
  scenarioId: ScenarioId;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  readinessScore: number;
  trends: MetricTrend[];
  flaggedTrends: MetricTrend[];
  hypotheses: DiagnosticHypothesis[];
  summary: string;
  earthConsultUrgency: EarthConsultUrgency;
  disclaimer: string;
  generatedAtIso: string;
}

export type DiagnosticsResponse = AiEnvelope<DiagnosticsReport>;

// ── Recommendations ──────────────────────────────────────────────────────────

export type CountermeasureCategory =
  | 'exercise'
  | 'sleep'
  | 'nutrition'
  | 'radiation'
  | 'environment'
  | 'behavioral'
  | 'medical_check';

export type RecommendationPriority = 'now' | 'today' | 'this_week';

export interface CountermeasureRecommendation {
  id: string;
  category: CountermeasureCategory;
  title: string;
  plainInstruction: string;
  rationale: string;
  targetMetricIds: string[];
  priority: RecommendationPriority;
  durationMinutes: number;
}

export interface CountermeasurePlan {
  crewId?: string;
  scenarioId: ScenarioId;
  headline: string;
  recommendations: CountermeasureRecommendation[];
  generatedAtIso: string;
}

export type RecommendationsResponse = AiEnvelope<CountermeasurePlan>;

// ── Mental health / wellbeing ────────────────────────────────────────────────

/** Daily behavioral-health self-report. All scales 1–5 (stress: 5 = most stressed). */
export interface WellbeingCheckIn {
  id: string;
  crewId: string;
  missionDay: number;
  timestampIso: string;
  mood: number;
  stress: number;
  energy: number;
  sleepQuality: number;
  cohesion: number;
  motivation: number;
  note?: string;
}

export interface WellbeingFactor {
  id: string;
  label: string;
  /** Contribution to the risk score in points. */
  impact: number;
  detail: string;
}

export type WellbeingTrend = 'improving' | 'stable' | 'worsening';

export interface WellbeingAssessment {
  crewId?: string;
  /** 0–100, higher = more behavioral-health risk. Deterministic. */
  riskScore: number;
  status: TriageStatus;
  trend: WellbeingTrend;
  factors: WellbeingFactor[];
  crisisFlag: boolean;
  earthConsultUrgency: EarthConsultUrgency;
  supportiveMessage: string;
  suggestedActions: string[];
  generatedAtIso: string;
}

export interface WellbeingRequest extends CrewContextRequest {
  checkIns: WellbeingCheckIn[];
}

export type WellbeingResponse = AiEnvelope<WellbeingAssessment>;

// ── Crew companion chat ──────────────────────────────────────────────────────

export interface CrewChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestampIso?: string;
}

export interface ChatRequest extends CrewContextRequest {
  messages: CrewChatMessage[];
  checkIns?: WellbeingCheckIn[];
}

/** Server-Sent Events emitted by `POST /api/ai/chat` (event name = `type`). */
export type ChatStreamEvent =
  | {
      type: 'meta';
      meta: AiResultMeta;
      crisis: boolean;
      earthConsultUrgency: EarthConsultUrgency;
      ragHits?: RagHit[];
    }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ── Real-Time Voice & Video Flight Surgeon (specs/04-ai-backend.md §4.1) ─────

export type VoiceTransportMode = 'live-api' | 'on-ship-pipeline';

export type VoiceNodeLabel = 'gemini-live' | 'on-ship-local';

export type VoicePipelineStage =
  | 'idle'
  | 'connecting'
  | 'listening_stt'
  | 'thinking_llm'
  | 'speaking_tts'
  | 'live_streaming'
  | 'tool_calling'
  | 'error';

export type VoiceToolName = 'get_crew_snapshot' | 'log_checkin_reading' | 'lookup_medical_protocol';

export interface VoiceToolDeclaration {
  name: VoiceToolName;
  description: string;
  behavior: 'NON_BLOCKING';
  parameters: Record<string, unknown>;
}

export interface LiveTokenRequest extends CrewContextRequest {
  /** Manual Simulated Comm Blackout / Offline Mode override from the HUD. */
  forceOffline?: boolean;
  /** Whether live webcam frame streaming is enabled for the session. */
  enableVideo?: boolean;
}

export interface LiveTokenResponse {
  available: boolean;
  mode: VoiceTransportMode;
  nodeLabel: VoiceNodeLabel;
  recommendedMode?: VoiceTransportMode;
  token?: string;
  wsUrl?: string;
  model?: string;
  expiresAtIso?: string;
  systemInstruction: string;
  tools: VoiceToolDeclaration[];
  snapshotSummary?: {
    readinessScore: number;
    zoneStatuses: Record<BodyZoneId, TriageStatus>;
    earthConsultUrgency: EarthConsultUrgency;
  };
  disclaimer?: string;
}

export type LiveTokenEnvelope = AiEnvelope<LiveTokenResponse>;

export interface VoiceSttRequest extends CrewContextRequest {
  audioBase64?: string;
  mimeType?: string;
  fallbackTranscript?: string;
  mode?: VoiceTransportMode;
  languageCode?: string;
  /** Comm tier; `autonomous` keeps transcription on the ship. */
  tier?: 'live' | 'relay' | 'autonomous';
}

export interface VoiceSttResponse {
  transcript: string;
  mode: VoiceTransportMode;
  nodeLabel: VoiceNodeLabel;
  pipelineStage: 'stt';
  crisisFlag: boolean;
  earthConsultUrgency: EarthConsultUrgency;
  confidence: number;
}

export type VoiceSttEnvelope = AiEnvelope<VoiceSttResponse>;

export interface VoiceTtsRequest {
  text: string;
  voice?: string;
  style?: string;
  mode?: VoiceTransportMode;
  /** Comm tier; `autonomous` keeps synthesis on the ship. */
  tier?: 'live' | 'relay' | 'autonomous';
  speed?: number;
}

export interface VoiceTtsResponse {
  audioBase64: string;
  mimeType: string;
  mode: VoiceTransportMode;
  nodeLabel: VoiceNodeLabel;
  pipelineStage: 'tts';
  useBrowserSpeechFallback: boolean;
  durationEstimateMs: number;
}

export type VoiceTtsEnvelope = AiEnvelope<VoiceTtsResponse>;

export interface VoiceToolCallRequest extends CrewContextRequest {
  toolName: VoiceToolName;
  callId?: string;
  args?: {
    zoneId?: BodyZoneId;
    metricId?: MetricId | string;
    value?: number;
    note?: string;
    query?: string;
  };
}

export interface VoiceToolCallResponse {
  callId: string;
  toolName: VoiceToolName;
  ok: boolean;
  summary: string;
  readinessScore: number;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  loggedReading?: {
    zoneId: BodyZoneId;
    metricId: MetricId;
    value: number;
    status: TriageStatus;
  };
  ragHits?: RagHit[];
  earthConsultUrgency: EarthConsultUrgency;
}

export type VoiceToolCallEnvelope = AiEnvelope<VoiceToolCallResponse>;

export interface VoiceTurnRequest extends CrewContextRequest {
  transcript: string;
  /** Optional pre-synthesized reply from a Live API WebSocket turn (persisted & checked for guardrails). */
  existingReplyText?: string;
  audioBase64?: string;
  audioMimeType?: string;
  imageBase64?: string;
  imageMimeType?: string;
  mode?: VoiceTransportMode;
  synthesizeAudio?: boolean;
  history?: CrewChatMessage[];
}

export interface VoiceTurnResponse {
  transcript: string;
  replyText: string;
  mode: VoiceTransportMode;
  nodeLabel: VoiceNodeLabel;
  pipelineStagesCompleted: Array<'stt' | 'llm' | 'tts'>;
  audioBase64?: string;
  audioMimeType?: string;
  useBrowserSpeechFallback: boolean;
  crisisFlag: boolean;
  triageStatus: TriageStatus;
  readinessScore: number;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  earthConsultUrgency: EarthConsultUrgency;
  toolCallsExecuted: VoiceToolCallResponse[];
  ragHits?: RagHit[];
  disclaimer: string;
}

export type VoiceTurnEnvelope = AiEnvelope<VoiceTurnResponse>;

// ── AI knowledge base (RAG) — specs/04-ai-backend.md §4.2, specs/05-data-platform.md §3.6 ──
export type RagDocKind = 'emergency_checklist' | 'countermeasure' | 'clinical_reference' | 'medication';
export type RagRetrievalMode = 'db' | 'memory';
export type RagCitationMode = 'search' | 'chat' | 'live-api' | 'on-ship-pipeline';

export interface RagSearchRequest {
  query: string;
  zoneId?: BodyZoneId;
  /** 1–10, default 5. */
  limit?: number;
  mode?: RagCitationMode;
  /** `messages.id` the retrieval belongs to, for the citation log. */
  messageId?: string;
  crewMember?: { id: string };
}

export interface RagHit {
  /** `rag_chunks.id`; null when served from the in-memory corpus. */
  chunkId: string | null;
  documentId: string;
  /** `SRC-xxx`; null for in-repo content without a registered source. */
  sourceId: string | null;
  title: string;
  kind: RagDocKind;
  origin: string;
  zoneIds: string[];
  heading: string;
  content: string;
  rank: number;
  score: number;
  keywordRank: number | null;
  vectorRank: number | null;
}

export interface RagSearchResponse {
  hits: RagHit[];
  retrieval: RagRetrievalMode;
  embeddingModel: string | null;
  latencyMs: number;
}

export interface RagStatus {
  retrieval: RagRetrievalMode;
  documents: number;
  chunks: number;
  embeddedChunks: number;
  embeddingModel: string;
}

export type RagSearchEnvelope = AiEnvelope<RagSearchResponse>;
export type RagStatusEnvelope = AiEnvelope<RagStatus>;
