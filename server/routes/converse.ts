/**
 * POST /api/ai/converse — the single ARGUS conversation (SSE, see `ConverseEvent`).
 * specs/04-ai-backend.md §4.2–§4.4.
 *
 * Order of work for every turn:
 *   1. Fast path (deterministic, no model): red flags, spoken vital logs and "step done"
 *      become `action` events before the first token, so the console reacts at once.
 *   2. The model streams a full conversational reply and may call tools (more actions).
 *   3. After the reply, the mental-state assessment is computed in code (a background model
 *      call may add cues) and, when the concern level calls for it, a report to Earth is queued.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { BodyZoneId } from '../../src/types/argus';
import type { EarthConsultUrgency } from '../../src/types/aiApi';
import type { AssistantAction, ConverseEvent, ConverseRequest, MentalStateAssessment, VisualObservation } from '../../src/types/assistant';
import { SPACE_LOCATIONS, commDelayAt } from '../../src/data/spaceLocations';
import { BODY_ZONES } from '../../src/data/telemetryScenarios';
import { STATUS_LABELS } from '../../src/utils/triageEngine';
import { COMM_TIER_PROFILES, type CommTier, resolveCommTier, roundTripSeconds } from '../../shared/commProfile';
import { pickCountermeasure } from '../../shared/countermeasures';
import { combineAssessment, shouldAutoReport, urgencyForConcern } from '../../shared/mentalState';
import { detectRedFlags } from '../../shared/redFlags';
import { ASSISTANT_TOOLS, runAssistantTool, type ToolContext } from '../ai/assistantTools';
import { type ChatMessage, completeJson, providerChainFor, streamChat } from '../ai/llm';
import type { AppEnv } from '../auth/types';
import { getOrStartConversation, latestTriageEventId, logMessage } from '../db/chatLog';
import { type CrewSnapshot, buildCrewSnapshot, formatSnapshotForPrompt } from '../models/crewSnapshot';
import { computeWellbeing, CRISIS_ESCALATION_MESSAGE } from '../models/wellbeingModel';
import { buildAssistantPrompt, jsonInstruction, MENTAL_STATE_EXTRACTION_PROMPT } from '../prompts';
import { ConverseRequestSchema, MentalStateLlmSchema } from '../schemas';
import { offlineReply } from './chat';
import { keyFromHeader, parseBody } from './util';
import { executeVoiceToolCall, maxUrgency, parseSpokenVitalLogCommand, urgencyFloorForStatus, worstZoneStatus } from './voice';

export const converseRoutes = new Hono<AppEnv>();

/** Tier the server will actually use: distance from the location, moved only toward autonomy. */
export function tierForRequest(req: Pick<ConverseRequest, 'locationId' | 'tierOverride'>, now = new Date()): { tier: CommTier; oneWaySec: number } {
  const loc = req.locationId ? SPACE_LOCATIONS[req.locationId] : undefined;
  const oneWaySec = loc ? commDelayAt(loc, now).seconds : 0;
  const tier = loc ? resolveCommTier({ oneWayDelaySec: oneWaySec, override: req.tierOverride }) : (req.tierOverride ?? 'relay');
  return { tier, oneWaySec };
}

function formatDuration(sec: number): string {
  if (sec < 1) return 'under a second';
  if (sec < 90) return `${Math.round(sec)} seconds`;
  return `${Math.round(sec / 60)} minutes`;
}

export function describeObservation(o: VisualObservation): string {
  if (!o.facePresent) return 'They are not in frame right now.';
  const lines = [
    o.fatigue ? `Fatigue signs: ${o.fatigue}` : '',
    o.blinkRatePerMin != null ? `Blink rate: ${Math.round(o.blinkRatePerMin)}/min` : '',
    o.perclos != null ? `Eyes mostly closed ${Math.round(o.perclos * 100)}% of the time` : '',
    o.yawnsPerMin ? `Yawns: ${o.yawnsPerMin.toFixed(1)}/min` : '',
    o.affect !== 'unknown' ? `Expression: ${o.affect}` : '',
    o.posture !== 'unknown' ? `Posture: ${o.posture}` : '',
    o.restlessness ? `Restlessness: ${o.restlessness}` : '',
    o.pulseBpmEstimate != null && (o.pulseConfidence ?? 0) >= 0.5
      ? `Camera pulse estimate: about ${Math.round(o.pulseBpmEstimate)} bpm (rough estimate, not a measurement)`
      : '',
  ].filter(Boolean);
  return `${lines.join('. ')}. Covers the last ${Math.round(o.windowSec)} seconds.`;
}

export function describeAssessment(a: MentalStateAssessment): string {
  const evidence = a.evidence.slice(0, 4).map((e) => `${e.source}: ${e.text}`).join('; ');
  return `Mood ${a.mood.replace('_', ' ')}, stress ${a.stress}, fatigue ${a.fatigue}. Concern level: ${a.concernLevel} (${a.trend}). ${a.summary}${evidence ? ` Evidence: ${evidence}.` : ''}`;
}

const STEP_DONE = /\b(done|did\s+(it|that)|finished|complete(d)?|next(\s+step)?|ok(ay)?\s+done|step\s+(\d+)\s+(is\s+)?(done|complete|finished))\b/i;

/** Deterministic actions that need no model. */
export function fastPathActions(req: ConverseRequest, lastUser: string, snapshot: CrewSnapshot): AssistantAction[] {
  const actions: AssistantAction[] = [];
  const flags = detectRedFlags(lastUser);

  if (flags.flagged && flags.protocolId && req.activeProtocol?.protocolId !== flags.protocolId) {
    actions.push({
      origin: 'fast_path',
      type: 'start_emergency_protocol',
      protocolId: flags.protocolId,
      reason: `Detected: ${flags.matched.slice(0, 2).join(', ')}`,
    });
    actions.push({
      origin: 'fast_path',
      type: 'queue_earth_packet',
      urgency: 'immediate_emergency_packet',
      note: `Red flag in conversation: "${lastUser.slice(0, 300)}"`,
    });
  }

  const log = parseSpokenVitalLogCommand(lastUser);
  if (log) {
    const r = executeVoiceToolCall({ ...req, toolName: 'log_checkin_reading', args: { metricId: log.metricId, value: log.value, zoneId: log.zoneId } });
    actions.push({
      origin: 'fast_path',
      type: 'log_checkin_reading',
      metricId: log.metricId,
      value: log.value,
      zoneId: r.loggedReading?.zoneId ?? log.zoneId,
      status: r.loggedReading?.status,
      ok: r.ok,
      message: r.summary,
    });
  }

  // "done" / "next" while a checklist is on screen ticks the next open step.
  const total = req.activeProtocol?.steps.length ?? 0;
  if (total && !flags.flagged && lastUser.length <= 60) {
    const m = STEP_DONE.exec(lastUser);
    if (m) {
      const explicit = m[5] ? Number(m[5]) : null;
      const done = new Set(req.activeProtocol!.completedSteps);
      let next = explicit;
      if (!next) for (let i = 1; i <= total; i++) if (!done.has(i)) { next = i; break; }
      if (next && next >= 1 && next <= total && !done.has(next)) {
        actions.push({ origin: 'fast_path', type: 'mark_step_done', stepNumber: next });
      }
    }
  }
  void snapshot;
  return actions;
}

function toolContext(req: ConverseRequest, snapshot: CrewSnapshot): ToolContext {
  return {
    crew: req,
    activeProtocol: req.activeProtocol,
    guidedSteps: req.guidedSteps,
    logReading: (metricId, value, note) => {
      const r = executeVoiceToolCall({ ...req, toolName: 'log_checkin_reading', args: { metricId, value: value as number, note } });
      return { ok: r.ok, summary: r.summary, zoneId: r.loggedReading?.zoneId, metricId: r.loggedReading?.metricId, value: r.loggedReading?.value, status: r.loggedReading?.status };
    },
    snapshotSummary: (zoneId?: BodyZoneId) =>
      executeVoiceToolCall({ ...req, toolName: 'get_crew_snapshot', args: zoneId ? { zoneId } : {} }).summary,
  };
  void snapshot;
}

/** Deterministic reply used when no model answers: supportive, grounded, and never just data. */
export function offlineAssistantReply(snapshot: CrewSnapshot, lastUser: string, assessment: MentalStateAssessment, hasProtocol: boolean): string {
  const name = snapshot.crewMember?.callsign ?? 'there';
  if (hasProtocol) return `${name}, the checklist is on your screen. Work through it one step at a time and tell me "done" after each one. I am staying with you.`;
  const strained = assessment.concernLevel !== 'none';
  if (strained) {
    const top = assessment.evidence.find((e) => e.source === 'conversation');
    const worst = worstZoneStatus(snapshot.zoneStatuses);
    return [
      `${name}, I hear you${top ? ', and what you said matters' : ''}. Out here, with the distance and the workload, feeling like this makes sense, and you do not have to carry it alone.`,
      assessment.fatigue !== 'low' ? 'You also seem short on rest, which makes everything heavier than it is.' : '',
      `I have put one thing on your screen to try right now. Do that first, then tell me how it went${worst !== 'green' ? ', and we will look at your readings together after' : ''}.`,
      'I am running on the ship\'s onboard protocols at the moment, so my answers are simpler than usual, but I am here and I am listening. What is weighing on you most?',
    ].filter(Boolean).join(' ');
  }
  return `${offlineReply(snapshot, lastUser).replace(/\s*\(Offline mode[^)]*\)\s*$/, '')} I am on the ship's onboard protocols right now, so tell me more about what you are noticing and we will work through it together.`;
}

function chunkText(text: string, size = 28): string[] {
  const out: string[] = [];
  let current = '';
  for (const w of text.split(/(\s+)/)) {
    current += w;
    if (current.length >= size) { out.push(current); current = ''; }
  }
  if (current) out.push(current);
  return out;
}

converseRoutes.post('/converse', async (c) => {
  const body = await parseBody(c, ConverseRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data as ConverseRequest;

  const snapshot = buildCrewSnapshot(req);
  const { tier, oneWaySec } = tierForRequest(req);
  const profile = COMM_TIER_PROFILES[tier];
  const userMessages = req.messages.filter((m) => m.role === 'user').map((m) => m.content);
  const lastUser = userMessages[userMessages.length - 1] ?? '';
  const flags = detectRedFlags(lastUser);
  const wellbeing = req.checkIns?.length ? computeWellbeing(req.checkIns, snapshot.zones) : null;
  const keyOverride = keyFromHeader(c);

  const physiology = {
    behavioralStatus: snapshot.zoneStatuses.behavioral,
    flagged: snapshot.flaggedTrends
      .filter((t) => snapshot.zones.behavioral.some((r) => r.metricId === t.metricId))
      .map((t) => `${t.label} ${t.currentValue} ${t.unit} (${STATUS_LABELS[t.status]})`),
  };
  const selfReport = wellbeing ? { riskScore: wellbeing.riskScore, status: wellbeing.status, trend: wellbeing.trend } : null;
  // Assessment before the reply (code only) so tone and advice can adapt this turn.
  const preAssessment = combineAssessment({ userMessages, observation: req.observation, selfReport, physiology, previous: req.previousAssessment });

  let urgency: EarthConsultUrgency = maxUrgency(
    urgencyFloorForStatus(worstZoneStatus(snapshot.zoneStatuses)),
    flags.flagged ? 'immediate_emergency_packet' : urgencyForConcern(preAssessment.concernLevel)
  );

  const fast = fastPathActions(req, lastUser, snapshot);
  const startedProtocol = fast.find((a) => a.type === 'start_emergency_protocol');

  const useVision = Boolean(req.frame) && providerChainFor({ feature: 'chat', keyOverride, tier, vision: true }).length > 0;
  const toolsAvailable = providerChainFor({ feature: 'chat', keyOverride, tier, vision: useVision }).length > 0;

  const system = buildAssistantPrompt({
    tier,
    modality: req.modality,
    data: formatSnapshotForPrompt(snapshot, { allMetrics: tier !== 'autonomous' }),
    earthRoundTrip: oneWaySec > 0.5 ? formatDuration(roundTripSeconds(oneWaySec)) : undefined,
    observation: req.observation ? describeObservation(req.observation) : undefined,
    mentalState: describeAssessment(preAssessment),
    activeProtocol: req.activeProtocol
      ? `${req.activeProtocol.title}\n${req.activeProtocol.steps.map((s, i) => `${i + 1}. [${req.activeProtocol!.completedSteps.includes(i + 1) ? 'x' : ' '}] ${s}`).join('\n')}`
      : undefined,
    guidedSteps: !req.activeProtocol && req.guidedSteps?.length ? req.guidedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : undefined,
    countermeasures: req.countermeasureLog?.length
      ? req.countermeasureLog.map((cm) => `- ${cm.title}${cm.helped === undefined ? ' (ask whether it helped)' : cm.helped ? ' (helped)' : ' (did not help)'}`).join('\n')
      : undefined,
    crisis: flags.crisis,
    redFlag: Boolean(startedProtocol),
    toolsAvailable,
  });

  const history = req.messages.slice(-profile.historyTurns);
  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  history.forEach((m, i) => {
    const isLast = i === history.length - 1;
    if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.content });
    else if (m.role === 'earth') messages.push({ role: 'user', content: `[Message from the doctors on Earth] ${m.content}` });
    else if (isLast && useVision && req.frame) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          { type: 'image_url', image_url: { url: `data:${req.frame.mimeType};base64,${req.frame.base64Data}` } },
        ],
      });
    } else messages.push({ role: 'user', content: m.content });
  });

  const db = c.get('db');
  const user = c.get('user');
  const astronautId = req.crewMember?.id;
  let conversationId: string | null = null;
  if (db && astronautId && lastUser) {
    try {
      conversationId = await getOrStartConversation(db, astronautId, user?.id ?? null);
      await logMessage(db, { conversationId, role: 'user', authorUserId: user?.id ?? null, content: lastUser, crisisFlag: flags.crisis });
    } catch (err) {
      console.error('[ARGUS converse] could not store message', err);
      conversationId = null;
    }
  }

  return streamSSE(c, async (stream) => {
    let replyText = '';
    let replyMeta: { source?: string; provider?: string; model?: string } = {};
    const actions: AssistantAction[] = [];
    const send = (event: ConverseEvent) => {
      if (event.type === 'delta') replyText += event.text;
      if (event.type === 'action') actions.push(event.action);
      if (event.type === 'meta') replyMeta = { source: event.meta.source, provider: event.meta.provider, model: event.meta.model };
      return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    };

    // 1. Fast path: the console reacts before any model has answered.
    for (const action of fast) await send({ type: 'action', action });

    let metaSent = false;
    const sendMeta = async (meta: Extract<ConverseEvent, { type: 'meta' }>['meta']) => {
      if (metaSent) return;
      metaSent = true;
      await send({ type: 'meta', meta, tier, crisis: flags.crisis, redFlag: flags.flagged, earthConsultUrgency: urgency });
      if (flags.crisis) await send({ type: 'delta', text: `${CRISIS_ESCALATION_MESSAGE}\n\n` });
    };

    // 2. The conversation.
    const ctx = toolContext(req, snapshot);
    const started = Date.now();
    const emergency = Boolean(req.activeProtocol);
    for await (const chunk of streamChat(messages, {
      feature: 'chat',
      keyOverride,
      tier,
      vision: useVision,
      temperature: emergency ? 0.3 : 0.6,
      maxTokens: emergency ? 400 : 1600,
      tools: ASSISTANT_TOOLS,
      executeTool: (name, args) => {
        const outcome = runAssistantTool(name, args, ctx);
        return outcome.result;
      },
    })) {
      if (chunk.type === 'start') {
        await sendMeta({ source: 'live_ai', provider: chunk.provider, model: chunk.model, latencyMs: Date.now() - started });
      } else if (chunk.type === 'text') {
        await send({ type: 'delta', text: chunk.text });
      } else if (chunk.type === 'tool_call') {
        const outcome = runAssistantTool(chunk.name, chunk.args, ctx);
        const action = outcome.action;
        // The fast path already did it: do not repeat the same action from the model.
        const duplicate = action && actions.some((a) => a.type === action.type && (a.type !== 'log_checkin_reading' || (action.type === 'log_checkin_reading' && a.metricId === action.metricId)));
        if (action && !duplicate) {
          if (action.type === 'queue_earth_packet') urgency = maxUrgency(urgency, action.urgency);
          await send({ type: 'action', action });
        }
      } else {
        await send({ type: 'error', message: chunk.message });
      }
    }

    // 3. Mental state: model cues may raise, code decides.
    let modelCues: Awaited<ReturnType<typeof completeJson<typeof MentalStateLlmSchema._output>>> = null;
    if (metaSent && userMessages.join(' ').length >= 12 && !emergency) {
      const transcript = req.messages.slice(-10).map((m) => `${m.role === 'user' ? 'CREW' : 'CLINICIAN'}: ${m.content}`).join('\n');
      modelCues = await completeJson(
        MentalStateLlmSchema,
        [
          { role: 'system', content: `${MENTAL_STATE_EXTRACTION_PROMPT}\n\n${jsonInstruction('{"lowMood":0,"stress":0,"anxiety":0,"sleepProblem":0,"isolation":0,"conflict":0,"lowMotivation":0,"hopelessness":0,"fatigue":0,"summary":"..."}')}` },
          { role: 'user', content: transcript.slice(-8000) },
        ],
        { feature: 'wellbeing', keyOverride, tier, temperature: 0.2, maxTokens: 400 }
      ).catch(() => null);
    }
    const assessment = combineAssessment({
      userMessages,
      modelCues: modelCues?.data,
      modelSummary: modelCues?.data.summary,
      observation: req.observation,
      selfReport,
      physiology,
      previous: req.previousAssessment,
    });

    if (!metaSent) {
      await sendMeta({ source: 'offline_verified_cache' });
      if (!flags.crisis) {
        for (const piece of chunkText(offlineAssistantReply(snapshot, lastUser, assessment, Boolean(req.activeProtocol || startedProtocol)))) {
          await send({ type: 'delta', text: piece });
        }
      }
    }
    await send({ type: 'reply_end' });

    // A countermeasure card whenever there is real strain and the model did not offer one.
    if (assessment.concernLevel !== 'none' && !emergency && !actions.some((a) => a.type === 'suggest_countermeasure')) {
      const already = req.countermeasureLog ?? [];
      const pending = already.some((cm) => cm.helped === undefined);
      const pick = pending ? null : pickCountermeasure(assessment.cues, already.map((cm) => cm.id));
      if (pick) await send({ type: 'action', action: { origin: 'fast_path', type: 'suggest_countermeasure', suggestion: pick } });
    }
    // Tell the doctors on Earth when the concern level calls for it.
    if (shouldAutoReport(assessment.concernLevel, req.previousAssessment?.concernLevel ?? null) && !actions.some((a) => a.type === 'queue_earth_packet')) {
      await send({
        type: 'action',
        action: { origin: 'fast_path', type: 'queue_earth_packet', urgency: urgencyForConcern(assessment.concernLevel), note: `Behavioural health: ${assessment.summary}` },
      });
    }
    await send({ type: 'assessment', assessment });

    if (db && conversationId && astronautId && replyText) {
      try {
        await logMessage(db, {
          conversationId,
          role: 'assistant',
          content: replyText,
          provider: replyMeta.provider ?? null,
          model: replyMeta.model ?? null,
          source: replyMeta.source === 'live_ai' ? 'ai' : 'offline_verified_cache',
          contextSnapshot: {
            scenarioId: snapshot.scenarioId,
            locationId: req.locationId ?? null,
            tier,
            modality: req.modality,
            readinessScore: snapshot.readinessScore,
            zoneStatuses: snapshot.zoneStatuses,
            actions: actions.map((a) => a.type),
            mentalState: { concernLevel: assessment.concernLevel, score: assessment.score, mood: assessment.mood, stress: assessment.stress, fatigue: assessment.fatigue, trend: assessment.trend },
            cameraUsed: Boolean(req.observation),
          },
          triageEventId: await latestTriageEventId(db, astronautId),
          crisisFlag: flags.crisis,
        });
      } catch (err) {
        console.error('[ARGUS converse] could not store reply', err);
      }
    }
    await send({ type: 'done' });
  });
});

void BODY_ZONES;
