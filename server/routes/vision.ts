/**
 * POST /api/ai/vision — visual self-exam triage (port of the former browser-side call).
 * Reference samples keep their deterministic finding status; only custom uploads may be
 * triaged by the vision model.
 */

import { Hono } from 'hono';
import type { VisualExamAnalysis } from '../../src/types/argus';
import type { VisionResponse } from '../../src/types/aiApi';
import { VISUAL_EXAM_SAMPLES } from '../../src/data/telemetryScenarios';
import { DEFAULT_ENVIRONMENT, ENVIRONMENT_META } from '../../src/utils/triageEngine';
import { type ChatMessage, completeJson } from '../ai/llm';
import { ARGUS_PERSONA, jsonInstruction } from '../prompts';
import { VisionLlmSchema, VisionRequestSchema } from '../schemas';
import { keyFromHeader, liveMeta, OFFLINE_META, parseBody } from './util';

export const visionRoutes = new Hono();

const SHAPE = `{
  "findingStatus": "green" | "yellow" | "red",
  "clinicalSummary": string,
  "plainCrewGuidance": string,
  "recommendedAction": string
}`;

visionRoutes.post('/vision', async (c) => {
  const body = await parseBody(c, VisionRequestSchema);
  if (!body.ok) return body.response;
  const { sampleId, uploadedFile } = body.data;
  const environment = body.data.environment ?? DEFAULT_ENVIRONMENT;
  const sample = sampleId ? VISUAL_EXAM_SAMPLES.find((s) => s.id === sampleId) : undefined;
  const nowIso = new Date().toISOString();

  const fallback: VisualExamAnalysis = sample
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

  const env = ENVIRONMENT_META[environment];
  const instruction = `Environment: ${env.label}, comm delay ${env.commDelay}.
Analyze this crew self-exam image (${sample ? `${sample.title} — ${sample.modality}` : uploadedFile?.fileName}).
${sample ? `Reference context: ${sample.clinicalSummary}` : ''}
Describe what is visible, give plain guidance for a non-physician astronaut, and one recommended action.
${jsonInstruction(SHAPE)}`;

  // Reference samples are SVG illustrations, so they are described in text; uploads are sent as images.
  const userContent: ChatMessage['content'] = uploadedFile
    ? [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: `data:${uploadedFile.mimeType};base64,${uploadedFile.base64Data}` } },
      ]
    : instruction;

  const result = await completeJson(
    VisionLlmSchema,
    [
      { role: 'system', content: ARGUS_PERSONA },
      { role: 'user', content: userContent } as ChatMessage,
    ],
    { feature: 'vision', vision: Boolean(uploadedFile), keyOverride: keyFromHeader(c) }
  );

  if (!result) {
    return c.json<VisionResponse>({ result: fallback, meta: OFFLINE_META });
  }

  const analysis: VisualExamAnalysis = {
    sampleIdOrFileName: fallback.sampleIdOrFileName,
    modality: fallback.modality,
    findingStatus: sample ? sample.defaultFindingStatus : result.data.findingStatus,
    clinicalSummary: result.data.clinicalSummary,
    plainCrewGuidance: result.data.plainCrewGuidance,
    recommendedAction: result.data.recommendedAction,
    analyzedAtIso: nowIso,
    source: 'live_vision_ai',
  };
  return c.json<VisionResponse>({ result: analysis, meta: liveMeta(result) });
});
