/** Logs which knowledge chunks the AI was given for a turn (`rag_citations`, specs/05-data-platform.md §3.6). */

import type { Db } from '../db/client';
import { ragCitations } from '../db/schema';
import type { RagHit } from './types';

export type CitationMode = 'search' | 'chat' | 'live-api' | 'on-ship-pipeline';

export async function logCitations(
  db: Db,
  entry: { mode: CitationMode; query: string; hits: RagHit[]; astronautId?: string | null; messageId?: string | null }
): Promise<number> {
  // Memory-mode hits have no chunk row to point at; nothing to log.
  const rows = entry.hits.filter((h) => h.chunkId);
  if (!rows.length) return 0;
  await db.insert(ragCitations).values(
    rows.map((h) => ({
      mode: entry.mode,
      query: entry.query.slice(0, 1000),
      astronautId: entry.astronautId ?? null,
      messageId: entry.messageId ?? null,
      chunkId: h.chunkId,
      documentId: h.documentId,
      sourceId: h.sourceId,
      rank: h.rank,
      score: h.score,
    }))
  );
  return rows.length;
}
