/**
 * How the AI connects to the knowledge base (specs/04-ai-backend.md §4.2):
 * - tool-calling models get `lookup_medical_protocol` (Gemini Live and OpenAI-compatible shapes);
 * - models without tools get the retrieved chunks injected with `formatKnowledgeForPrompt`.
 */

import type { Db } from '../db/client';
import { type CitationMode, logCitations } from './citations';
import { searchKnowledge } from './retriever';
import type { RagHit } from './types';

export const LOOKUP_MEDICAL_PROTOCOL = 'lookup_medical_protocol' as const;

const DESCRIPTION =
  'Look up verified spaceflight medical protocols, emergency checklists and countermeasures. ' +
  'Call this before giving any procedure, checklist step, dose or treatment. ' +
  'Use only the returned text for steps and doses and cite its sourceId.';

const PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'The clinical or procedural question, in plain words.' },
    zoneId: {
      type: 'string',
      enum: ['neuro', 'cardio', 'musculo', 'immune', 'behavioral'],
      description: 'Body zone the question is about, if known.',
    },
  },
  required: ['query'],
} as const;

/** Gemini Live API `functionDeclarations` entry (same shape as the voice tools in server/routes/voice.ts). */
export const LOOKUP_MEDICAL_PROTOCOL_TOOL = {
  name: LOOKUP_MEDICAL_PROTOCOL,
  description: DESCRIPTION,
  behavior: 'NON_BLOCKING' as const,
  parameters: PARAMETERS,
};

/** OpenAI-compatible Chat Completions `tools` entry. */
export const LOOKUP_MEDICAL_PROTOCOL_OPENAI_TOOL = {
  type: 'function' as const,
  function: { name: LOOKUP_MEDICAL_PROTOCOL, description: DESCRIPTION, parameters: PARAMETERS },
};

export interface LookupResult {
  found: boolean;
  chunks: Array<{ sourceId: string | null; title: string; heading: string; text: string }>;
  citations: Array<{ rank: number; documentId: string; sourceId: string | null; title: string }>;
  hits: RagHit[];
  note: string;
}

export interface LookupContext {
  db?: Db | null;
  astronautId?: string | null;
  messageId?: string | null;
  mode?: CitationMode;
}

/** Executes the tool. Returns at most 3 chunks; logs citations when a database is available. */
export async function lookupMedicalProtocol(args: { query?: unknown; zoneId?: unknown }, ctx: LookupContext = {}): Promise<LookupResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { found: false, chunks: [], citations: [], hits: [], note: 'query is required' };
  const zoneId = typeof args.zoneId === 'string' ? args.zoneId : undefined;
  const { hits } = await searchKnowledge({ query, zoneId, limit: 3, db: ctx.db ?? null });
  if (ctx.db && hits.length) {
    await logCitations(ctx.db, { mode: ctx.mode ?? 'live-api', query, hits, astronautId: ctx.astronautId, messageId: ctx.messageId }).catch(
      (err) => console.warn('[ARGUS RAG] citation log failed:', (err as Error).message)
    );
  }
  return {
    found: hits.length > 0,
    chunks: hits.map((h) => ({ sourceId: h.sourceId, title: h.title, heading: h.heading, text: h.content })),
    citations: hits.map((h) => ({ rank: h.rank, documentId: h.documentId, sourceId: h.sourceId, title: h.title })),
    hits,
    note: hits.length
      ? 'Speak a 2–3 step plain-language summary. The HUD shows the full protocol.'
      : 'No verified protocol found. Say so, do not improvise steps or doses, and suggest contacting the Flight Surgeon.',
  };
}

/** Numbered REFERENCE block for prompts of models without tool calling (on-ship pipeline, chat). */
export function formatKnowledgeForPrompt(hits: RagHit[]): string {
  if (!hits.length) return 'REFERENCE: none found. Do not improvise procedures or doses.';
  const parts = hits.map((h, i) => {
    const tag = h.sourceId ? `[${h.sourceId}]` : `[${h.origin}]`;
    return `(${i + 1}) ${h.title} — ${h.heading} ${tag}\n${h.content}`;
  });
  return (
    'REFERENCE (verified; use only this for steps and doses, and cite the tag in brackets):\n\n' + parts.join('\n\n')
  );
}
