/**
 * Knowledge-base retrieval (specs/04-ai-backend.md §4.2, specs/05-data-platform.md §3.6).
 *   POST /api/ai/rag/search — hybrid keyword + vector search over verified protocols
 *   GET  /api/ai/rag/status — what the AI can currently retrieve from
 * Mounted under /api/ai, so it has the same session and crew-access checks as the other AI routes.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { RagSearchEnvelope, RagStatusEnvelope } from '../../src/types/aiApi';
import type { AppEnv } from '../auth/types';
import { logCitations } from '../rag/citations';
import { knowledgeStatus, searchKnowledge } from '../rag/retriever';
import { parseBody } from './util';

export const ragRoutes = new Hono<AppEnv>();

export const RagSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(1000),
  zoneId: z.enum(['neuro', 'cardio', 'musculo', 'immune', 'behavioral']).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  mode: z.enum(['search', 'chat', 'live-api', 'on-ship-pipeline']).optional(),
  messageId: z.string().uuid().optional(),
  crewMember: z.object({ id: z.string() }).passthrough().optional(),
});

ragRoutes.post('/rag/search', async (c) => {
  const body = await parseBody(c, RagSearchRequestSchema);
  if (!body.ok) return body.response;
  const req = body.data;
  const db = c.get('db');

  const result = await searchKnowledge({ query: req.query, zoneId: req.zoneId, limit: req.limit, db });
  if (db) {
    await logCitations(db, {
      mode: req.mode ?? 'search',
      query: req.query,
      hits: result.hits,
      astronautId: req.crewMember?.id ?? null,
      messageId: req.messageId ?? null,
    }).catch((err) => console.warn('[ARGUS RAG] citation log failed:', (err as Error).message));
  }
  // Retrieval only returns committed, verified reference text: no LLM involved.
  return c.json<RagSearchEnvelope>({ result, meta: { source: 'offline_verified_cache', latencyMs: result.latencyMs } });
});

ragRoutes.get('/rag/status', async (c) => {
  return c.json<RagStatusEnvelope>({ result: await knowledgeStatus(c.get('db')), meta: { source: 'offline_verified_cache' } });
});
