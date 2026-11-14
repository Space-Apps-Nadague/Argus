/**
 * POST /api/ai/guidance — Flight Surgeon guidance (port of the former browser-side Gemini call).
 * Deterministic zone status is always preserved (AGENTS.md §2.4).
 */

import { Hono } from 'hono';
import type { FlightSurgeonGuidance } from '../../src/types/argus';
import type { GuidanceResponse } from '../../src/types/aiApi';
import { BODY_ZONES, getOfflineFlightSurgeonGuidance } from '../../src/data/telemetryScenarios';
import { ENVIRONMENT_META, evaluateMetricStatus } from '../../src/utils/triageEngine';
import { completeJson } from '../ai/llm';
import { formatCommDelay } from '../../src/data/spaceLocations';
import { maxUrgency } from '../models/diagnosticsRules';
import { buildCrewSnapshot, describeCrew } from '../models/crewSnapshot';
import { ARGUS_PERSONA, jsonInstruction } from '../prompts';
import { GuidanceLlmSchema, GuidanceRequestSchema } from '../schemas';
import { keyFromHeader, liveMeta, OFFLINE_META, parseBody } from './util';

export const guidanceRoutes = new Hono();

const SHAPE = `{
  "headline": string,
  "hazardContextSummary": string,
  "plainLanguageExplanation": string,
  "earthConsultUrgency": "routine_downlink" | "priority_packet" | "immediate_emergency_packet",
  "guidedSteps": [{ "title": string, "plainInstruction": string, "hardwareRequired": string, "estimatedMinutes": number }]
}`;

guidanceRoutes.post('/guidance', async (c) => {
  const body = await parseBody(c, GuidanceRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const snapshot = buildCrewSnapshot(req);
  const offline = getOfflineFlightSurgeonGuidance(req.scenarioId, req.zoneId, snapshot.environment, req.crewMember);
  const deterministicStatus = snapshot.zoneStatuses[req.zoneId];
  const zone = BODY_ZONES[req.zoneId];
  const env = ENVIRONMENT_META[snapshot.environment];

  const metrics = snapshot.zones[req.zoneId]
    .map((m) => {
      const st = evaluateMetricStatus(m.metricId, m.currentValue, snapshot.environment);
      const trend = snapshot.trends.find((t) => t.metricId === m.metricId);
      const trendNote = trend ? `; trend ${trend.level}, slope ${trend.slopePerDay}/day` : '';
      return `- ${m.label}: ${m.currentValue} ${m.unit} (${st.toUpperCase()}, ${m.deltaFromBaseline}${trendNote})`;
    })
    .join('\n');

  const result = await completeJson(
    GuidanceLlmSchema,
    [
      { role: 'system', content: ARGUS_PERSONA },
      {
        role: 'user',
        content: `${describeCrew(req.crewMember)}
${snapshot.location ? `Location: ${snapshot.location.label} (${snapshot.location.gravityLabel}), one-way comm delay ${formatCommDelay(snapshot.location)}.` : `Environment: ${env.label} (${env.gravityG}), comm delay ${env.commDelay}.`}
Scenario: ${snapshot.scenarioLabel}
Selected zone: ${zone.name} (${zone.anatomicalSubtitle}) — HRP focus: ${zone.nasaHazardFocus}
Deterministic zone status: ${deterministicStatus.toUpperCase()}

Zone telemetry:
${metrics}

Write Flight Surgeon guidance for a non-physician crew member: a short headline, the hazard context, a plain-language explanation, the Earth consult urgency, and 3–6 guided self-exam / countermeasure steps.
${jsonInstruction(SHAPE)}`,
      },
    ],
    { feature: 'guidance', keyOverride: keyFromHeader(c) }
  );

  if (!result) {
    return c.json<GuidanceResponse>({ result: offline, meta: OFFLINE_META });
  }

  const g = result.data;
  const guidance: FlightSurgeonGuidance = {
    zoneId: req.zoneId,
    environment: snapshot.environment,
    scenarioId: req.scenarioId,
    triageStatus: deterministicStatus, // never from the LLM
    headline: g.headline,
    hazardContextSummary: g.hazardContextSummary,
    plainLanguageExplanation: g.plainLanguageExplanation,
    earthConsultUrgency: maxUrgency(g.earthConsultUrgency, offline.earthConsultUrgency),
    guidedSteps: g.guidedSteps.map((s, i) => ({
      id: s.id || `ai-step-${i + 1}`,
      stepNumber: i + 1,
      title: s.title,
      plainInstruction: s.plainInstruction,
      hardwareRequired: s.hardwareRequired,
      estimatedMinutes: Math.max(1, Math.round(s.estimatedMinutes)),
    })),
    source: 'live_ai',
  };
  return c.json<GuidanceResponse>({ result: guidance, meta: liveMeta(result) });
});
