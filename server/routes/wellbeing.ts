/**
 * POST /api/ai/wellbeing — mental-health check-in assessment. Score, status, trend, factors and
 * crisis flag are deterministic; the LLM only writes the supportive message and small actions.
 */

import { Hono } from 'hono';
import type { WellbeingAssessment, WellbeingResponse } from '../../src/types/aiApi';
import { completeJson } from '../ai/llm';
import { buildCrewSnapshot, describeCrew } from '../models/crewSnapshot';
import { computeWellbeing, CRISIS_ESCALATION_MESSAGE, offlineSupport } from '../models/wellbeingModel';
import { COMPANION_PERSONA, jsonInstruction } from '../prompts';
import { WellbeingLlmSchema, WellbeingRequestSchema } from '../schemas';
import { keyFromHeader, liveMeta, OFFLINE_META, parseBody } from './util';

export const wellbeingRoutes = new Hono();

const SHAPE = `{ "supportiveMessage": string, "suggestedActions": string[] (2–4 small, concrete actions) }`;

wellbeingRoutes.post('/wellbeing', async (c) => {
  const body = await parseBody(c, WellbeingRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const snapshot = buildCrewSnapshot(req);
  const model = computeWellbeing(req.checkIns, snapshot.zones);
  const support = offlineSupport(model);

  const base: Omit<WellbeingAssessment, 'supportiveMessage' | 'suggestedActions'> = {
    crewId: req.crewMember?.id,
    riskScore: model.riskScore,
    status: model.status,
    trend: model.trend,
    factors: model.factors,
    crisisFlag: model.crisisFlag,
    earthConsultUrgency: model.earthConsultUrgency,
    generatedAtIso: new Date().toISOString(),
  };
  const offline: WellbeingAssessment = { ...base, supportiveMessage: support.message, suggestedActions: support.actions };

  if (!req.checkIns.length) {
    return c.json<WellbeingResponse>({ result: offline, meta: OFFLINE_META });
  }

  const recent = [...req.checkIns]
    .sort((a, b) => a.missionDay - b.missionDay)
    .slice(-7)
    .map(
      (ci) =>
        `- Day ${ci.missionDay}: mood ${ci.mood}, stress ${ci.stress}, energy ${ci.energy}, sleep ${ci.sleepQuality}, cohesion ${ci.cohesion}, motivation ${ci.motivation}${ci.note ? ` — note: "${ci.note.slice(0, 300)}"` : ''}`
    )
    .join('\n');

  const result = await completeJson(
    WellbeingLlmSchema,
    [
      { role: 'system', content: COMPANION_PERSONA },
      {
        role: 'user',
        content: `DATA
${describeCrew(req.crewMember)}
Recent self-reported check-ins (1–5 scales; stress 5 = most stressed):
${recent}
Deterministic behavioral-health assessment: risk ${model.riskScore}/100 (${model.status.toUpperCase()}), trend ${model.trend}.
Main factors: ${model.factors.map((f) => `${f.label} (${f.detail})`).join('; ') || 'none'}.
${model.crisisFlag ? 'CRISIS LANGUAGE DETECTED: the crew member must be urged to contact the Crew Medical Officer and behavioral health team immediately.' : ''}

Write a short, warm supportive message (3–5 sentences, address them by name) and 2–4 small concrete actions. Do not restate the score.
${jsonInstruction(SHAPE)}`,
      },
    ],
    { feature: 'wellbeing', keyOverride: keyFromHeader(c), temperature: 0.6 }
  );

  if (!result) {
    return c.json<WellbeingResponse>({ result: offline, meta: OFFLINE_META });
  }

  // Crisis escalation text is fixed and always leads, regardless of LLM output.
  const message = model.crisisFlag
    ? `${CRISIS_ESCALATION_MESSAGE}\n\n${result.data.supportiveMessage}`
    : result.data.supportiveMessage;

  return c.json<WellbeingResponse>({
    result: { ...base, supportiveMessage: message, suggestedActions: result.data.suggestedActions },
    meta: liveMeta(result),
  });
});
