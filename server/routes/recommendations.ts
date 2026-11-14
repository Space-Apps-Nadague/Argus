/**
 * POST /api/ai/recommendations — personalized countermeasure plan. The deterministic library
 * plan is the offline result and the LLM's starting point.
 */

import { Hono } from 'hono';
import type {
  CountermeasurePlan,
  CountermeasureRecommendation,
  RecommendationsResponse,
} from '../../src/types/aiApi';
import { METRIC_THRESHOLDS } from '../../src/utils/triageEngine';
import { completeJson } from '../ai/llm';
import { buildOfflinePlan } from '../models/countermeasureLibrary';
import { buildCrewSnapshot, formatSnapshotForPrompt } from '../models/crewSnapshot';
import { ARGUS_PERSONA, jsonInstruction } from '../prompts';
import { CrewContextSchema, RecommendationsLlmSchema } from '../schemas';
import { keyFromHeader, knownMetricIds, liveMeta, OFFLINE_META, parseBody } from './util';

export const recommendationsRoutes = new Hono();

const SHAPE = `{
  "headline": string,
  "recommendations": [{
    "category": "exercise" | "sleep" | "nutrition" | "radiation" | "environment" | "behavioral" | "medical_check",
    "title": string,
    "plainInstruction": string,
    "rationale": string,
    "targetMetricIds": string[]  (ids shown in [brackets] in the data),
    "priority": "now" | "today" | "this_week",
    "durationMinutes": number
  }]
}`;

recommendationsRoutes.post('/recommendations', async (c) => {
  const body = await parseBody(c, CrewContextSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const snapshot = buildCrewSnapshot(req);
  const libraryPlan = buildOfflinePlan(snapshot.flaggedTrends);
  const name = req.crewMember?.callsign ?? 'crew';

  const offline: CountermeasurePlan = {
    crewId: req.crewMember?.id,
    scenarioId: req.scenarioId,
    headline: snapshot.flaggedTrends.length
      ? `${libraryPlan.filter((r) => r.priority !== 'this_week').length} countermeasure(s) for ${name} today`
      : `Maintenance plan for ${name} — all metrics nominal`,
    recommendations: libraryPlan,
    generatedAtIso: new Date().toISOString(),
  };

  const baseline = libraryPlan
    .map((r) => `- (${r.priority}) ${r.title} [${r.targetMetricIds.join(', ')}]: ${r.plainInstruction}`)
    .join('\n');

  const result = await completeJson(
    RecommendationsLlmSchema,
    [
      { role: 'system', content: ARGUS_PERSONA },
      {
        role: 'user',
        content: `DATA
${formatSnapshotForPrompt(snapshot)}

Standard countermeasure library suggestions:
${baseline}

Task: write a personalized countermeasure plan for today (3–6 items, most urgent first). Tailor to this crew member's profile, notes and trends; keep instructions concrete (what, how long, which hardware). Use "now" only for metrics in the red band.
${jsonInstruction(SHAPE)}`,
      },
    ],
    { feature: 'recommendations', keyOverride: keyFromHeader(c) }
  );

  if (!result) {
    return c.json<RecommendationsResponse>({ result: offline, meta: OFFLINE_META });
  }

  const metricIds = Object.keys(METRIC_THRESHOLDS);
  const recommendations: CountermeasureRecommendation[] = result.data.recommendations.map((r, i) => ({
    id: `ai-cm-${i + 1}`,
    category: r.category,
    title: r.title,
    plainInstruction: r.plainInstruction,
    rationale: r.rationale,
    targetMetricIds: knownMetricIds(r.targetMetricIds, metricIds),
    priority: r.priority,
    durationMinutes: Math.max(1, Math.round(r.durationMinutes)),
  }));

  return c.json<RecommendationsResponse>({
    result: { ...offline, headline: result.data.headline, recommendations },
    meta: liveMeta(result),
  });
});
