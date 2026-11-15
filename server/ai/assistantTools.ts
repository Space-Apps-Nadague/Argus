/**
 * Tools the unified assistant can call (specs/04-ai-backend.md §4.2). Each call becomes an
 * `AssistantAction` the HUD carries out; the result string goes back to the model so it can
 * talk about what happened. Deterministic validation stays in code.
 */

import type { BodyZoneId } from '../../src/types/argus';
import type { CrewContextRequest, EarthConsultUrgency } from '../../src/types/aiApi';
import type { ActiveProtocolContext, AssistantAction, CountermeasureKind } from '../../src/types/assistant';
import { COUNTERMEASURES, countermeasureById } from '../../shared/countermeasures';
import type { RedFlagProtocolId } from '../../shared/redFlags';
import type { ChatTool } from './llm';
import { LOOKUP_MEDICAL_PROTOCOL_OPENAI_TOOL } from '../rag/tool';

const PROTOCOL_IDS: RedFlagProtocolId[] = ['fire', 'depress', 'toxic', 'medical', 'radiation', 'co2'];
const URGENCIES: EarthConsultUrgency[] = ['routine_downlink', 'priority_packet', 'immediate_emergency_packet'];
const KINDS: CountermeasureKind[] = ['breathing', 'sleep', 'exercise', 'social', 'workload', 'grounding', 'nutrition', 'medical'];
const ZONES: BodyZoneId[] = ['neuro', 'cardio', 'musculo', 'immune', 'behavioral', 'metabolic'];

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ChatTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const ASSISTANT_TOOLS: ChatTool[] = [
  fn(
    'log_checkin_reading',
    'Log a vital sign the crew member just told you (e.g. "my resting heart rate is 68"). Returns the validated value and its triage status.',
    {
      metricId: {
        type: 'string',
        description:
          'Canonical metric id: onsd, iop, cabin_co2, resting_hr, hrv_rmssd, spo2, systolic_bp, hydration_intake, bmd_delta, ared_load, blood_glucose, caloric_intake, rad_dose, wbc_lymph, core_temp, sleep_eff, pvt_lapses, daily_sleep_hours, mood_index.',
      },
      value: { type: 'number', description: 'Numeric value in the metric\'s canonical unit.' },
      note: { type: 'string', description: 'Optional short note.' },
    },
    ['metricId', 'value']
  ),
  fn(
    'get_crew_snapshot',
    'Read the crew member\'s current triage statuses, readiness score and flagged metrics. Optional zone filter.',
    { zoneId: { type: 'string', enum: ZONES } }
  ),
  fn(
    'start_emergency_protocol',
    'Open and start an emergency protocol checklist on their screen. Use for a real emergency happening now.',
    {
      protocolId: { type: 'string', enum: PROTOCOL_IDS, description: 'fire, depress (pressure loss), toxic (leak), medical, radiation (solar storm), co2.' },
      reason: { type: 'string', description: 'Short reason shown on the card.' },
    },
    ['protocolId']
  ),
  fn(
    'mark_step_done',
    'Tick off a step of the checklist on their screen when they say they finished it.',
    { stepNumber: { type: 'integer', description: '1-based step number.' } },
    ['stepNumber']
  ),
  fn(
    'set_guided_steps',
    'Put a short step-by-step plan on their screen (a self-exam, a procedure, a routine) so they can follow and tick it off.',
    {
      title: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' }, description: '2 to 7 short imperative steps.' },
    },
    ['title', 'steps']
  ),
  fn(
    'suggest_countermeasure',
    `Show a "do this now" card for their mental or physical state. Prefer a catalogue id (${COUNTERMEASURES.map((c) => c.id).join(', ')}); otherwise give title, instruction and durationMinutes.`,
    {
      id: { type: 'string', description: 'Catalogue id, if one fits.' },
      title: { type: 'string' },
      instruction: { type: 'string', description: 'What to do, one or two plain sentences.' },
      durationMinutes: { type: 'integer' },
      kind: { type: 'string', enum: KINDS },
    }
  ),
  fn(
    'request_visual_check',
    'Ask them to show something to the camera for a closer look (an eye, a rash, a wound, a device reading).',
    { target: { type: 'string', description: 'What to show, e.g. "left eye, close up".' } },
    ['target']
  ),
  LOOKUP_MEDICAL_PROTOCOL_OPENAI_TOOL as unknown as ChatTool,
  fn(
    'queue_earth_packet',
    'Send a report about this conversation to the doctors on Earth. Use when something needs their review, or when the crew member asks.',
    {
      urgency: { type: 'string', enum: URGENCIES },
      note: { type: 'string', description: 'What the doctors should know, in two or three sentences.' },
    },
    ['urgency', 'note']
  ),
];

/** Same tools in the Gemini Live `functionDeclarations` shape. */
export function assistantToolsForLive(): Array<{ name: string; description: string; parameters: unknown; behavior: 'NON_BLOCKING' }> {
  const upper = (schema: unknown): unknown => {
    if (Array.isArray(schema)) return schema.map(upper);
    if (schema && typeof schema === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
        out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : k === 'enum' || k === 'required' ? v : upper(v);
      }
      return out;
    }
    return schema;
  };
  return ASSISTANT_TOOLS.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? '',
    parameters: upper(t.function.parameters),
    behavior: 'NON_BLOCKING' as const,
  }));
}

export interface ToolContext {
  crew: CrewContextRequest;
  activeProtocol?: ActiveProtocolContext;
  guidedSteps?: string[];
  /** Runs the deterministic vital logger; injected so tests and the route share one path. */
  logReading: (metricId: string, value: unknown, note?: string) => {
    ok: boolean;
    summary: string;
    zoneId?: BodyZoneId;
    metricId?: string;
    value?: number;
    status?: 'green' | 'yellow' | 'red';
  };
  snapshotSummary: (zoneId?: BodyZoneId) => string;
}

export interface ToolOutcome {
  /** Sent back to the model. */
  result: Record<string, unknown>;
  /** Carried out by the HUD. */
  action?: AssistantAction;
}

const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validates one tool call and turns it into an action. Never throws. */
export function runAssistantTool(name: string, args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  switch (name) {
    case 'log_checkin_reading': {
      const r = ctx.logReading(str(args.metricId, 60), args.value, str(args.note) || undefined);
      return {
        result: { ok: r.ok, summary: r.summary },
        action: {
          origin: 'model',
          type: 'log_checkin_reading',
          metricId: r.metricId ?? str(args.metricId, 60),
          value: r.value ?? Number(args.value),
          zoneId: r.zoneId,
          status: r.status,
          note: str(args.note) || undefined,
          ok: r.ok,
          message: r.summary,
        },
      };
    }
    case 'get_crew_snapshot': {
      const zone = ZONES.includes(args.zoneId as BodyZoneId) ? (args.zoneId as BodyZoneId) : undefined;
      return { result: { ok: true, summary: ctx.snapshotSummary(zone) } };
    }
    case 'start_emergency_protocol': {
      const protocolId = PROTOCOL_IDS.includes(args.protocolId as RedFlagProtocolId) ? (args.protocolId as RedFlagProtocolId) : null;
      if (!protocolId) return { result: { ok: false, error: `Unknown protocol. Use one of: ${PROTOCOL_IDS.join(', ')}.` } };
      if (ctx.activeProtocol?.protocolId === protocolId) return { result: { ok: true, note: 'That protocol is already running.' } };
      return {
        result: { ok: true, note: 'Protocol opened on their screen and started.' },
        action: { origin: 'model', type: 'start_emergency_protocol', protocolId, reason: str(args.reason, 200) || 'Started by ARGUS' },
      };
    }
    case 'mark_step_done': {
      const total = ctx.activeProtocol?.steps.length ?? ctx.guidedSteps?.length ?? 0;
      const n = Math.round(Number(args.stepNumber));
      if (!total) return { result: { ok: false, error: 'There is no checklist on screen.' } };
      if (!Number.isFinite(n) || n < 1 || n > total) return { result: { ok: false, error: `Step must be 1 to ${total}.` } };
      return { result: { ok: true, note: `Step ${n} ticked.` }, action: { origin: 'model', type: 'mark_step_done', stepNumber: n } };
    }
    case 'set_guided_steps': {
      const steps = Array.isArray(args.steps) ? args.steps.map((s) => str(s, 240)).filter(Boolean).slice(0, 7) : [];
      const title = str(args.title, 120);
      if (!title || steps.length < 2) return { result: { ok: false, error: 'Need a title and at least 2 steps.' } };
      return { result: { ok: true, note: 'Steps are on their screen.' }, action: { origin: 'model', type: 'set_guided_steps', title, steps } };
    }
    case 'suggest_countermeasure': {
      const known = countermeasureById(str(args.id, 60));
      const title = str(args.title, 120);
      const instruction = str(args.instruction, 400);
      const suggestion =
        known ??
        (title && instruction
          ? {
              id: `custom_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`,
              kind: KINDS.includes(args.kind as CountermeasureKind) ? (args.kind as CountermeasureKind) : 'grounding',
              title,
              instruction,
              durationMinutes: Math.min(120, Math.max(1, Math.round(Number(args.durationMinutes)) || 10)),
            }
          : null);
      if (!suggestion) return { result: { ok: false, error: 'Give a catalogue id, or title + instruction.' } };
      return { result: { ok: true, note: `Card shown: ${suggestion.title}.` }, action: { origin: 'model', type: 'suggest_countermeasure', suggestion } };
    }
    case 'request_visual_check': {
      const target = str(args.target, 200);
      if (!target) return { result: { ok: false, error: 'Say what to show.' } };
      return { result: { ok: true, note: 'They have been asked to show it to the camera.' }, action: { origin: 'model', type: 'request_visual_check', target } };
    }
    case 'queue_earth_packet': {
      const urgency = URGENCIES.includes(args.urgency as EarthConsultUrgency) ? (args.urgency as EarthConsultUrgency) : 'routine_downlink';
      const note = str(args.note, 1200);
      return {
        result: { ok: true, note: 'Report queued for the doctors on Earth.' },
        action: { origin: 'model', type: 'queue_earth_packet', urgency, note: note || 'Report requested during conversation.' },
      };
    }
    default:
      return { result: { ok: false, error: `Unknown tool "${name}".` } };
  }
}
