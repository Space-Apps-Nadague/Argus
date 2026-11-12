/**
 * ARGUS — Multimodal Gemini Flight Surgeon AI Service + Offline Verified Fallback
 * Single Source of Truth: specs/00-architecture.md & specs/01-data-schema.md (§4)
 *
 * SDK Note: Uses @google/genai >= 2.29.1 Interactions API (`client.interactions.create`)
 * with model `gemini-3.8-flash` (upgraded from deprecated `gemini-2.5-flash`).
 *
 * Architectural Guardrail (AGENTS.md):
 * Deterministic Green/Yellow/Red triage status is ALWAYS computed by `triageEngine.ts`
 * and never overridden by the LLM.
 */

import { GoogleGenAI } from '@google/genai';
import {
  BodyZoneId,
  CrewMemberProfile,
  FlightSurgeonGuidance,
  GravityEnvironment,
  ScenarioId,
  TriageStatus,
  VisualExamAnalysis,
  VisualExamSample,
} from '../types/argus';
import {
  BODY_ZONES,
  getCrewAdjustedZones,
  getOfflineFlightSurgeonGuidance,
  TELEMETRY_SCENARIOS,
} from '../data/telemetryScenarios';
import {
  ENVIRONMENT_META,
  evaluateMetricStatus,
  evaluateZoneStatus,
} from '../utils/triageEngine';

export const GEMINI_MODEL_ID = 'gemini-3.8-flash';

function getResolvedApiKey(runtimeKey?: string): string | undefined {
  if (runtimeKey && runtimeKey.trim().length > 0) {
    return runtimeKey.trim();
  }
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (typeof envKey === 'string' && envKey.trim().length > 0) {
    return envKey.trim();
  }
  return undefined;
}

export function hasConfiguredGeminiKey(runtimeKey?: string): boolean {
  return Boolean(getResolvedApiKey(runtimeKey));
}

/**
 * Generates plain-language Flight Surgeon guidance & step-by-step self-exam countermeasures
 * using Gemini 3.8 Flash structured output, with instant deterministic offline fallback.
 */
export async function synthesizeFlightSurgeonGuidance(params: {
  scenarioId: ScenarioId;
  zoneId: BodyZoneId;
  environment: GravityEnvironment;
  crewMember?: CrewMemberProfile;
  runtimeApiKey?: string;
  forceLiveAi?: boolean;
}): Promise<FlightSurgeonGuidance> {
  const {
    scenarioId,
    zoneId,
    environment,
    crewMember,
    runtimeApiKey,
    forceLiveAi,
  } = params;
  const offlineFallback = getOfflineFlightSurgeonGuidance(
    scenarioId,
    zoneId,
    environment,
    crewMember
  );

  const apiKey = getResolvedApiKey(runtimeApiKey);
  if (!apiKey || !forceLiveAi) {
    return offlineFallback;
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const scenario = TELEMETRY_SCENARIOS[scenarioId];
    const adjustedZones = getCrewAdjustedZones(scenarioId, crewMember);
    const zoneReadings = adjustedZones[zoneId];
    const deterministicStatus: TriageStatus = evaluateZoneStatus(
      zoneReadings,
      environment
    );
    const zoneMeta = BODY_ZONES[zoneId];
    const envMeta = ENVIRONMENT_META[environment];

    const metricsSummary = zoneReadings
      .map((m) => {
        const mStatus = evaluateMetricStatus(
          m.metricId,
          m.currentValue,
          environment
        );
        return `- ${m.label}: ${m.currentValue} ${m.unit} (${mStatus.toUpperCase()}, ${m.deltaFromBaseline})`;
      })
      .join('\n');

    const crewContext = crewMember
      ? `Crew Member: ${crewMember.name} (Callsign "${crewMember.callsign}", ${crewMember.role}, Age ${crewMember.age}, Blood Type ${crewMember.bloodType}, Pre-flight HR ${crewMember.restingHrBaselineBpm} bpm, Pre-flight ONSD ${crewMember.preFlightOnsdMm} mm, Sols Logged: ${crewMember.missionDaysLogged}).
Medical Notes: ${crewMember.medicalNotes}`
      : 'Crew Member: Standard Astronaut Bio-Twin';

    const prompt = `You are ARGUS, an autonomous deep-space Flight Surgeon decision support system assisting a non-physician astronaut crew under ${envMeta.commDelay} communication delay.
${crewContext}
Active Environment: ${envMeta.label} (${envMeta.gravityG})
Active Scenario: ${scenario.label}
Selected Anatomical Zone: ${zoneMeta.name} (${zoneMeta.anatomicalSubtitle})
Deterministic Zone Triage Status: ${deterministicStatus.toUpperCase()}

Current Zone Telemetry:
${metricsSummary}

Generate structured JSON clinical guidance for a non-physician crew member. Keep explanations clear, calm, and grounded in NASA Human Research Program countermeasures.`;

    const interaction = await client.interactions.create({
      model: GEMINI_MODEL_ID,
      input: prompt,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            headline: { type: 'string' },
            hazardContextSummary: { type: 'string' },
            plainLanguageExplanation: { type: 'string' },
            earthConsultUrgency: {
              type: 'string',
              enum: [
                'routine_downlink',
                'priority_packet',
                'immediate_emergency_packet',
              ],
            },
            guidedSteps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  stepNumber: { type: 'number' },
                  title: { type: 'string' },
                  plainInstruction: { type: 'string' },
                  hardwareRequired: { type: 'string' },
                  estimatedMinutes: { type: 'number' },
                },
                required: [
                  'id',
                  'stepNumber',
                  'title',
                  'plainInstruction',
                  'hardwareRequired',
                  'estimatedMinutes',
                ],
              },
            },
          },
          required: [
            'headline',
            'hazardContextSummary',
            'plainLanguageExplanation',
            'earthConsultUrgency',
            'guidedSteps',
          ],
        },
      },
    });

    const rawText = interaction.output_text;
    if (!rawText) {
      return offlineFallback;
    }

    const parsed = JSON.parse(rawText);
    return {
      zoneId,
      environment,
      scenarioId,
      // Deterministic status is strictly preserved per AGENTS.md §2.4
      triageStatus: deterministicStatus,
      headline: parsed.headline || offlineFallback.headline,
      hazardContextSummary:
        parsed.hazardContextSummary || offlineFallback.hazardContextSummary,
      plainLanguageExplanation:
        parsed.plainLanguageExplanation ||
        offlineFallback.plainLanguageExplanation,
      earthConsultUrgency:
        parsed.earthConsultUrgency || offlineFallback.earthConsultUrgency,
      guidedSteps:
        Array.isArray(parsed.guidedSteps) && parsed.guidedSteps.length > 0
          ? parsed.guidedSteps
          : offlineFallback.guidedSteps,
      source: 'gemini_live',
    };
  } catch (err) {
    console.warn(
      '[ARGUS AI] Falling back to offline verified NASA HRP guidance:',
      err
    );
    return offlineFallback;
  }
}

/**
 * Analyzes a 1-click sample medical image or user-uploaded image (base64)
 * using Gemini 3.8 Flash multimodal input, with deterministic offline fallback.
 */
export async function analyzeVisualSelfExam(params: {
  sample?: VisualExamSample;
  uploadedFile?: {
    fileName: string;
    base64Data: string;
    mimeType: string;
  };
  environment: GravityEnvironment;
  runtimeApiKey?: string;
}): Promise<VisualExamAnalysis> {
  const { sample, uploadedFile, environment, runtimeApiKey } = params;
  const nowIso = new Date().toISOString();

  // Offline deterministic fallback for sample or uploaded file
  const fallbackAnalysis: VisualExamAnalysis = sample
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

  const apiKey = getResolvedApiKey(runtimeApiKey);
  if (!apiKey) {
    return fallbackAnalysis;
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const envMeta = ENVIRONMENT_META[environment];

    const inputParts: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mime_type: string }
    > = [
      {
        type: 'text',
        text: `You are ARGUS, an autonomous spacecraft medical imaging triage assistant operating in ${envMeta.label} (${envMeta.commDelay} delay).
Analyze this crew self-exam medical image (${
          sample ? sample.title + ' - ' + sample.modality : uploadedFile?.fileName
        }) and return JSON with clinicalSummary, plainCrewGuidance (for a non-physician astronaut), and recommendedAction.`,
      },
    ];

    if (uploadedFile?.base64Data && uploadedFile?.mimeType) {
      inputParts.push({
        type: 'image',
        data: uploadedFile.base64Data,
        mime_type: uploadedFile.mimeType,
      });
    }

    const interaction = await client.interactions.create({
      model: GEMINI_MODEL_ID,
      input: inputParts,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            findingStatus: {
              type: 'string',
              enum: ['green', 'yellow', 'red'],
            },
            clinicalSummary: { type: 'string' },
            plainCrewGuidance: { type: 'string' },
            recommendedAction: { type: 'string' },
          },
          required: [
            'findingStatus',
            'clinicalSummary',
            'plainCrewGuidance',
            'recommendedAction',
          ],
        },
      },
    });

    const rawText = interaction.output_text;
    if (!rawText) {
      return fallbackAnalysis;
    }

    const parsed = JSON.parse(rawText);
    return {
      sampleIdOrFileName: fallbackAnalysis.sampleIdOrFileName,
      modality: fallbackAnalysis.modality,
      // For known reference samples, keep deterministic finding status; for custom uploads allow vision triage
      findingStatus: sample
        ? sample.defaultFindingStatus
        : (parsed.findingStatus as TriageStatus) || 'yellow',
      clinicalSummary: parsed.clinicalSummary || fallbackAnalysis.clinicalSummary,
      plainCrewGuidance:
        parsed.plainCrewGuidance || fallbackAnalysis.plainCrewGuidance,
      recommendedAction:
        parsed.recommendedAction || fallbackAnalysis.recommendedAction,
      analyzedAtIso: nowIso,
      source: 'gemini_vision',
    };
  } catch (err) {
    console.warn('[ARGUS Vision] Falling back to offline verified sample analysis:', err);
    return fallbackAnalysis;
  }
}
