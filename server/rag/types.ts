/**
 * AI knowledge base (RAG) shared types — specs/05-data-platform.md §3.6, specs/04-ai-backend.md §4.2.
 */

import type { RagDocKind, RagRetrievalMode } from '../../src/types/aiApi';

export type { RagDocKind, RagHit, RagSearchResponse as RagSearchResult, RagStatus } from '../../src/types/aiApi';
export type RetrievalMode = RagRetrievalMode;

/** One source document before chunking. `body` is Markdown. */
export interface RagDocumentInput {
  id: string;
  sourceId: string | null;
  title: string;
  kind: RagDocKind;
  origin: string;
  url: string | null;
  zoneIds: string[];
  body: string;
}

export interface RagChunkDraft {
  ordinal: number;
  heading: string;
  content: string;
  tokenCount: number;
}

/** A chunk ready to be searched (from the database or the in-memory corpus). */
export interface IndexedChunk {
  id: string | null; // rag_chunks.id; null in memory mode
  key: string; // `${documentId}#${ordinal}`, stable in both modes
  documentId: string;
  ordinal: number;
  sourceId: string | null;
  title: string;
  kind: RagDocKind;
  origin: string;
  zoneIds: string[];
  heading: string;
  content: string;
  embedding: Float32Array | null;
  embeddingModel: string | null;
}
