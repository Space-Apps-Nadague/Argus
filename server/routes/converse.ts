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
import type {
  AssessRequest,
  AssessResponse,
  AssistantAction,
  AssistantToolRequest,
  AssistantToolResponse,
  ConverseEvent,
  ConverseRequest,
  LiveSessionRequest,
  LiveSessionResponse,
  MentalStateAssessment,
  VisualObservation,
} from '../../src/types/assistant';
import { SPACE_LOCATIONS, commDelayAt, formatCommDelay } from '../../src/data/spaceLocations';
import { determineCompanionIntent, generateOfflineCompanionReply } from '../../src/utils/companionBrain';
import { BODY_ZONES } from '../../src/data/telemetryScenarios';
import { STATUS_LABELS } from '../../src/utils/triageEngine';
import { COMM_TIER_PROFILES, type CommTier, resolveCommTier, roundTripSeconds } from '../../shared/commProfile';
import { pickCountermeasure } from '../../shared/countermeasures';
import { combineAssessment, CUE_IDS, extractCuesFromText, shouldAutoReport, urgencyForConcern } from '../../shared/mentalState';
import { detectRedFlags } from '../../shared/redFlags';
import { ASSISTANT_TOOLS, runAssistantTool, type ToolContext } from '../ai/assistantTools';
import { logCitations } from '../rag/citations';
import { searchKnowledge } from '../rag/retriever';
import { formatKnowledgeForPrompt, LOOKUP_MEDICAL_PROTOCOL, lookupMedicalProtocol } from '../rag/tool';
import type { RagHit } from '../../src/types/aiApi';
import { type ChatMessage, completeJson, providerChainFor, streamChat } from '../ai/llm';
import type { AppEnv } from '../auth/types';
import { getOrStartConversation, latestTriageEventId, logMessage } from '../db/chatLog';
import { type CrewSnapshot, buildCrewSnapshot, formatSnapshotForPrompt } from '../models/crewSnapshot';
import { computeWellbeing, CRISIS_ESCALATION_MESSAGE } from '../models/wellbeingModel';
import { buildAssistantPrompt, jsonInstruction, MENTAL_STATE_EXTRACTION_PROMPT } from '../prompts';
import { AssessRequestSchema, AssistantToolRequestSchema, ConverseRequestSchema, LiveSessionRequestSchema, MentalStateLlmSchema } from '../schemas';
import { DEFAULT_GEMINI_VOICE, isGeminiVoice } from '../ai/geminiVoices';
import { buildAssistantLiveSetup, mintLiveToken } from '../ai/geminiLive';
import { assistantToolsForLive } from '../ai/assistantTools';
import { offlineReply } from './chat';
import { keyFromHeader, parseBody } from './util';
import {
  DEFAULT_LIVE_MODEL,
  executeVoiceToolCall,
  maxUrgency,
  parseSpokenVitalLogCommand,
  resolveGeminiApiKey,
  urgencyFloorForStatus,
  worstZoneStatus,
} from './voice';

export const converseRoutes = new Hono<AppEnv>();

const EMERGENCY_TITLES: Record<string, string> = {
  fire: 'Fire or smoke emergency',
  depress: 'Rapid depressurisation emergency',
  toxic: 'Toxic atmosphere ammonia leak emergency',
  medical: 'Crew medical emergency',
  radiation: 'Solar particle event radiation emergency',
  co2: 'High CO2 hypercapnia emergency',
};

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

function secondEmotion(o: VisualObservation): string {
  if (!o.emotion) return '';
  const second = Object.entries(o.emotion.scores)
    .filter(([label]) => label !== o.emotion!.label && label !== 'neutral')
    .sort((a, b) => b[1] - a[1])[0];
  return second && second[1] >= 0.15 ? `, with some ${second[0]} (${Math.round(second[1] * 100)}%)` : '';
}

export function describeObservation(o: VisualObservation): string {
  if (!o.facePresent) return 'They are not in frame right now.';
  const lines = [
    o.fatigue ? `Fatigue signs: ${o.fatigue}` : '',
    o.blinkRatePerMin != null ? `Blink rate: ${Math.round(o.blinkRatePerMin)}/min` : '',
    o.perclos != null ? `Eyes mostly closed ${Math.round(o.perclos * 100)}% of the time` : '',
    o.yawnsPerMin ? `Yawns: ${o.yawnsPerMin.toFixed(1)}/min` : '',
    o.emotion && o.emotion.confidence >= 0.35
      ? `Facial emotion: mostly ${o.emotion.label} (${Math.round(o.emotion.confidence * 100)}% of the time)${secondEmotion(o)}`
      : '',
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
export function offlineAssistantReply(snapshot: CrewSnapshot, lastUser: string, assessment: MentalStateAssessment, hasProtocol: boolean, cardTitle: string | null = null): string {
  const name = snapshot.crewMember?.callsign ?? 'there';
  if (hasProtocol) return `${name}, the checklist is on your screen. Work through it one step at a time and tell me "done" after each one. I am staying with you.`;

  const lead = `${name}, my AI model isn't reachable right now, so my answers are simpler than usual.`;

  // 1. Feelings first: answer the person, not the data.
  const feel = extractCuesFromText([lastUser]).cues;
  const strongest = CUE_IDS.filter((id) => feel[id] > 0).sort((x, y) => feel[y] - feel[x])[0];
  if (strongest || assessment.concernLevel !== 'none') {
    const named: Record<string, string> = {
      stress: 'Feeling stressed about it makes sense, especially with this much riding on you so far from home.',
      anxiety: 'Feeling anxious about it is a normal reaction out here, and it does not mean something is wrong with you.',
      lowMood: 'I am sorry you are feeling low. That is hard, and it is worth taking seriously.',
      hopelessness: 'That sounds really heavy, and I am glad you told me.',
      isolation: 'Missing people and feeling cut off is one of the hardest parts of being this far away.',
      sleepProblem: 'Bad sleep makes everything else harder, so it is worth fixing first.',
      fatigue: 'Being this tired wears you down, physically and mentally.',
      conflict: 'Friction with crewmates is draining when there is nowhere to step away to.',
      lowMotivation: 'Losing drive happens on long missions, and it usually comes back with rest and routine.',
    };
    return [
      `${name}, I hear you. ${named[strongest ?? 'stress'] ?? named.stress}`,
      cardTitle ? `I have put something on your screen you can try right now: ${cardTitle}. Give it a go, then tell me how it went.` : '',
      `What is weighing on you most about it? (${lead.replace(`${name}, `, '').replace(/^m/, 'M')})`,
    ].filter(Boolean).join(' ');
  }

  // 2. A symptom, reading or clinical question: the onboard protocols.
  const intent = determineCompanionIntent(lastUser);
  if (snapshot.crewMember && ['symptom', 'metric', 'radiation', 'why', 'status'].includes(intent)) {
    const brain = generateOfflineCompanionReply(lastUser, {
      crewMember: snapshot.crewMember,
      environment: snapshot.environment,
      scenarioId: snapshot.scenarioId,
      readinessScore: snapshot.readinessScore,
      zoneStatuses: snapshot.zoneStatuses,
      zones: snapshot.zones,
      commDelay: snapshot.location ? formatCommDelay(snapshot.location) : undefined,
    });
    return `${lead} From the onboard protocols: ${brain.text}`;
  }

  // 3. Anything else: be honest and invite them in, no data dump.
  return `${lead} I can still help with symptoms, readings, emergencies, or just talking through how you feel. What is going on?`;
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

/**
 * Verified protocol chunks for this turn (spec 04 §4.5). Only keyword-matched chunks are kept,
 * so a conversation about feelings is not given (or shown) unrelated clinical references.
 * During an emergency the protocol itself is always looked up.
 */
const CLINICAL_WORDS =
  /\b(symptom|pain|ache|hurts?|headache|dizz|nause|vomit|fever|rash|swell|bleed|cough|breath|chest|heart|pulse|blood|pressure|oxygen|spo2|co2|carbon|eye|eyes|vision|blur|ear|bone|muscle|injur|wound|burn|cut|fracture|sprain|infection|sick|ill|radiation|dose|dosimeter|solar|medication|medicine|pill|tablet|drug|dose|ibuprofen|paracetamol|aspirin|antibiotic|treat|treatment|procedure|protocol|checklist|emergency|fire|smoke|leak|ammonia|toxic|depress|glucose|sugar|hydration|dehydrat|sleep(ing)? pill|melatonin|sans|onsd|intracranial)\w*/i;

/** Only clinical or procedural messages get knowledge-base references. */
export function isClinicalQuestion(text: string): boolean {
  if (detectRedFlags(text).flagged) return true;
  if (['symptom', 'metric', 'radiation', 'red_flag'].includes(determineCompanionIntent(text))) return true;
  return CLINICAL_WORDS.test(text);
}

export async function retrieveForTurn(lastUser: string, protocolTitle: string | undefined, db: Parameters<typeof searchKnowledge>[0]['db']): Promise<RagHit[]> {
  const queries = [protocolTitle, isClinicalQuestion(lastUser) ? lastUser : undefined].filter((q): q is string => Boolean(q && q.trim().length >= 4));
  const seen = new Set<string>();
  const out: RagHit[] = [];
  for (const query of queries) {
    try {
      const { hits } = await searchKnowledge({ query, limit: 3, db });
      for (const h of hits) {
        const key = h.chunkId ?? `${h.documentId}#${h.heading}`;
        if (h.keywordRank === null || seen.has(key)) continue;
        seen.add(key);
        out.push(h);
      }
    } catch (err) {
      console.warn('[ARGUS converse] knowledge lookup failed:', (err as Error).message);
    }
  }
  return out.slice(0, 3);
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

  // Pick the "try this now" card before the reply so what ARGUS says and what appears match.
  const pendingCard = (req.countermeasureLog ?? []).some((cm) => cm.helped === undefined);
  // A clear feeling in the latest message is enough for a card, even before the overall concern rises.
  const latestCues = extractCuesFromText([lastUser]).cues;
  const wantsCard = preAssessment.concernLevel !== 'none' || CUE_IDS.some((id) => latestCues[id] >= 2);
  const readyCard =
    wantsCard && !req.activeProtocol && !pendingCard
      ? pickCountermeasure(preAssessment.concernLevel !== 'none' ? preAssessment.cues : latestCues, (req.countermeasureLog ?? []).map((cm) => cm.id))
      : null;
  const startedProtocol = fast.find((a) => a.type === 'start_emergency_protocol');

  const db = c.get('db');
  // The running protocol is looked up only when the message is about it ("done", "what next"…).
  const aboutProtocol = Boolean(req.activeProtocol) && (lastUser.trim().split(/\s+/).length <= 6 || STEP_DONE.test(lastUser) || /\b(step|next|now what|what now|checklist|protocol)\b/i.test(lastUser));
  const protocolQuery = startedProtocol ? EMERGENCY_TITLES[startedProtocol.protocolId] : aboutProtocol ? req.activeProtocol!.title : undefined;
  const ragHits = await retrieveForTurn(lastUser, protocolQuery, db);

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
    countermeasures:
      [
        ...(req.countermeasureLog ?? []).map((cm) => `- ${cm.title}${cm.helped === undefined ? ' (ask whether it helped)' : cm.helped ? ' (helped)' : ' (did not help)'}`),
        readyCard
          ? `CARD READY: after your reply, a "${readyCard.title}" card (${readyCard.instruction}) appears on their screen. If you suggest something to try, suggest this one by name, unless you call suggest_countermeasure with a different one. Do not promise any other card.`
          : '',
      ]
        .filter(Boolean)
        .join('\n') || undefined,
    crisis: flags.crisis,
    redFlag: Boolean(startedProtocol),
    toolsAvailable,
    knowledge: ragHits.length ? formatKnowledgeForPrompt(ragHits) : undefined,
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
      await send({ type: 'meta', meta, tier, crisis: flags.crisis, redFlag: flags.flagged, earthConsultUrgency: urgency, ragHits });
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
      executeTool: async (name, args) => {
        if (name === LOOKUP_MEDICAL_PROTOCOL) {
          const r = await lookupMedicalProtocol(args, { db, astronautId: req.crewMember?.id ?? null, mode: 'chat' });
          const fresh = r.hits.filter((h) => !ragHits.some((x) => x.documentId === h.documentId && x.heading === h.heading));
          if (fresh.length) {
            ragHits.push(...fresh);
            await send({ type: 'sources', ragHits: fresh });
          }
          const { hits: _hits, ...forModel } = r;
          return forModel;
        }
        return runAssistantTool(name, args, ctx).result;
      },
    })) {
      if (chunk.type === 'start') {
        await sendMeta({ source: 'live_ai', provider: chunk.provider, model: chunk.model, latencyMs: Date.now() - started });
      } else if (chunk.type === 'text') {
        await send({ type: 'delta', text: chunk.text });
      } else if (chunk.type === 'tool_call') {
        if (chunk.name === LOOKUP_MEDICAL_PROTOCOL) continue;
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
        for (const piece of chunkText(offlineAssistantReply(snapshot, lastUser, assessment, Boolean(req.activeProtocol || startedProtocol), readyCard?.title ?? null))) {
          await send({ type: 'delta', text: piece });
        }
      }
    }
    await send({ type: 'reply_end' });

    // A countermeasure card whenever there is real strain and the model did not offer one.
    if ((assessment.concernLevel !== 'none' || readyCard) && !emergency && !actions.some((a) => a.type === 'suggest_countermeasure')) {
      const already = req.countermeasureLog ?? [];
      const pending = already.some((cm) => cm.helped === undefined);
      const pick = readyCard ?? (pending ? null : pickCountermeasure(assessment.cues, already.map((cm) => cm.id)));
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
        const assistantMessageId = await logMessage(db, {
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
        if (ragHits.length) {
          await logCitations(db, { mode: 'chat', query: lastUser, hits: ragHits, astronautId, messageId: assistantMessageId });
        }
      } catch (err) {
        console.error('[ARGUS converse] could not store reply', err);
      }
    }
    await send({ type: 'done' });
  });
});

// ── Live tier: full-duplex session straight from the browser to Earth ────────

converseRoutes.post('/live-session', async (c) => {
  const body = await parseBody(c, LiveSessionRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data as LiveSessionRequest;
  const { tier, oneWaySec } = tierForRequest(req);
  const unavailable = (reason: string) => c.json({ available: false, tier, reason } satisfies LiveSessionResponse);

  if (tier !== 'live') return unavailable(tier === 'relay' ? 'Too far from Earth for a live session.' : 'On-ship mode: no Earth link.');
  const geminiKey = resolveGeminiApiKey(process.env, keyFromHeader(c));
  if (!geminiKey) return unavailable('No Earth AI key configured.');
  const token = await mintLiveToken(geminiKey);
  if (!token) return unavailable('Earth AI did not answer.');

  const snapshot = buildCrewSnapshot(req);
  const userMessages = (req.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content);
  const wellbeing = req.checkIns?.length ? computeWellbeing(req.checkIns, snapshot.zones) : null;
  const assessment =
    req.previousAssessment ??
    combineAssessment({
      userMessages,
      observation: req.observation,
      selfReport: wellbeing ? { riskScore: wellbeing.riskScore, status: wellbeing.status, trend: wellbeing.trend } : null,
      physiology: { behavioralStatus: snapshot.zoneStatuses.behavioral },
    });
  const recent = (req.messages ?? []).slice(-8).map((m) => `${m.role === 'user' ? 'Crew' : m.role === 'earth' ? 'Earth doctors' : 'You'}: ${m.content}`).join('\n');
  const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const voice = isGeminiVoice(req.voice) ? req.voice : DEFAULT_GEMINI_VOICE;
  const systemInstruction = [
    buildAssistantPrompt({
      tier,
      modality: 'voice',
      data: formatSnapshotForPrompt(snapshot, { allMetrics: true }),
      earthRoundTrip: oneWaySec > 0.5 ? formatDuration(roundTripSeconds(oneWaySec)) : undefined,
      observation: req.observation ? describeObservation(req.observation) : undefined,
      mentalState: describeAssessment(assessment),
      activeProtocol: req.activeProtocol
        ? `${req.activeProtocol.title}\n${req.activeProtocol.steps.map((s, i) => `${i + 1}. [${req.activeProtocol!.completedSteps.includes(i + 1) ? 'x' : ' '}] ${s}`).join('\n')}`
        : undefined,
      guidedSteps: !req.activeProtocol && req.guidedSteps?.length ? req.guidedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : undefined,
      countermeasures: req.countermeasureLog?.length ? req.countermeasureLog.map((cm) => `- ${cm.title}`).join('\n') : undefined,
      toolsAvailable: true,
    }),
    'You can see them through the camera: frames arrive about once a second.',
    recent ? `EARLIER IN THIS CONVERSATION\n${recent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response: LiveSessionResponse = {
    available: true,
    tier,
    wsUrl: token.wsUrl,
    model,
    voice,
    expiresAtIso: token.expiresAtIso,
    setup: buildAssistantLiveSetup({ model, voice, systemInstruction, tools: assistantToolsForLive() }),
  };
  return c.json(response);
});

/** Validates one tool call made inside a live session and returns the action to carry out. */
converseRoutes.post('/assistant-tool', async (c) => {
  const body = await parseBody(c, AssistantToolRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data as AssistantToolRequest;
  if (req.name === LOOKUP_MEDICAL_PROTOCOL) {
    const r = await lookupMedicalProtocol(req.args, { db: c.get('db'), astronautId: req.crewMember?.id ?? null, mode: 'live-api' });
    const { hits, ...forModel } = r;
    return c.json({ result: forModel as unknown as Record<string, unknown>, ragHits: hits } satisfies AssistantToolResponse);
  }
  const full = { ...req, messages: [], modality: 'voice' } as ConverseRequest;
  const outcome = runAssistantTool(req.name, req.args, toolContext(full, buildCrewSnapshot(req)));
  return c.json({ result: outcome.result, action: outcome.action } satisfies AssistantToolResponse);
});

/**
 * The non-conversation half of a turn, for turns spoken over a live session: fast-path
 * actions, mental state, countermeasure, Earth report and the chat log.
 */
converseRoutes.post('/assess', async (c) => {
  const body = await parseBody(c, AssessRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data as AssessRequest;
  const snapshot = buildCrewSnapshot(req);
  const { tier } = tierForRequest(req);
  const userMessages = req.messages.filter((m) => m.role === 'user').map((m) => m.content);
  const lastUser = userMessages[userMessages.length - 1] ?? '';
  const flags = detectRedFlags(lastUser);
  const wellbeing = req.checkIns?.length ? computeWellbeing(req.checkIns, snapshot.zones) : null;

  const actions = fastPathActions(req, lastUser, snapshot);
  const assessment = combineAssessment({
    userMessages,
    observation: req.observation,
    selfReport: wellbeing ? { riskScore: wellbeing.riskScore, status: wellbeing.status, trend: wellbeing.trend } : null,
    physiology: { behavioralStatus: snapshot.zoneStatuses.behavioral },
    previous: req.previousAssessment,
  });
  if (assessment.concernLevel !== 'none' && !req.activeProtocol) {
    const already = req.countermeasureLog ?? [];
    const pick = already.some((cm) => cm.helped === undefined) ? null : pickCountermeasure(assessment.cues, already.map((cm) => cm.id));
    if (pick) actions.push({ origin: 'fast_path', type: 'suggest_countermeasure', suggestion: pick });
  }
  if (shouldAutoReport(assessment.concernLevel, req.previousAssessment?.concernLevel ?? null) && !actions.some((a) => a.type === 'queue_earth_packet')) {
    actions.push({ origin: 'fast_path', type: 'queue_earth_packet', urgency: urgencyForConcern(assessment.concernLevel), note: `Behavioural health: ${assessment.summary}` });
  }

  const db = c.get('db');
  const astronautId = req.crewMember?.id;
  if (db && astronautId && lastUser) {
    try {
      const user = c.get('user');
      const conversationId = await getOrStartConversation(db, astronautId, user?.id ?? null);
      await logMessage(db, { conversationId, role: 'user', authorUserId: user?.id ?? null, content: lastUser, crisisFlag: flags.crisis });
      if (req.assistantReply) {
        await logMessage(db, {
          conversationId,
          role: 'assistant',
          content: req.assistantReply,
          provider: 'gemini',
          model: process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL,
          source: 'ai',
          contextSnapshot: { tier, modality: 'voice', live: true, mentalState: { concernLevel: assessment.concernLevel, score: assessment.score } },
          crisisFlag: flags.crisis,
        });
      }
    } catch (err) {
      console.error('[ARGUS assess] could not store turn', err);
    }
  }

  const response: AssessResponse = {
    tier,
    crisis: flags.crisis,
    redFlag: flags.flagged,
    earthConsultUrgency: maxUrgency(
      urgencyFloorForStatus(worstZoneStatus(snapshot.zoneStatuses)),
      flags.flagged ? 'immediate_emergency_packet' : urgencyForConcern(assessment.concernLevel)
    ),
    actions,
    assessment,
  };
  return c.json(response);
});

void BODY_ZONES;
