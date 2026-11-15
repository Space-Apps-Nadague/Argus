/**
 * POST /api/ai/chat — streaming crew companion (Server-Sent Events, see `ChatStreamEvent`).
 * Crisis detection runs before any model; with no provider, a deterministic offline brain answers.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { BodyZoneId } from '../../src/types/argus';
import type { ChatStreamEvent, EarthConsultUrgency } from '../../src/types/aiApi';
import { BODY_ZONES, getOfflineFlightSurgeonGuidance } from '../../src/data/telemetryScenarios';
import { STATUS_LABELS } from '../../src/utils/triageEngine';
import { type ChatMessage, streamChat } from '../ai/llm';
import { type CrewSnapshot, buildCrewSnapshot, formatSnapshotForPrompt } from '../models/crewSnapshot';
import { computeWellbeing, CRISIS_ESCALATION_MESSAGE, detectCrisisLanguage } from '../models/wellbeingModel';
import { COMPANION_PERSONA } from '../prompts';
import { ChatRequestSchema } from '../schemas';
import { getOrStartConversation, latestTriageEventId, logMessage } from '../db/chatLog';
import type { AppEnv } from '../auth/types';
import { logCitations } from '../rag/citations';
import { searchKnowledge } from '../rag/retriever';
import { formatKnowledgeForPrompt } from '../rag/tool';
import { keyFromHeader, parseBody } from './util';

export const chatRoutes = new Hono<AppEnv>();

const ZONE_KEYWORDS: Array<[BodyZoneId, RegExp]> = [
  ['neuro', /\b(eye|eyes|vision|blurry|head|headache|onsd|pressure|brain|co2|carbon)\b/i],
  ['cardio', /\b(heart|pulse|hr|hrv|chest|oxygen|spo2|breath|breathing)\b/i],
  ['musculo', /\b(bone|bones|muscle|muscles|back|ared|exercise|workout|strength)\b/i],
  ['metabolic', /\b(glucose|blood\s*sugar|cgm|insulin|metabolic|nutrition|calor|appetite)\b/i],
  ['immune', /\b(radiation|dose|solar|storm|immune|infection|sick|fever|blood)\b/i],
  ['behavioral', /\b(sleep|tired|fatigue|stress|stressed|mood|sad|lonely|anxious|anxiety|focus|reaction)\b/i],
];

/** Deterministic offline reply grounded in the snapshot (used when no provider answers). */
export function offlineReply(snapshot: CrewSnapshot, question: string): string {
  const name = snapshot.crewMember?.callsign ?? 'crew';
  const zone = ZONE_KEYWORDS.find(([, re]) => re.test(question))?.[0];

  if (zone) {
    const status = snapshot.zoneStatuses[zone];
    const readings = snapshot.zones[zone]
      .map((r) => `${r.label} ${r.currentValue} ${r.unit}`)
      .join(', ');
    const guidance = getOfflineFlightSurgeonGuidance(
      snapshot.scenarioId,
      zone,
      snapshot.environment,
      snapshot.crewMember
    );
    const firstStep = guidance.guidedSteps[0];
    return `${name}, your ${BODY_ZONES[zone].name} zone is ${STATUS_LABELS[status]} (${readings}). ${guidance.plainLanguageExplanation}${firstStep ? ` A good first step: ${firstStep.title} — ${firstStep.plainInstruction}` : ''} (Offline mode — onboard protocols only.)`;
  }

  const flagged = snapshot.flaggedTrends.slice(0, 3).map((t) => `${t.label} (${t.status.toUpperCase()}, ${t.level})`);
  return flagged.length
    ? `${name}, your readiness is ${snapshot.readinessScore}%. Worth watching: ${flagged.join('; ')}. Ask me about any of these and I'll walk you through the onboard protocol. (Offline mode — onboard protocols only.)`
    : `${name}, your readiness is ${snapshot.readinessScore}% and every zone is nominal. Keep up your countermeasures — ask me about sleep, exercise, radiation or how you're feeling. (Offline mode — onboard protocols only.)`;
}

function chunkText(text: string, size = 24): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  for (const w of words) {
    current += w;
    if (current.length >= size) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

chatRoutes.post('/chat', async (c) => {
  const body = await parseBody(c, ChatRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;

  const snapshot = buildCrewSnapshot(req);
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const crisis = detectCrisisLanguage(lastUser);
  const wellbeing = req.checkIns?.length ? computeWellbeing(req.checkIns, snapshot.zones) : null;
  const urgency: EarthConsultUrgency = crisis.crisis ? 'immediate_emergency_packet' : 'routine_downlink';
  const db = c.get('db');
  const matchedZone = ZONE_KEYWORDS.find(([, re]) => re.test(lastUser))?.[0];
  const { hits: ragHits } = await searchKnowledge({
    query: lastUser,
    zoneId: matchedZone,
    limit: 3,
    db,
  });

  const system = [
    COMPANION_PERSONA,
    `DATA\n${formatSnapshotForPrompt(snapshot)}`,
    formatKnowledgeForPrompt(ragHits),
    wellbeing
      ? `Behavioral-health self-report model: risk ${wellbeing.riskScore}/100 (${wellbeing.status.toUpperCase()}), trend ${wellbeing.trend}.`
      : '',
    crisis.crisis
      ? 'The crew member just used crisis language. A fixed escalation message has already been shown telling them to contact the Crew Medical Officer and behavioral health team now. Respond with warmth, stay with them, reinforce reaching out to a person immediately, and do not minimize.'
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...req.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  // AI chat link (spec 05 §3.5): store the question now, the reply when the stream ends.
  const user = c.get('user');
  const astronautId = req.crewMember?.id;
  let conversationId: string | null = null;
  if (db && astronautId && lastUser) {
    try {
      conversationId = await getOrStartConversation(db, astronautId, user?.id ?? null);
      await logMessage(db, { conversationId, role: 'user', authorUserId: user?.id ?? null, content: lastUser, crisisFlag: crisis.crisis });
    } catch (err) {
      console.error('[ARGUS chat] could not store message', err);
      conversationId = null;
    }
  }
  const contextSnapshot = {
    scenarioId: snapshot.scenarioId,
    locationId: req.locationId ?? null,
    readinessScore: snapshot.readinessScore,
    zoneStatuses: snapshot.zoneStatuses,
    flaggedMetrics: snapshot.flaggedTrends.map((t) => ({ metricId: t.metricId, value: t.currentValue, status: t.status, z: t.zScore, level: t.level })),
    wellbeing: wellbeing ? { riskScore: wellbeing.riskScore, status: wellbeing.status, trend: wellbeing.trend } : null,
    citations: ragHits.map((h) => ({ documentId: h.documentId, sourceId: h.sourceId, rank: h.rank })),
  };

  return streamSSE(c, async (stream) => {
    let replyText = '';
    let replyMeta: { source?: string; provider?: string; model?: string } = {};
    const send = (event: ChatStreamEvent) => {
      if (event.type === 'delta') replyText += event.text;
      if (event.type === 'meta') replyMeta = { source: event.meta.source, provider: event.meta.provider, model: event.meta.model };
      return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    };

    let metaSent = false;
    const sendMeta = async (meta: Extract<ChatStreamEvent, { type: 'meta' }>['meta']) => {
      if (metaSent) return;
      metaSent = true;
      await send({ type: 'meta', meta, crisis: crisis.crisis, earthConsultUrgency: urgency, ragHits });
      if (crisis.crisis) {
        await send({ type: 'delta', text: `${CRISIS_ESCALATION_MESSAGE}\n\n` });
      }
    };

    const started = Date.now();
    for await (const chunk of streamChat(messages, { feature: 'chat', keyOverride: keyFromHeader(c) })) {
      if (chunk.type === 'start') {
        await sendMeta({ source: 'live_ai', provider: chunk.provider, model: chunk.model, latencyMs: Date.now() - started });
      } else if (chunk.type === 'text') {
        await send({ type: 'delta', text: chunk.text });
      } else if (chunk.type === 'error') {
        await send({ type: 'error', message: chunk.message });
      }
    }

    if (!metaSent) {
      await sendMeta({ source: 'offline_verified_cache' });
      if (!crisis.crisis) {
        for (const piece of chunkText(offlineReply(snapshot, lastUser))) {
          await send({ type: 'delta', text: piece });
        }
      }
    }
    if (db && conversationId && astronautId && replyText) {
      try {
        const assistantMessageId = await logMessage(db, {
          conversationId,
          role: 'assistant',
          content: replyText,
          provider: replyMeta.provider ?? null,
          model: replyMeta.model ?? null,
          source: replyMeta.source === 'live_ai' ? 'ai' : 'offline_verified_cache',
          contextSnapshot,
          triageEventId: await latestTriageEventId(db, astronautId),
          crisisFlag: crisis.crisis,
        });
        if (ragHits.length > 0) {
          await logCitations(db, {
            mode: 'chat',
            query: lastUser,
            hits: ragHits,
            astronautId,
            messageId: assistantMessageId,
          });
        }
      } catch (err) {
        console.error('[ARGUS chat] could not store reply', err);
      }
    }
    await send({ type: 'done' });
  });
});
