/**
 * AI knowledge base (specs/05-data-platform.md §3.6, specs/04-ai-backend.md §4.2):
 * chunker, embeddings, corpus validation, retriever (memory + db), ingest, citations, routes, tool.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { type DbHandle, openDb, setDbHandle } from '../db/client';
import { ingestRuns, ragChunks, ragCitations, ragDocuments } from '../db/schema';
import { seedDatabase } from '../db/seed';
import { chunkMarkdown, splitBlocks } from '../rag/chunker';
import { corpusFileDocuments, loadCorpus, repoDocuments } from '../rag/corpus';
import { cosine, hashEmbed, hashEmbedder, resolveEmbedder } from '../rag/embeddings';
import { ingestKnowledge } from '../rag/ingest';
import { orTsQuery, searchKnowledge } from '../rag/retriever';
import { formatKnowledgeForPrompt, LOOKUP_MEDICAL_PROTOCOL_TOOL, lookupMedicalProtocol } from '../rag/tool';

const DEMO_PW = 'demo-password-123';
const AI_ENV_PREFIXES = ['AI_', 'OPENROUTER_', 'GEMINI_', 'GROQ_'];

describe('clinical-unit chunker', () => {
  it('never splits a list, even when it is larger than the chunk budget', () => {
    const steps = Array.from({ length: 40 }, (_, i) => `${i + 1}. Step number ${i + 1} of a long checklist with several words`).join('\n');
    const chunks = chunkMarkdown('Doc', `Intro paragraph.\n\n${steps}\n\nClosing paragraph.`, 50);
    const withList = chunks.filter((c) => c.content.includes('1. Step number 1 '));
    expect(withList).toHaveLength(1);
    expect(withList[0].content).toContain('40. Step number 40');
  });

  it('keeps an introducing line ending in ":" with its list, and lists separated by blank lines together', () => {
    const blocks = splitBlocks('Steps:\n- one\n- two\n\n- three\n\nAfter.');
    expect(blocks.map((b) => b.text)).toEqual(['Steps:\n- one\n- two\n\n- three', 'After.']);
  });

  it('starts a new chunk at each heading and labels it', () => {
    const chunks = chunkMarkdown('Doc', 'Lead.\n\n## Dose\nTake 1 tablet.\n\n## Contraindications\n- none');
    expect(chunks.map((c) => c.heading)).toEqual(['Doc', 'Dose', 'Contraindications']);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2]);
  });
});

describe('embeddings', () => {
  it('hash embedding is deterministic, unit length and topical', () => {
    const a = hashEmbed('smoke and fire in the module');
    expect(hashEmbed('smoke and fire in the module')).toEqual(a);
    expect(Math.hypot(...a)).toBeCloseTo(1, 5);
    expect(cosine(a, hashEmbed('burning smell, smoke alarm'))).toBeGreaterThan(cosine(a, hashEmbed('bone density loss')));
  });

  it('falls back to hash when a cloud embedder is not configured', () => {
    expect(resolveEmbedder({ AI_EMBEDDINGS: 'gemini' }).provider).toBe('hash');
    expect(resolveEmbedder({ AI_EMBEDDINGS: 'gemini', GEMINI_API_KEY: 'AIzaTest' }).model).toBe('gemini:gemini-embedding-001');
    expect(resolveEmbedder({ AI_EMBEDDINGS: 'local' }).model).toBe('local:nomic-embed-text');
    expect(resolveEmbedder({}).model).toBe(hashEmbedder().model);
  });
});

describe('corpus', () => {
  it('builds documents from the emergency checklists (SRC-004) and the countermeasure library', () => {
    const docs = repoDocuments();
    const fire = docs.find((d) => d.id === 'emergency/fire');
    expect(fire?.sourceId).toBe('SRC-004');
    expect(fire?.body).toContain('1. Shout FIRE');
    expect(docs.find((d) => d.id === 'emergency/co2')?.zoneIds).toEqual(['neuro']);
    expect(docs.some((d) => d.kind === 'countermeasure')).toBe(true);
    expect(loadCorpus().errors).toEqual([]);
  });

  it('rejects corpus files without a registered source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-corpus-'));
    writeFileSync(join(dir, 'ok.md'), '---\ntitle: Good\nsource_id: SRC-010\nzones: [neuro]\n---\n## A\nText.');
    const unknownId = ['SRC', '999'].join('-'); // built at runtime so check:sources does not flag the fixture
    writeFileSync(join(dir, 'bad.md'), `---\ntitle: Bad\nsource_id: ${unknownId}\n---\nText.`);
    writeFileSync(join(dir, 'README.md'), 'ignored');
    const { documents, errors } = corpusFileDocuments(new Set(['SRC-010']), dir);
    expect(documents.map((d) => d.id)).toEqual(['corpus/ok']);
    expect(documents[0].zoneIds).toEqual(['neuro']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`bad.md: "source_id" must be an ID listed in SOURCES.md (got "${unknownId}")`);
  });
});

describe('retriever without a database (memory mode)', () => {
  it('finds the fire checklist for a natural question', async () => {
    const r = await searchKnowledge({ query: 'there is smoke and a burning smell in the module' });
    expect(r.retrieval).toBe('memory');
    expect(r.hits[0].documentId).toBe('emergency/fire');
    expect(r.hits[0].chunkId).toBeNull();
  });

  it('returns nothing rather than junk for unrelated text', async () => {
    const r = await searchKnowledge({ query: 'xyzzy qwerty zork' });
    expect(r.hits).toEqual([]);
  });

  it('sanitises the keyword query so user text cannot inject tsquery syntax', () => {
    expect(orTsQuery("fire & !smoke:* | ' OR 1=1")).toBe('fire | smoke | 1');
    expect(orTsQuery('the and of')).toBeNull();
  });
});

describe('knowledge base in Postgres', () => {
  let h: DbHandle;
  const app = createApp();
  const embedder = hashEmbedder();

  beforeAll(async () => {
    for (const key of Object.keys(process.env)) if (AI_ENV_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
    h = openDb('pglite:memory');
    await h.migrate();
    await seedDatabase(h.db, { adminUsername: 'admin', adminPassword: 'admin-password-123', demoPassword: DEMO_PW });
    setDbHandle(h);
  }, 60_000);

  afterAll(async () => {
    setDbHandle(null);
    await h.close();
  });

  it('ingests the corpus, then skips unchanged documents', async () => {
    const first = await ingestKnowledge(h.db, { embedder });
    expect(first.inserted).toBe(first.documents);
    expect(first.errors).toEqual([]);
    const [{ n }] = await h.db.select({ n: count() }).from(ragChunks);
    expect(n).toBe(first.chunks);
    const [fire] = await h.db.select().from(ragDocuments).where(eq(ragDocuments.id, 'emergency/fire'));
    expect(fire.sourceId).toBe('SRC-004');
    const [run] = await h.db.select().from(ingestRuns).where(eq(ingestRuns.id, first.runId));
    expect(run.status).toBe('succeeded');

    const second = await ingestKnowledge(h.db, { embedder });
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: first.documents, chunks: 0 });
  });

  it('re-embeds when the embedding model changes and removes documents dropped from the corpus', async () => {
    const other = { ...hashEmbedder(128), model: 'hash:fnv1a-128-v1' };
    const docs = loadCorpus().documents;
    const changed = await ingestKnowledge(h.db, { embedder: other, documents: docs.slice(1) });
    expect(changed.updated).toBe(docs.length - 1);
    expect(changed.removed).toBe(1);
    await ingestKnowledge(h.db, { embedder }); // restore
  });

  it('searches in db mode with full-text + vector fusion under 50 ms when warm', async () => {
    await searchKnowledge({ query: 'warm up', db: h.db, embedder });
    const r = await searchKnowledge({ query: 'smoke detector alarm and burning smell', db: h.db, embedder });
    expect(r.retrieval).toBe('db');
    expect(r.hits[0].documentId).toBe('emergency/fire');
    expect(r.hits[0].chunkId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.hits[0].keywordRank).toBe(1);
    expect(r.latencyMs).toBeLessThan(50);
  });

  it('boosts chunks tagged with the requested zone', async () => {
    const r = await searchKnowledge({ query: 'headache', zoneId: 'neuro', db: h.db, embedder });
    expect(r.hits[0].zoneIds).toContain('neuro');
  });

  it('POST /api/ai/rag/search requires a session, returns hits and logs citations', async () => {
    const anon = await app.request('/api/ai/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'fire' }),
    });
    expect(anon.status).toBe(401);

    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
      body: JSON.stringify({ username: 'surgeon', password: DEMO_PW }),
    });
    expect(login.status).toBe(200);
    const cookie = /argus_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')![0];

    const res = await app.request('/api/ai/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ query: 'CO2 headache slowed thinking', limit: 3, crewMember: { id: 'crew-vance' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.retrieval).toBe('db');
    expect(body.result.hits.length).toBeGreaterThan(0);
    expect(body.result.hits.length).toBeLessThanOrEqual(3);
    const logged = await h.db.select().from(ragCitations).where(eq(ragCitations.astronautId, 'crew-vance'));
    expect(logged.length).toBe(body.result.hits.length);
    expect(logged[0]).toMatchObject({ mode: 'search', rank: 1 });

    const status = await app.request('/api/ai/rag/status', { headers: { Cookie: cookie } });
    expect((await status.json()).result).toMatchObject({ retrieval: 'db', embeddingModel: embedder.model });

    const bad = await app.request('/api/ai/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ query: 'x' }),
    });
    expect(bad.status).toBe(400);
  });

  it('lookup_medical_protocol returns cited chunks for the AI and says so when nothing is found', async () => {
    expect(LOOKUP_MEDICAL_PROTOCOL_TOOL).toMatchObject({ name: 'lookup_medical_protocol', behavior: 'NON_BLOCKING' });
    const found = await lookupMedicalProtocol({ query: 'solar particle event dosimeter' }, { db: h.db, mode: 'on-ship-pipeline' });
    expect(found.found).toBe(true);
    expect(found.citations[0].documentId).toBe('emergency/radiation');
    expect(found.chunks.length).toBeLessThanOrEqual(3);
    const none = await lookupMedicalProtocol({ query: 'xyzzy qwerty' }, { db: h.db });
    expect(none.found).toBe(false);
    expect(none.note).toMatch(/do not improvise/i);
    expect(await lookupMedicalProtocol({})).toMatchObject({ found: false });

    const prompt = formatKnowledgeForPrompt((await searchKnowledge({ query: 'fire smoke', db: h.db, embedder, limit: 1 })).hits);
    expect(prompt).toMatch(/^REFERENCE/);
    expect(prompt).toContain('[SRC-004]');
  });
});
