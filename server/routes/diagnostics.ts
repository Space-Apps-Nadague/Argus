/**
 * POST /api/ai/diagnostics — deterministic triage + trend models + rule-based HRP candidates,
 * then the LLM re-ranks and explains. Statuses and the urgency floor are never lowered by the LLM.
 */

import { Hono } from 'hono';
import type { DiagnosticHypothesis, DiagnosticsReport, DiagnosticsResponse } from '../../src/types/aiApi';
import { METRIC_THRESHOLDS } from '../../src/utils/triageEngine';
import { completeJson } from '../ai/llm';
import { buildCrewSnapshot, formatSnapshotForPrompt } from '../models/crewSnapshot';
import {
  DIAGNOSTIC_DISCLAIMER,
  evaluateDiagnosticRules,
  maxUrgency,
  urgencyFloor,
} from '../models/diagnosticsRules';
import { ARGUS_PERSONA, jsonInstruction } from '../prompts';
import { CrewContextSchema, DiagnosticsLlmSchema } from '../schemas';
import { keyFromHeader, knownMetricIds, liveMeta, OFFLINE_META, parseBody } from './util';

export const diagnosticsRoutes = new Hono();

const SHAPE = `{
  "summary": string,
  "earthConsultUrgency": "routine_downlink" | "priority_packet" | "immediate_emergency_packet",
  "hypotheses": [{
    "condition": string,
    "hrpRisk": string,
    "likelihood": "low" | "moderate" | "high",
    "confidence": number between 0 and 1,
    "supportingMetricIds": string[]  (only ids shown in [brackets] in the data),
    "rationale": string,
    "suggestedConfirmation": string
  }]
}`;

function offlineSummary(hypotheses: DiagnosticHypothesis[], flaggedCount: number): string {
  if (!hypotheses.length) {
    return 'All monitored metrics are within flight norms with no meaningful drift from baseline. Continue routine countermeasures.';
  }
  const top = hypotheses.slice(0, 2).map((h) => `${h.condition} (${h.likelihood})`).join(' and ');
  return `${flaggedCount} metric(s) are off-nominal or drifting. The pattern most consistent with the data: ${top}. Confirm with the suggested checks below.`;
}

diagnosticsRoutes.post('/diagnostics', async (c) => {
  const body = await parseBody(c, CrewContextSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const snapshot = buildCrewSnapshot(req);
  const ruleHypotheses = evaluateDiagnosticRules(snapshot.trends);
  const floor = urgencyFloor(snapshot.zoneStatuses);

  const base: Omit<DiagnosticsReport, 'hypotheses' | 'summary' | 'earthConsultUrgency'> = {
    crewId: req.crewMember?.id,
    scenarioId: req.scenarioId,
    zoneStatuses: snapshot.zoneStatuses,
    readinessScore: snapshot.readinessScore,
    trends: snapshot.trends,
    flaggedTrends: snapshot.flaggedTrends,
    disclaimer: DIAGNOSTIC_DISCLAIMER,
    generatedAtIso: new Date().toISOString(),
  };

  const offline: DiagnosticsReport = {
    ...base,
    hypotheses: ruleHypotheses,
    summary: offlineSummary(ruleHypotheses, snapshot.flaggedTrends.length),
    earthConsultUrgency: floor,
  };

  const candidates = ruleHypotheses.length
    ? ruleHypotheses
        .map((h) => `- ${h.condition} [${h.supportingMetricIds.join(', ')}] — rule likelihood ${h.likelihood}; HRP: ${h.hrpRisk}`)
        .join('\n')
    : '- none (no rule fired)';

  const result = await completeJson(
    DiagnosticsLlmSchema,
    [
      { role: 'system', content: ARGUS_PERSONA },
      {
        role: 'user',
        content: `DATA
${formatSnapshotForPrompt(snapshot, { allMetrics: true })}

Rule-based candidate conditions (deterministic pattern matching):
${candidates}

Task: produce a differential for the Flight Surgeon dashboard. Re-rank and refine the candidates using all the data (you may add at most one condition the rules missed if the data clearly supports it, and drop candidates the data contradicts). For each, explain the evidence in plain language and how the crew can confirm it. If everything is nominal, return an empty hypotheses list. Earth consult urgency must be at least "${floor}".
${jsonInstruction(SHAPE)}`,
      },
    ],
    { feature: 'diagnostics', keyOverride: keyFromHeader(c), maxTokens: 6000 }
  );

  if (!result) {
    return c.json<DiagnosticsResponse>({ result: offline, meta: OFFLINE_META });
  }

  const metricIds = Object.keys(METRIC_THRESHOLDS);
  const hypotheses: DiagnosticHypothesis[] = result.data.hypotheses.map((h, i) => ({
    id: `dx-${i + 1}`,
    condition: h.condition,
    hrpRisk: h.hrpRisk,
    likelihood: h.likelihood,
    confidence: Math.round(h.confidence * 100) / 100,
    supportingMetricIds: knownMetricIds(h.supportingMetricIds, metricIds),
    rationale: h.rationale,
    suggestedConfirmation: h.suggestedConfirmation,
  }));

  const report: DiagnosticsReport = {
    ...base,
    hypotheses: hypotheses.length || !ruleHypotheses.length ? hypotheses : ruleHypotheses,
    summary: result.data.summary,
    earthConsultUrgency: maxUrgency(result.data.earthConsultUrgency, floor),
  };
  return c.json<DiagnosticsResponse>({ result: report, meta: liveMeta(result) });
});
