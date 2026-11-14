/**
 * ARGUS — AI Backend API Contract (shared by `server/` and the React client)
 * Single Source of Truth: specs/04-ai-backend.md
 *
 * Guardrail (AGENTS.md §2.4): every TriageStatus below is computed deterministically
 * by `src/utils/triageEngine.ts` or the server's deterministic models — never by an LLM.
 */

import type {
  BodyZoneId,
  CrewMemberProfile,
  FlightSurgeonGuidance,
  GravityEnvironment,
  ScenarioId,
  TriageStatus,
  VisualExamAnalysis,
  VisualExamSample,
} from './argus';

// ── Providers ────────────────────────────────────────────────────────────────

export type AiProviderId = 'local' | 'openrouter' | 'gemini' | 'groq' | 'custom';

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
    }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
