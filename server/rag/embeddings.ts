/**
 * Embedders for the AI knowledge base (specs/05-data-platform.md §3.6), selected by `AI_EMBEDDINGS`:
 *   hash   (default) offline, deterministic feature hashing — Source: SRC-083 (Weinberger et al. 2009)
 *   local  Ollama / LM Studio `/v1/embeddings` — Source: SRC-085
 *   gemini Gemini OpenAI-compatible endpoint — Source: SRC-086
 *   custom any OpenAI-compatible endpoint (`AI_EMBEDDING_BASE_URL` or `AI_BASE_URL`)
 * The stored `embedding_model` is `<provider>:<model>` so vectors from different models never mix.
 */

import OpenAI from 'openai';
import { PROVIDER_DEFAULTS } from '../ai/providers';
import { tokenize } from './text';

type Env = Record<string, string | undefined>;

export interface Embedder {
  /** Value stored in `rag_chunks.embedding_model`. */
  model: string;
  provider: 'hash' | 'local' | 'gemini' | 'custom';
  isLocal: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export const HASH_DIMS = 384;

/** FNV-1a 32-bit. */
function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Signed feature hashing of unigrams (weight 1) and bigrams (weight 0.5), L2-normalised. */
export function hashEmbed(text: string, dims = HASH_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const toks = tokenize(text);
  const add = (feature: string, w: number) => {
    const h = fnv1a(feature);
    const sign = fnv1a(feature, 0x9747b28c) & 1 ? 1 : -1;
    v[h % dims] += sign * w;
  };
  for (let i = 0; i < toks.length; i++) {
    add(toks[i], 1);
    if (i + 1 < toks.length) add(`${toks[i]} ${toks[i + 1]}`, 0.5);
  }
  const norm = Math.hypot(...v);
  return norm ? v.map((x) => x / norm) : v;
}

export function hashEmbedder(dims = HASH_DIMS): Embedder {
  return {
    model: `hash:fnv1a-${dims}-v1`,
    provider: 'hash',
    isLocal: true,
    embed: async (texts) => texts.map((t) => hashEmbed(t, dims)),
  };
}

function openAiEmbedder(provider: Embedder['provider'], baseURL: string, apiKey: string, model: string, isLocal: boolean, timeoutMs: number): Embedder {
  const client = new OpenAI({ apiKey: apiKey || 'not-needed', baseURL, timeout: timeoutMs, maxRetries: 1 });
  return {
    model: `${provider}:${model}`,
    provider,
    isLocal,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 64) {
        const res = await client.embeddings.create({ model, input: texts.slice(i, i + 64) });
        for (const d of [...res.data].sort((a, b) => a.index - b.index)) out.push(d.embedding as number[]);
      }
      return out;
    },
  };
}

const trimmed = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

/** Builds the configured embedder. Misconfiguration (e.g. `gemini` without a key) falls back to `hash` with a warning. */
export function resolveEmbedder(env: Env = process.env): Embedder {
  const choice = (trimmed(env.AI_EMBEDDINGS) ?? 'hash').toLowerCase();
  const timeoutMs = Number(env.AI_EMBEDDING_TIMEOUT_MS) || 30_000;
  const model = trimmed(env.AI_EMBEDDING_MODEL);
  const fallback = (why: string) => {
    console.warn(`[ARGUS RAG] AI_EMBEDDINGS=${choice}: ${why} — using the offline hash embedder`);
    return hashEmbedder();
  };

  switch (choice) {
    case 'hash':
      return hashEmbedder();
    case 'local':
      return openAiEmbedder(
        'local',
        trimmed(env.AI_EMBEDDING_BASE_URL) ?? trimmed(env.AI_LOCAL_BASE_URL) ?? PROVIDER_DEFAULTS.local.baseUrl,
        'ollama',
        model ?? 'nomic-embed-text',
        true,
        timeoutMs
      );
    case 'gemini': {
      const key = trimmed(env.GEMINI_API_KEY) ?? (trimmed(env.AI_API_KEY)?.startsWith('AIza') ? trimmed(env.AI_API_KEY) : undefined);
      if (!key) return fallback('GEMINI_API_KEY is not set');
      return openAiEmbedder('gemini', PROVIDER_DEFAULTS.gemini.baseUrl, key, model ?? 'gemini-embedding-001', false, timeoutMs);
    }
    case 'custom': {
      const baseUrl = trimmed(env.AI_EMBEDDING_BASE_URL) ?? trimmed(env.AI_BASE_URL);
      if (!baseUrl || !model) return fallback('needs AI_EMBEDDING_BASE_URL (or AI_BASE_URL) and AI_EMBEDDING_MODEL');
      const key = trimmed(env.AI_EMBEDDING_API_KEY) ?? trimmed(env.AI_API_KEY) ?? '';
      return openAiEmbedder('custom', baseUrl, key, model, /localhost|127\.0\.0\.1|\[::1\]/.test(baseUrl), timeoutMs);
    }
    default:
      return fallback('unknown value (use hash, local, gemini or custom)');
  }
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

let cached: { key: string; embedder: Embedder } | null = null;

/** `resolveEmbedder(process.env)`, memoised until the relevant env vars change. */
export function getEmbedder(env: Env = process.env): Embedder {
  const key = ['AI_EMBEDDINGS', 'AI_EMBEDDING_MODEL', 'AI_EMBEDDING_BASE_URL', 'AI_LOCAL_BASE_URL', 'AI_BASE_URL', 'GEMINI_API_KEY', 'AI_API_KEY', 'AI_EMBEDDING_API_KEY']
    .map((k) => env[k] ?? '')
    .join('|');
  if (!cached || cached.key !== key) cached = { key, embedder: resolveEmbedder(env) };
  return cached.embedder;
}
