/**
 * Hybrid retriever for the AI knowledge base (specs/05-data-platform.md §3.6, specs/04-ai-backend.md §4.2).
 *
 *  db mode:     keyword = Postgres full-text `ts_rank_cd` (Source: SRC-084)
 *               vector  = cosine over chunk embeddings cached in process
 *  memory mode: (no database, or the knowledge base is not ingested yet)
 *               keyword = BM25 over the committed corpus; vector = hash embeddings
 *  fusion:      Reciprocal Rank Fusion, k = 60 (Source: SRC-082)
 *
 * Never throws for a bad embedder: vector scoring is skipped and keyword results are returned.
 */

import { eq } from 'drizzle-orm';
import { currentPrivacy } from '../ai/privacy';
import { type Db, queryRows, sql } from '../db/client';
import { ragChunks, ragDocuments } from '../db/schema';
import { chunkMarkdown } from './chunker';
import { loadCorpus } from './corpus';
import { type Embedder, getEmbedder, hashEmbedder } from './embeddings';
import { MemoryIndex, type Ranked } from './memoryIndex';
import { tokenize } from './text';
import type { IndexedChunk, RagDocKind, RagHit, RagSearchResult, RetrievalMode } from './types';

const RRF_K = 60;
/** Assumption (not from a source): chunks tagged with the asked-about zone get a 20 % boost. */
const ZONE_BOOST = 1.2;
const CACHE_TTL_MS = 5 * 60_000;

export interface SearchOptions {
  query: string;
  zoneId?: string;
  limit?: number;
  db?: Db | null;
  embedder?: Embedder;
}

// ── Caches ──────────────────────────────────────────────────────────────────
let dbCache: { db: Db; index: MemoryIndex; loadedAt: number } | null = null;
let memoryCache: { index: MemoryIndex; embedder: Embedder } | null = null;

/** Called after an ingest so the next search reloads chunks. */
export function invalidateKnowledgeCache(): void {
  dbCache = null;
}

async function loadDbIndex(db: Db): Promise<MemoryIndex> {
  if (dbCache && dbCache.db === db && Date.now() - dbCache.loadedAt < CACHE_TTL_MS) return dbCache.index;
  const rows = await db
    .select({
      id: ragChunks.id,
      documentId: ragChunks.documentId,
      ordinal: ragChunks.ordinal,
      heading: ragChunks.heading,
      content: ragChunks.content,
      embedding: ragChunks.embedding,
      embeddingModel: ragChunks.embeddingModel,
      sourceId: ragDocuments.sourceId,
      title: ragDocuments.title,
      kind: ragDocuments.kind,
      origin: ragDocuments.origin,
      zoneIds: ragDocuments.zoneIds,
    })
    .from(ragChunks)
    .innerJoin(ragDocuments, eq(ragDocuments.id, ragChunks.documentId));
  const index = new MemoryIndex(
    rows.map((r) => ({
      ...r,
      key: `${r.documentId}#${r.ordinal}`,
      kind: r.kind as RagDocKind,
      embedding: r.embedding ? Float32Array.from(r.embedding) : null,
    }))
  );
  dbCache = { db, index, loadedAt: Date.now() };
  return index;
}

/** The committed corpus, chunked and hash-embedded in process (no database needed). */
export async function memoryIndex(): Promise<{ index: MemoryIndex; embedder: Embedder }> {
  if (memoryCache) return memoryCache;
  const embedder = hashEmbedder();
  const chunks: IndexedChunk[] = [];
  for (const d of loadCorpus().documents) {
    for (const c of chunkMarkdown(d.title, d.body)) {
      chunks.push({
        id: null,
        key: `${d.id}#${c.ordinal}`,
        documentId: d.id,
        ordinal: c.ordinal,
        sourceId: d.sourceId,
        title: d.title,
        kind: d.kind,
        origin: d.origin,
        zoneIds: d.zoneIds,
        heading: c.heading,
        content: c.content,
        embedding: null,
        embeddingModel: embedder.model,
      });
    }
  }
  const vecs = await embedder.embed(chunks.map((c) => `${c.title}\n${c.heading}\n${c.content}`));
  chunks.forEach((c, i) => (c.embedding = Float32Array.from(vecs[i])));
  memoryCache = { index: new MemoryIndex(chunks), embedder };
  return memoryCache;
}

/** `fire | smoke | cabin` — only [a-z0-9] terms, so user text can never inject tsquery syntax. */
export function orTsQuery(query: string): string | null {
  const terms = [...new Set(tokenize(query))].filter((t) => /^[a-z0-9]+$/.test(t)).slice(0, 24);
  return terms.length ? terms.join(' | ') : null;
}

async function sqlKeyword(db: Db, index: MemoryIndex, query: string, limit: number): Promise<Ranked[]> {
  const tsq = orTsQuery(query);
  if (!tsq) return [];
  const rows = await queryRows<{ id: string; score: number }>(
    db,
    sql`SELECT id, ts_rank_cd(search_tsv, q) AS score
        FROM rag_chunks, to_tsquery('english', ${tsq}) AS q
        WHERE search_tsv @@ q
        ORDER BY score DESC
        LIMIT ${limit}`
  );
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  return rows.flatMap((r) => {
    const chunk = byId.get(r.id);
    return chunk ? [{ chunk, score: Number(r.score) }] : [];
  });
}

async function vectorRanking(index: MemoryIndex, embedder: Embedder, query: string, limit: number): Promise<Ranked[]> {
  if (!index.countEmbedded(embedder.model)) return [];
  // Consent withdrawn (spec 05 §6): never send the question to a cloud embedder.
  if (!embedder.isLocal && currentPrivacy().offlineOnly) return [];
  try {
    const [vec] = await embedder.embed([query]);
    return index.vector(vec, embedder.model, limit);
  } catch (err) {
    console.warn(`[ARGUS RAG] query embedding failed (${embedder.model}): ${(err as Error).message.slice(0, 200)}`);
    return [];
  }
}

export function fuse(keyword: Ranked[], vector: Ranked[], zoneId: string | undefined, limit: number): RagHit[] {
  const acc = new Map<string, { chunk: IndexedChunk; score: number; keywordRank: number | null; vectorRank: number | null }>();
  const add = (list: Ranked[], which: 'keywordRank' | 'vectorRank') =>
    list.forEach((r, i) => {
      const e = acc.get(r.chunk.key) ?? { chunk: r.chunk, score: 0, keywordRank: null, vectorRank: null };
      e.score += 1 / (RRF_K + i + 1);
      e[which] = i + 1;
      acc.set(r.chunk.key, e);
    });
  add(keyword, 'keywordRank');
  add(vector, 'vectorRank');
  const all = [...acc.values()].map((e) => ({
    ...e,
    score: zoneId && e.chunk.zoneIds.includes(zoneId) ? e.score * ZONE_BOOST : e.score,
  }));
  return all
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e, i) => ({
      chunkId: e.chunk.id,
      documentId: e.chunk.documentId,
      sourceId: e.chunk.sourceId,
      title: e.chunk.title,
      kind: e.chunk.kind,
      origin: e.chunk.origin,
      zoneIds: e.chunk.zoneIds,
      heading: e.chunk.heading,
      content: e.chunk.content,
      rank: i + 1,
      score: Number(e.score.toFixed(5)),
      keywordRank: e.keywordRank,
      vectorRank: e.vectorRank,
    }));
}

export async function searchKnowledge(opts: SearchOptions): Promise<RagSearchResult> {
  const started = Date.now();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
  const query = opts.query.trim().slice(0, 1000);
  const pool = Math.max(20, limit * 4);
  let retrieval: RetrievalMode = 'memory';
  let keyword: Ranked[] = [];
  let vector: Ranked[] = [];
  let embeddingModel: string | null = null;

  const db = opts.db ?? null;
  const dbIndex = db ? await loadDbIndex(db) : null;
  if (db && dbIndex && dbIndex.chunks.length) {
    retrieval = 'db';
    const embedder = opts.embedder ?? getEmbedder();
    embeddingModel = embedder.model;
    [keyword, vector] = await Promise.all([
      sqlKeyword(db, dbIndex, query, pool),
      vectorRanking(dbIndex, embedder, query, pool),
    ]);
  } else {
    const mem = await memoryIndex();
    embeddingModel = mem.embedder.model;
    keyword = mem.index.bm25(query, pool);
    vector = await vectorRanking(mem.index, mem.embedder, query, pool);
  }

  return { hits: fuse(keyword, vector, opts.zoneId, limit), retrieval, embeddingModel, latencyMs: Date.now() - started };
}

export async function knowledgeStatus(db: Db | null): Promise<{
  retrieval: RetrievalMode;
  documents: number;
  chunks: number;
  embeddedChunks: number;
  embeddingModel: string;
}> {
  if (db) {
    const index = await loadDbIndex(db);
    if (index.chunks.length) {
      const embedder = getEmbedder();
      return {
        retrieval: 'db',
        documents: new Set(index.chunks.map((c) => c.documentId)).size,
        chunks: index.chunks.length,
        embeddedChunks: index.countEmbedded(embedder.model),
        embeddingModel: embedder.model,
      };
    }
  }
  const mem = await memoryIndex();
  return {
    retrieval: 'memory',
    documents: new Set(mem.index.chunks.map((c) => c.documentId)).size,
    chunks: mem.index.chunks.length,
    embeddedChunks: mem.index.chunks.length,
    embeddingModel: mem.embedder.model,
  };
}
