/**
 * In-process index over knowledge chunks: BM25 keyword ranking and cosine vector ranking.
 * Used for vector scoring in both modes and for keyword ranking when there is no database.
 */

import { cosine } from './embeddings';
import { tokenize } from './text';
import type { IndexedChunk } from './types';

// Source: SRC-081 (Robertson & Zaragoza 2009, BM25 default parameters)
const K1 = 1.2;
const B = 0.75;

export interface Ranked {
  chunk: IndexedChunk;
  score: number;
}

export class MemoryIndex {
  readonly chunks: IndexedChunk[];
  private readonly tf: Array<Map<string, number>>;
  private readonly len: number[];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(chunks: IndexedChunk[]) {
    this.chunks = chunks;
    this.tf = chunks.map((c) => {
      const m = new Map<string, number>();
      for (const t of tokenize(`${c.title} ${c.heading} ${c.content}`)) m.set(t, (m.get(t) ?? 0) + 1);
      return m;
    });
    this.len = this.tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
    for (const m of this.tf) for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length);
  }

  bm25(query: string, limit = 20): Ranked[] {
    const terms = [...new Set(tokenize(query))];
    const n = this.chunks.length;
    const out: Ranked[] = [];
    for (let i = 0; i < n; i++) {
      let score = 0;
      for (const t of terms) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * this.len[i]) / this.avgLen));
      }
      if (score > 0) out.push({ chunk: this.chunks[i], score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Cosine ranking over chunks embedded with `model`; drops scores below `minScore`. */
  vector(queryVec: number[], model: string, limit = 20, minScore = 0.12): Ranked[] {
    const out: Ranked[] = [];
    for (const c of this.chunks) {
      if (!c.embedding || c.embeddingModel !== model) continue;
      const score = cosine(queryVec, c.embedding);
      if (score >= minScore) out.push({ chunk: c, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  countEmbedded(model: string): number {
    return this.chunks.filter((c) => c.embedding && c.embeddingModel === model).length;
  }
}
