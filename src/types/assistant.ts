/**
 * ARGUS unified assistant: one conversation that is both onboard doctor and therapist
 * (specs/04-ai-backend.md §4.2–§4.4). Shared by the HUD and the server.
 */

import type { CommTier } from '../../shared/commProfile';
import type { RedFlagProtocolId } from '../../shared/redFlags';
import type { BodyZoneId, TriageStatus } from './argus';
import type { AiResultMeta, CrewContextRequest, EarthConsultUrgency, WellbeingCheckIn } from './aiApi';

// ── Conversation ─────────────────────────────────────────────────────────────

export type AssistantRole = 'user' | 'assistant' | 'earth';
export type AssistantModality = 'text' | 'voice';

/** One message in the single ARGUS thread (replaces the three older message types). */
export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  content: string;
  timestampIso: string;
  modality?: AssistantModality;
  /** Actions that fired with this message. */
  actions?: AssistantAction[];
  /** Where the reply came from. */
  meta?: AiResultMeta;
  tier?: CommTier;
  crisis?: boolean;
  /** True while tokens are still arriving. */
  streaming?: boolean;
  /** Earth doctor's name for `role: 'earth'`. */
  author?: string;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type CountermeasureKind =
  | 'breathing'
  | 'sleep'
  | 'exercise'
  | 'social'
  | 'workload'
  | 'grounding'
  | 'nutrition'
  | 'medical';

export interface CountermeasureSuggestion {
  id: string;
  kind: CountermeasureKind;
  title: string;
  /** What to do, in one or two plain sentences. */
  instruction: string;
  durationMinutes: number;
}

export type AssistantActionOrigin = 'fast_path' | 'model';

/** Something the assistant does in the HUD, alongside what it says. */
export type AssistantAction = { origin: AssistantActionOrigin } & (
  | { type: 'start_emergency_protocol'; protocolId: RedFlagProtocolId; reason: string }
  | { type: 'mark_step_done'; stepNumber: number }
  | {
      type: 'log_checkin_reading';
      metricId: string;
      value: number;
      zoneId?: BodyZoneId;
      note?: string;
      /** Deterministic status of the logged value, when the server could compute it. */
      status?: TriageStatus;
      ok: boolean;
      message?: string;
    }
  | { type: 'set_guided_steps'; title: string; steps: string[] }
  | { type: 'queue_earth_packet'; urgency: EarthConsultUrgency; note: string }
  | { type: 'request_visual_check'; target: string }
  | { type: 'suggest_countermeasure'; suggestion: CountermeasureSuggestion }
);

export type AssistantActionType = AssistantAction['type'];

// ── Camera observation (computed on-device, never a diagnosis) ───────────────

export type ObservedLevel = 'low' | 'moderate' | 'high';
export type ObservedAffect = 'neutral' | 'positive' | 'tense' | 'flat' | 'unknown';
export type ObservedPosture = 'upright' | 'slumped' | 'leaning' | 'unknown';

/** Rolling summary of what the camera sees (specs/04-ai-backend.md §4.3). */
export interface VisualObservation {
  capturedAtIso: string;
  /** Seconds of video the summary covers. */
  windowSec: number;
  facePresent: boolean;
  /** Share of the window with a face in frame, 0–1. */
  presenceRatio: number;
  blinkRatePerMin: number | null;
  /** Share of time the eyes were ≥ 80 % closed, 0–1 (PERCLOS) [SRC-091]. */
  perclos: number | null;
  yawnsPerMin: number | null;
  affect: ObservedAffect;
  fatigue: ObservedLevel | null;
  posture: ObservedPosture;
  /** Head movement: fidgeting vs still. */
  restlessness: ObservedLevel | null;
  /** Camera pulse estimate (rPPG). An estimate only: never logged as a vital [SRC-093]. */
  pulseBpmEstimate: number | null;
  pulseConfidence: number | null;
  /** Short plain-language notes shown as overlay chips. */
  notes: string[];
}

// ── Mental state ─────────────────────────────────────────────────────────────

export type ConcernLevel = 'none' | 'watch' | 'concern' | 'urgent';

/** Cue strengths, 0 = absent … 3 = strong. */
export interface MentalStateCues {
  lowMood: number;
  stress: number;
  anxiety: number;
  sleepProblem: number;
  isolation: number;
  conflict: number;
  lowMotivation: number;
  hopelessness: number;
  fatigue: number;
}

export type MentalStateCueId = keyof MentalStateCues;

export interface MentalStateEvidence {
  source: 'conversation' | 'camera' | 'self_report' | 'physiology';
  text: string;
}

export interface MentalStateAssessment {
  assessedAtIso: string;
  cues: MentalStateCues;
  mood: 'good' | 'ok' | 'low' | 'very_low';
  stress: ObservedLevel;
  fatigue: ObservedLevel;
  /** Set by a deterministic combiner; a model can raise it, never lower it. */
  concernLevel: ConcernLevel;
  /** 0–100, higher = more concern. */
  score: number;
  trend: 'improving' | 'stable' | 'worsening';
  evidence: MentalStateEvidence[];
  /** One or two sentences for the crew member and the Earth report. */
  summary: string;
}

// ── /api/ai/converse ─────────────────────────────────────────────────────────

export interface ActiveProtocolContext {
  protocolId: RedFlagProtocolId;
  title: string;
  steps: string[];
  /** 1-based step numbers already done. */
  completedSteps: number[];
}

export interface ConverseRequest extends CrewContextRequest {
  messages: Array<{ role: AssistantRole; content: string; timestampIso?: string }>;
  modality: AssistantModality;
  /** Crew-selected tier; the server can only move it further from Earth dependence. */
  tierOverride?: CommTier;
  /** Current camera frame (JPEG/PNG, base64 without the data-URL prefix). */
  frame?: { base64Data: string; mimeType: string };
  observation?: VisualObservation;
  activeProtocol?: ActiveProtocolContext;
  /** Guided steps currently on screen, so "done" can be mapped to a step. */
  guidedSteps?: string[];
  checkIns?: WellbeingCheckIn[];
  /** Last assessment, so the trend and "never lower within a session" rule can be applied. */
  previousAssessment?: MentalStateAssessment;
  /** Countermeasures already suggested this session (ids) and whether they helped. */
  countermeasureLog?: Array<{ id: string; title: string; helped?: boolean }>;
}

export type ConverseEvent =
  | {
      type: 'meta';
      meta: AiResultMeta;
      tier: CommTier;
      crisis: boolean;
      redFlag: boolean;
      earthConsultUrgency: EarthConsultUrgency;
    }
  | { type: 'action'; action: AssistantAction }
  | { type: 'delta'; text: string }
  /** The spoken/written reply is complete; the assessment may still follow. */
  | { type: 'reply_end' }
  | { type: 'assessment'; assessment: MentalStateAssessment }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ── Speech ───────────────────────────────────────────────────────────────────

export type VoiceEngineId = 'gemini' | 'local' | 'browser';

export interface VoiceOption {
  id: string;
  label: string;
  engine: VoiceEngineId;
  /** Short character note, e.g. "Warm", "Firm". */
  style?: string;
  language?: string;
}

export interface VoicesResponse {
  voices: VoiceOption[];
  defaults: Partial<Record<VoiceEngineId, string>>;
  engines: Record<Exclude<VoiceEngineId, 'browser'>, { available: boolean; model?: string }>;
}
