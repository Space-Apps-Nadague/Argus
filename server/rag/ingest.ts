/**
 * Builds the AI knowledge base in Postgres (specs/05-data-platform.md §3.6).
 * Idempotent: unchanged documents (same content hash + embedding model) are skipped; documents removed from
 * the corpus are deleted. Every run writes an `ingest_runs` row.
 */

import { createHash } from 'node:crypto';
import { eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { dataSources, ingestRuns, ragChunks, ragDocuments } from '../db/schema';
import { CHUNKER_VERSION, chunkMarkdown } from './chunker';
import { loadCorpus } from './corpus';
import { type Embedder, getEmbedder } from './embeddings';
import { invalidateKnowledgeCache } from './retriever';
import type { RagDocumentInput } from './types';

export interface IngestOptions {
  embedder?: Embedder;
  /** Defaults to the committed corpus (repo content + server/rag/corpus/*.md). */
  documents?: RagDocumentInput[];
  /** Re-embed everything even when unchanged. */
  force?: boolean;
  script?: string;
  log?: (msg: string) => void;
}

export interface IngestSummary {
  runId: string;
  embeddingModel: string;
  documents: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  chunks: number;
  errors: string[];
}

export function documentHash(d: RagDocumentInput): string {
  const { id, sourceId, title, kind, origin, url, zoneIds, body } = d;
  return createHash('sha256')
    .update(JSON.stringify({ v: CHUNKER_VERSION, id, sourceId, title, kind, origin, url, zoneIds, body }))
    .digest('hex');
}

export async function ingestKnowledge(db: Db, opts: IngestOptions = {}): Promise<IngestSummary> {
  const log = opts.log ?? (() => {});
  const embedder = opts.embedder ?? getEmbedder();

  const known = new Set((await db.select({ id: dataSources.id }).from(dataSources)).map((r) => r.id));
  const corpus = opts.documents ? { documents: opts.documents, errors: [] as string[] } : loadCorpus();
  const errors = [...corpus.errors];
  errors.forEach((e) => log(`skipped: ${e}`));

  const [run] = await db
    .insert(ingestRuns)
    .values({ kind: 'import', script: opts.script ?? 'server/rag/ingest.ts', detail: { target: 'rag', embeddingModel: embedder.model } })
    .returning({ id: ingestRuns.id });

  const summary: IngestSummary = {
    runId: run.id,
    embeddingModel: embedder.model,
    documents: corpus.documents.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    chunks: 0,
    errors,
  };

  try {
    const existing = new Map(
      (await db.select({ id: ragDocuments.id, contentHash: ragDocuments.contentHash }).from(ragDocuments)).map((r) => [r.id, r.contentHash])
    );
    const modelOf = new Map<string, Set<string | null>>();
    for (const r of await db.select({ documentId: ragChunks.documentId, model: ragChunks.embeddingModel }).from(ragChunks)) {
      const s = modelOf.get(r.documentId) ?? new Set();
      s.add(r.model);
      modelOf.set(r.documentId, s);
    }

    for (const doc of corpus.documents) {
      const hash = documentHash(doc);
      const models = modelOf.get(doc.id);
      const sameModel = models?.size === 1 && models.has(embedder.model);
      if (!opts.force && existing.get(doc.id) === hash && sameModel) {
        summary.unchanged++;
        continue;
      }
      let sourceId = doc.sourceId;
      if (sourceId && !known.has(sourceId)) {
        const msg = `${doc.id}: ${sourceId} is not in data_sources (run npm run db:seed) — stored without source_id`;
        log(msg);
        summary.errors.push(msg);
        sourceId = null;
      }
      const chunks = chunkMarkdown(doc.title, doc.body);
      const vectors = await embedder.embed(chunks.map((c) => `${doc.title}\n${c.heading}\n${c.content}`));

      await db.transaction(async (tx) => {
        const values = {
          sourceId,
          title: doc.title,
          kind: doc.kind,
          origin: doc.origin,
          url: doc.url,
          zoneIds: doc.zoneIds,
          contentHash: hash,
          ingestRunId: run.id,
          updatedAt: new Date(),
        };
        await tx.insert(ragDocuments).values({ id: doc.id, ...values }).onConflictDoUpdate({ target: ragDocuments.id, set: values });
        await tx.delete(ragChunks).where(eq(ragChunks.documentId, doc.id));
        if (chunks.length)
          await tx.insert(ragChunks).values(
            chunks.map((c, i) => ({
              documentId: doc.id,
              ordinal: c.ordinal,
              heading: c.heading,
              content: c.content,
              tokenCount: c.tokenCount,
              embedding: vectors[i],
              embeddingModel: embedder.model,
            }))
          );
      });
      summary.chunks += chunks.length;
      if (existing.has(doc.id)) summary.updated++;
      else summary.inserted++;
    }

    const keep = corpus.documents.map((d) => d.id);
    const stale = keep.length
      ? await db.select({ id: ragDocuments.id }).from(ragDocuments).where(notInArray(ragDocuments.id, keep))
      : await db.select({ id: ragDocuments.id }).from(ragDocuments);
    if (stale.length) {
      await db.delete(ragDocuments).where(inArray(ragDocuments.id, stale.map((s) => s.id)));
      summary.removed = stale.length;
    }

    await db
      .update(ingestRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), rowCount: summary.chunks, detail: { target: 'rag', ...summary } })
      .where(eq(ingestRuns.id, run.id));
    log(
      `knowledge base (${embedder.model}): ${summary.inserted} new, ${summary.updated} updated, ` +
        `${summary.unchanged} unchanged, ${summary.removed} removed, ${summary.chunks} chunks written`
    );
    return summary;
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: 'failed', finishedAt: new Date(), detail: { target: 'rag', error: (err as Error).message.slice(0, 500) } })
      .where(eq(ingestRuns.id, run.id));
    throw err;
  } finally {
    invalidateKnowledgeCache();
  }
}
