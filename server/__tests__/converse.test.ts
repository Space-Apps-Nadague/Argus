/**
 * /api/ai/converse with no provider configured: fast-path actions, crisis handling, tier
 * resolution and the deterministic mental-state assessment (no network calls).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { ConverseEvent } from '../../src/types/assistant';
import { DEFAULT_CREW_ROSTER } from '../../src/data/telemetryScenarios';
import { ASSISTANT_TOOLS, assistantToolsForLive, runAssistantTool, type ToolContext } from '../ai/assistantTools';
import { resolveProviderChain } from '../ai/providers';
import { createApp } from '../app';
import { buildAssistantPrompt } from '../prompts';
import { tierForRequest } from '../routes/converse';

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (['AI_', 'OPENROUTER_', 'GEMINI_', 'GROQ_'].some((p) => key.startsWith(p))) delete process.env[key];
  }
});

const app = createApp();
const crewMember = DEFAULT_CREW_ROSTER[0];

async function converse(body: Record<string, unknown>): Promise<ConverseEvent[]> {
  const res = await app.request('/api/ai/converse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'nominal', crewMember, modality: 'text', ...body }),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  return text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)) as ConverseEvent);
}

const reply = (events: ConverseEvent[]) => events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');
const actions = (events: ConverseEvent[]) => events.flatMap((e) => (e.type === 'action' ? [e.action] : []));

describe('POST /api/ai/converse (offline)', () => {
  it('rejects a body with no messages', async () => {
    const res = await app.request('/api/ai/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'nominal', modality: 'text', messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('answers conversationally and ends with assessment then done', async () => {
    const events = await converse({ messages: [{ role: 'user', content: 'How am I doing today?' }] });
    expect(reply(events).length).toBeGreaterThan(40);
    expect(reply(events)).not.toMatch(/Offline mode/);
    const types = events.map((e) => e.type);
    expect(types.indexOf('reply_end')).toBeLessThan(types.indexOf('assessment'));
    expect(types[types.length - 1]).toBe('done');
  });

  it('logs a spoken vital on the fast path, before any reply text', async () => {
    const events = await converse({ modality: 'voice', messages: [{ role: 'user', content: 'Log resting heart rate 68' }] });
    const firstAction = events.findIndex((e) => e.type === 'action');
    const firstDelta = events.findIndex((e) => e.type === 'delta');
    expect(firstAction).toBeGreaterThanOrEqual(0);
    expect(firstAction).toBeLessThan(firstDelta);
    expect(actions(events)[0]).toMatchObject({ type: 'log_checkin_reading', origin: 'fast_path', metricId: 'resting_hr', value: 68, ok: true });
  });

  it('opens the emergency protocol and an immediate Earth report on a red flag', async () => {
    const events = await converse({ messages: [{ role: 'user', content: 'I have crushing chest pain and I feel faint' }] });
    const acts = actions(events);
    expect(acts[0]).toMatchObject({ type: 'start_emergency_protocol', protocolId: 'medical', origin: 'fast_path' });
    expect(acts[1]).toMatchObject({ type: 'queue_earth_packet', urgency: 'immediate_emergency_packet' });
    const meta = events.find((e) => e.type === 'meta');
    expect(meta).toMatchObject({ redFlag: true, earthConsultUrgency: 'immediate_emergency_packet' });
    expect(events.findIndex((e) => e.type === 'action')).toBeLessThan(events.findIndex((e) => e.type === 'meta'));
  });

  it('maps a habitat emergency to its own protocol', async () => {
    const events = await converse({ messages: [{ role: 'user', content: 'There is smoke coming from the galley' }] });
    expect(actions(events)[0]).toMatchObject({ type: 'start_emergency_protocol', protocolId: 'fire' });
  });

  it('leads with the fixed escalation on crisis language and marks the assessment urgent', async () => {
    const events = await converse({ messages: [{ role: 'user', content: "I don't want to live anymore" }] });
    expect(events.find((e) => e.type === 'meta')).toMatchObject({ crisis: true });
    expect(reply(events)).toMatch(/Crew Medical Officer/);
    const assessment = events.find((e) => e.type === 'assessment');
    expect(assessment).toMatchObject({ assessment: { concernLevel: 'urgent' } });
  });

  it('ticks the next open step when the crew member says "done" during a protocol', async () => {
    const events = await converse({
      messages: [{ role: 'user', content: 'done' }],
      activeProtocol: { protocolId: 'fire', title: 'Fire or smoke', steps: ['a', 'b', 'c'], completedSteps: [1] },
    });
    expect(actions(events)[0]).toMatchObject({ type: 'mark_step_done', stepNumber: 2 });
  });

  it('offers support, a countermeasure and an Earth report when the crew member is struggling', async () => {
    const events = await converse({
      messages: [{ role: 'user', content: "I feel hopeless, I can't sleep and I miss my family so much" }],
    });
    const acts = actions(events);
    expect(acts.some((a) => a.type === 'suggest_countermeasure')).toBe(true);
    expect(acts.find((a) => a.type === 'queue_earth_packet')).toMatchObject({ urgency: 'priority_packet' });
    expect(events.find((e) => e.type === 'assessment')).toMatchObject({ assessment: { concernLevel: 'concern' } });
    expect(reply(events)).toMatch(/hear you/i);
    expect(acts.some((a) => a.type === 'start_emergency_protocol')).toBe(false);
  });

  it('does not re-report or stack cards when nothing changed', async () => {
    const first = await converse({ messages: [{ role: 'user', content: "I feel hopeless and I can't sleep" }] });
    const previous = (first.find((e) => e.type === 'assessment') as Extract<ConverseEvent, { type: 'assessment' }>).assessment;
    const second = await converse({
      messages: [{ role: 'user', content: "I feel hopeless and I can't sleep" }, { role: 'assistant', content: '…' }, { role: 'user', content: 'still the same' }],
      previousAssessment: previous,
      countermeasureLog: [{ id: 'sleep_winddown', title: 'Wind-down before sleep' }],
    });
    expect(actions(second).some((a) => a.type === 'queue_earth_packet')).toBe(false);
    expect(actions(second).some((a) => a.type === 'suggest_countermeasure')).toBe(false);
  });

  it('includes camera observations in the assessment', async () => {
    const events = await converse({
      messages: [{ role: 'user', content: 'I am fine' }],
      observation: {
        capturedAtIso: new Date().toISOString(), windowSec: 30, facePresent: true, presenceRatio: 1, blinkRatePerMin: 30, perclos: 0.25,
        yawnsPerMin: 2, affect: 'flat', emotion: null, fatigue: 'high', posture: 'slumped', restlessness: 'low', pulseBpmEstimate: 72, pulseConfidence: 0.7, notes: [],
      },
    });
    const a = (events.find((e) => e.type === 'assessment') as Extract<ConverseEvent, { type: 'assessment' }>).assessment;
    expect(a.fatigue).toBe('high');
    expect(a.evidence.some((e) => e.source === 'camera')).toBe(true);
  });
});

describe('comm tier on the server', () => {
  it('derives the tier from the location and only moves toward autonomy', () => {
    expect(tierForRequest({ locationId: 'leo' }).tier).toBe('live');
    expect(tierForRequest({ locationId: 'lunar_surface' }).tier).toBe('relay');
    expect(tierForRequest({ locationId: 'mars_surface' }).tier).toBe('autonomous');
    expect(tierForRequest({ locationId: 'mars_surface', tierOverride: 'live' }).tier).toBe('autonomous');
    expect(tierForRequest({ locationId: 'leo', tierOverride: 'autonomous' }).tier).toBe('autonomous');
  });

  it('reports the tier in meta', async () => {
    const events = await converse({ locationId: 'mars_surface', messages: [{ role: 'user', content: 'hello' }] });
    expect(events.find((e) => e.type === 'meta')).toMatchObject({ tier: 'autonomous' });
  });

  it('forces a local-only chain when autonomous, even with cloud keys and a typed key', () => {
    const env = { GEMINI_API_KEY: 'AIzaTest', AI_LOCAL_MODEL: 'qwen3:8b', AI_PROVIDERS: 'gemini,local' };
    expect(resolveProviderChain(env, { feature: 'chat' }).map((p) => p.id)).toEqual(['gemini', 'local']);
    expect(resolveProviderChain(env, { feature: 'chat', tier: 'autonomous', keyOverride: 'AIzaOther' }).map((p) => p.id)).toEqual(['local']);
    expect(resolveProviderChain({ GEMINI_API_KEY: 'AIzaTest' }, { feature: 'chat', tier: 'autonomous' })).toEqual([]);
  });
});

describe('assistant tools', () => {
  const ctx: ToolContext = {
    crew: { scenarioId: 'nominal' },
    activeProtocol: { protocolId: 'fire', title: 'Fire', steps: ['a', 'b'], completedSteps: [] },
    logReading: () => ({ ok: true, summary: 'logged', metricId: 'spo2', value: 97, status: 'green', zoneId: 'cardio' }),
    snapshotSummary: () => 'summary',
  };

  it('turns valid calls into actions', () => {
    expect(runAssistantTool('start_emergency_protocol', { protocolId: 'medical', reason: 'x' }, ctx).action).toMatchObject({ type: 'start_emergency_protocol', protocolId: 'medical', origin: 'model' });
    expect(runAssistantTool('mark_step_done', { stepNumber: 2 }, ctx).action).toMatchObject({ type: 'mark_step_done', stepNumber: 2 });
    expect(runAssistantTool('suggest_countermeasure', { id: 'box_breathing' }, ctx).action).toMatchObject({ suggestion: { id: 'box_breathing' } });
    expect(runAssistantTool('log_checkin_reading', { metricId: 'spo2', value: 97 }, ctx).action).toMatchObject({ type: 'log_checkin_reading', ok: true, status: 'green' });
    expect(runAssistantTool('queue_earth_packet', { urgency: 'priority_packet', note: 'n' }, ctx).action).toMatchObject({ urgency: 'priority_packet' });
  });

  it('rejects invalid calls without an action', () => {
    expect(runAssistantTool('start_emergency_protocol', { protocolId: 'aliens' }, ctx).action).toBeUndefined();
    expect(runAssistantTool('mark_step_done', { stepNumber: 9 }, ctx).action).toBeUndefined();
    expect(runAssistantTool('start_emergency_protocol', { protocolId: 'fire' }, ctx).action).toBeUndefined(); // already running
    expect(runAssistantTool('set_guided_steps', { title: 't', steps: ['only one'] }, ctx).action).toBeUndefined();
    expect(runAssistantTool('nope', {}, ctx).result).toMatchObject({ ok: false });
  });

  it('exposes the same tools to Gemini Live', () => {
    const live = assistantToolsForLive();
    expect(live.map((t) => t.name)).toEqual(ASSISTANT_TOOLS.map((t) => t.function.name));
    expect(JSON.stringify(live[0].parameters)).toContain('"OBJECT"');
  });
});

describe('assistant prompt', () => {
  const base = { tier: 'relay' as const, modality: 'text' as const, data: 'DATA-BLOCK', toolsAvailable: true };

  it('keeps the stable persona first and the chart last', () => {
    const a = buildAssistantPrompt(base);
    const b = buildAssistantPrompt({ ...base, observation: 'OBS', mentalState: 'MS' });
    expect(a.startsWith('You are ARGUS')).toBe(true);
    expect(a.trimEnd().endsWith('DATA-BLOCK')).toBe(true);
    const persona = a.slice(0, a.indexOf('\n\nNOW'));
    expect(b.startsWith(persona)).toBe(true);
  });

  it('asks for full conversational answers, not data readouts or sentence caps', () => {
    const p = buildAssistantPrompt(base);
    expect(p).toMatch(/doctor and therapist/);
    expect(p).toMatch(/Give full answers/);
    expect(p).toMatch(/Never answer with a list of readings/);
    expect(p).not.toMatch(/2 to 4 concise/);
  });

  it('switches to terse delivery only during an emergency protocol', () => {
    expect(buildAssistantPrompt(base)).not.toMatch(/EMERGENCY PROTOCOL IS RUNNING/);
    expect(buildAssistantPrompt({ ...base, activeProtocol: 'Fire\n1. [ ] a' })).toMatch(/EMERGENCY PROTOCOL IS RUNNING/);
  });

  it('tells the on-ship tier it is the only clinician', () => {
    expect(buildAssistantPrompt({ ...base, tier: 'autonomous', earthRoundTrip: '25 minutes' })).toMatch(/only clinician.*|about 25 minutes/s);
  });
});

describe('live-tier endpoints (offline)', () => {
  const postJson = async (path: string, body: Record<string, unknown>) => {
    const res = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: 'nominal', crewMember, ...body }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('explains why no live session is available', async () => {
    expect((await postJson('/api/ai/live-session', { locationId: 'mars_surface' })).body).toMatchObject({ available: false, tier: 'autonomous' });
    expect((await postJson('/api/ai/live-session', { locationId: 'lunar_surface' })).body).toMatchObject({ available: false, tier: 'relay' });
    const leo = (await postJson('/api/ai/live-session', { locationId: 'leo' })).body;
    expect(leo).toMatchObject({ available: false, tier: 'live' });
    expect(String(leo.reason)).toMatch(/key/i);
  });

  it('validates a live tool call into an action', async () => {
    const r = await postJson('/api/ai/assistant-tool', { name: 'start_emergency_protocol', args: { protocolId: 'co2', reason: 'alarm' } });
    expect(r.body.action).toMatchObject({ type: 'start_emergency_protocol', protocolId: 'co2' });
    const bad = await postJson('/api/ai/assistant-tool', { name: 'mark_step_done', args: { stepNumber: 1 } });
    expect(bad.body.action).toBeUndefined();
  });

  it('assesses a spoken live turn: fast path, assessment, report', async () => {
    const r = await postJson('/api/ai/assess', {
      modality: 'voice',
      messages: [{ role: 'user', content: "I feel hopeless and so lonely up here" }],
      assistantReply: 'I am here with you.',
    });
    expect(r.status).toBe(200);
    expect(r.body.assessment).toMatchObject({ concernLevel: 'concern' });
    const acts = r.body.actions as Array<{ type: string }>;
    expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(['suggest_countermeasure', 'queue_earth_packet']));
  });
});

describe('countermeasure card matches the reply', () => {
  it('tells the model which card will appear and then shows exactly that card', async () => {
    const res = await app.request('/api/ai/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'nominal', crewMember, modality: 'text', messages: [{ role: 'user', content: "I'm panicking and can't stop worrying" }] }),
    });
    const events = (await res.text()).split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)) as ConverseEvent);
    const cards = events.flatMap((e) => (e.type === 'action' && e.action.type === 'suggest_countermeasure' ? [e.action.suggestion.id] : []));
    expect(cards).toEqual(['box_breathing']);
  });
});
