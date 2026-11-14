/**
 * ARGUS — Flight Surgeon AI service (client side)
 * Single Source of Truth: specs/00-architecture.md, specs/01-data-schema.md (§4), specs/03-ai-backend.md
 *
 * All model calls now run on the ARGUS backend (`server/`), which picks a free/local provider
 * and falls back to offline protocols. If the backend itself is unreachable, the same offline
 * protocols are served locally, so the HUD keeps working as a static demo.
 *
 * Architectural Guardrail (AGENTS.md): deterministic Green/Yellow/Red triage status is ALWAYS
 * computed by `triageEngine.ts` and never overridden by the LLM.
 */

import {
  BodyZoneId,
  CrewMemberProfile,
  FlightSurgeonGuidance,
  GravityEnvironment,
  ScenarioId,
  VisualExamAnalysis,
  VisualExamSample,
} from '../types/argus';
import { getOfflineFlightSurgeonGuidance } from '../data/telemetryScenarios';
import { argusApi, fetchAiStatus, getCachedAiStatus } from './argusApi';

/** Kept for UI labels; the actual model is chosen by the backend provider chain. */
export const CLINICAL_AI_MODEL_ID = 'argus-backend';

// Warm the provider-status cache so the HUD badge can reflect backend availability.
void fetchAiStatus();

/**
 * True when live AI is possible: either a key was typed into the HUD, or the backend reports
 * at least one configured provider (local model or free cloud key).
 */
export function hasConfiguredAiKey(runtimeKey?: string): boolean {
  if (runtimeKey && runtimeKey.trim().length > 0) return true;
  return Boolean(getCachedAiStatus()?.aiAvailable);
}

export async function synthesizeFlightSurgeonGuidance(params: {
  scenarioId: ScenarioId;
  zoneId: BodyZoneId;
  environment: GravityEnvironment;
  crewMember?: CrewMemberProfile;
  runtimeApiKey?: string;
  forceLiveAi?: boolean;
}): Promise<FlightSurgeonGuidance> {
  const { scenarioId, zoneId, environment, crewMember, runtimeApiKey, forceLiveAi } = params;
  const offline = getOfflineFlightSurgeonGuidance(scenarioId, zoneId, environment, crewMember);
  if (!forceLiveAi) return offline;

  try {
    const { result } = await argusApi.guidance({ scenarioId, zoneId, environment, crewMember }, runtimeApiKey);
    return result;
  } catch (err) {
    console.warn('[ARGUS AI] Backend unavailable — using offline verified NASA HRP guidance:', err);
    return offline;
  }
}

export async function analyzeVisualSelfExam(params: {
  sample?: VisualExamSample;
  uploadedFile?: { fileName: string; base64Data: string; mimeType: string };
  environment: GravityEnvironment;
  runtimeApiKey?: string;
}): Promise<VisualExamAnalysis> {
  const { sample, uploadedFile, environment, runtimeApiKey } = params;
  try {
    const { result } = await argusApi.vision({ sampleId: sample?.id, uploadedFile, environment }, runtimeApiKey);
    return result;
  } catch (err) {
    console.warn('[ARGUS Vision] Backend unavailable — using offline verified analysis:', err);
    const nowIso = new Date().toISOString();
    return sample
      ? {
          sampleIdOrFileName: sample.title,
          modality: sample.modality,
          findingStatus: sample.defaultFindingStatus,
          clinicalSummary: sample.clinicalSummary,
          plainCrewGuidance: sample.plainCrewGuidance,
          recommendedAction: sample.recommendedAction,
          analyzedAtIso: nowIso,
          source: 'offline_verified_cache',
        }
      : {
          sampleIdOrFileName: uploadedFile?.fileName || 'Crew_Capture.jpg',
          modality: 'Crew Optical / Ultrasound Self-Exam Capture',
          findingStatus: 'yellow',
          clinicalSummary:
            'Custom crew medical image logged for autonomous feature extraction and queued for asynchronous Earth Flight Surgeon tele-consultation.',
          plainCrewGuidance:
            'Your custom medical image has been captured and attached to the telemetry buffer. Compare local margins against the onboard reference atlas.',
          recommendedAction:
            'Attach this visual exam to the next Earth Flight Surgeon telemetry packet and repeat imaging in 12 hours.',
          analyzedAtIso: nowIso,
          source: 'offline_verified_cache',
        };
  }
}
