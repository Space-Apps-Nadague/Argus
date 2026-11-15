# ARGUS AI Knowledge Base (RAG) — How to Use It

The knowledge base is the set of verified medical and spaceflight reference text that the AI Flight Surgeon looks up before it gives a procedure, checklist step or dose. Every answer it backs up points to a `SRC-xxx` source in [`SOURCES.md`](../SOURCES.md).

- **Design (canonical):** [`specs/05-data-platform.md`](../specs/05-data-platform.md) §3.6 (storage) and [`specs/04-ai-backend.md`](../specs/04-ai-backend.md) §4.2 (how the AI uses it).
- **Code:** [`server/rag/`](../server/rag/), [`server/routes/rag.ts`](../server/routes/rag.ts).
- **Content:** [`server/rag/corpus/`](../server/rag/corpus/), plus the in-repo emergency checklists and countermeasure library.

---

## 1. Quick start

```bash
# .env: DATABASE_URL=pglite:./.data/argus   (or Docker / Azure, see docs/DATABASE.md)
npm run db:migrate          # creates rag_documents, rag_chunks, rag_citations
npm run db:seed             # loads SOURCES.md into data_sources (documents link to it)
npm run rag:ingest          # chunks + embeds the corpus into the database
npm run rag:search -- "smoke and a burning smell in the module"
```

Example output:

```
db · hash:fnv1a-384-v1 · 143 ms

#1 Emergency: Fire or smoke — Emergency: Fire or smoke [SRC-004] score 0.03279 (kw 1, vec 1)
   When: Visible flame, smoke, burning smell or a smoke-detector alarm.
   Steps:
   1. Shout FIRE and alert the whole crew
   ...
```

- The time includes loading the chunks the first time. Inside the running server, later searches take a few milliseconds.
- `db` means it searched Postgres. `memory` means there was no database (or nothing was ingested yet), so it searched the committed corpus in memory.
- `kw` and `vec` are the chunk's rank in the keyword and vector searches. `-` means it matched only one of them.
- Add `--zone neuro|cardio|musculo|immune|behavioral` to prefer chunks for one body zone.

**No database?** It still works. Without `DATABASE_URL` the AI searches the same corpus in memory, so offline and stateless modes keep their references. Only the citation log needs a database.

---

## 2. Where it runs

| Environment | How the knowledge base gets filled |
|---|---|
| **Production** (argus-space.health) | Automatic. With `ARGUS_BOOTSTRAP_ON_START=1` the app syncs the knowledge base on every start, so a deploy with new or edited corpus files updates it. Unchanged documents are skipped. |
| **Shared Azure DB / Docker / PGlite** | Run `npm run rag:ingest` after pulling corpus changes or changing the embedding model. |
| **Tests** | `server/__tests__/rag.test.ts` ingests into an in-memory PGlite. |

`npm run rag:ingest -- --force` re-embeds everything, even unchanged documents.

`rag:ingest` exits with code 2 if any corpus file was skipped (for example, an unknown `source_id`). It prints the reason for each one.

---

## 3. Adding a reference document

1. **Register the source first.** Add it to `SOURCES.md` with the next free `SRC-xxx` ID (AGENTS.md §7). Text an AI wrote is not a source.
2. **Create a Markdown file** in `server/rag/corpus/`, for example `server/rag/corpus/sans-ocular-checks.md`:

   ```markdown
   ---
   id: reference/sans-ocular-checks
   title: SANS ocular self-checks
   source_id: SRC-010
   kind: clinical_reference
   zones: [neuro]
   url: https://humanresearchroadmap.nasa.gov/evidence/
   ---

   ## When to check

   Paragraph copied or closely paraphrased from the source.

   ## Self-check steps

   1. First step from the source.
   2. Second step from the source.
   ```

   | Field | Required | Values |
   |---|---|---|
   | `title` | yes | Shown to the AI and on citation cards |
   | `source_id` | yes | An ID that exists in `SOURCES.md` |
   | `kind` | no (default `clinical_reference`) | `emergency_checklist`, `countermeasure`, `clinical_reference`, `medication` |
   | `zones` | no (default: all zones) | `neuro`, `cardio`, `musculo`, `immune`, `behavioral` |
   | `id` | no (default `corpus/<file name>`) | Stable slug. Changing it creates a new document and deletes the old one. |
   | `url` | no | Deep link to the exact section of the source |

3. **Keep each clinical unit under one heading.** Each `##` heading starts a new chunk. A long section may be split between paragraphs, but a list or table is never split. So put a checklist, or a dose together with its contraindications, in one list under one heading.
4. **Record where it's used.** Add `server/rag/corpus/<file>.md` to the source's **Used in** cell in `SOURCES.md`.
5. **Ingest and check it:**

   ```bash
   npm run rag:ingest
   npm run rag:search -- "a question the document should answer"
   npm run check:sources
   ```

To **edit** a document, change the file and re-run `rag:ingest`; only that document is re-chunked. To **remove** one, delete the file: the next ingest deletes it from the database.

The emergency checklists (`src/data/emergencyProtocols.ts`) and the countermeasure library (`server/models/countermeasureLibrary.ts`) are ingested automatically. Edit them in those files, not in the corpus folder.

---

## 4. Choosing the embedding model

Embeddings let the search match meaning, not only exact words. Set `AI_EMBEDDINGS` in `.env`:

| `AI_EMBEDDINGS` | Needs | Quality | Notes |
|---|---|---|---|
| `hash` (default) | nothing | keyword-like | Offline and deterministic. Fine for the demo corpus. |
| `local` | Ollama: `ollama pull nomic-embed-text` | good | Free, stays on the machine. Override with `AI_EMBEDDING_MODEL`. |
| `gemini` | `GEMINI_API_KEY` | good | Free tier, model `gemini-embedding-001`. Question text is sent to Google. |
| `custom` | `AI_EMBEDDING_BASE_URL` (or `AI_BASE_URL`) + `AI_EMBEDDING_MODEL`, optional `AI_EMBEDDING_API_KEY` | depends | Any OpenAI-compatible `/embeddings` endpoint |

**After changing it, run `npm run rag:ingest`.** Each chunk stores the model it was embedded with. Only chunks that match the active model take part in the vector search, so until you re-ingest, search falls back to keywords only.

If the setting is incomplete (for example, `gemini` without a key), the server logs a warning and uses `hash`. If the embedder fails during a search (for example, Ollama is down), that search uses keywords only. When an astronaut has withdrawn AI consent, their questions are never sent to a cloud embedder.

---

## 5. Using it from the AI code

### Tool-calling models (Gemini Live, OpenAI-compatible)

```ts
import { LOOKUP_MEDICAL_PROTOCOL_TOOL, LOOKUP_MEDICAL_PROTOCOL_OPENAI_TOOL, lookupMedicalProtocol } from '../rag/tool';

// 1. Declare the tool
//    Gemini Live:  tools: [{ functionDeclarations: [LOOKUP_MEDICAL_PROTOCOL_TOOL, ...] }]
//    OpenAI SDK:   tools: [LOOKUP_MEDICAL_PROTOCOL_OPENAI_TOOL]

// 2. When the model calls it, run it and send the result back as the tool response
const result = await lookupMedicalProtocol(
  { query: call.args.query, zoneId: call.args.zoneId },
  { db: c.get('db'), astronautId: crewId, mode: 'live-api' }
);
// result = { found, chunks: [{ sourceId, title, heading, text }], citations: [...], note }
```

It returns at most 3 chunks and logs them to `rag_citations`. When nothing matches, `found` is `false` and `note` tells the model not to improvise steps or doses.

### Models without tools (on-ship pipeline, chat)

```ts
import { searchKnowledge } from '../rag/retriever';
import { formatKnowledgeForPrompt } from '../rag/tool';
import { logCitations } from '../rag/citations';

const { hits } = await searchKnowledge({ query: transcript, zoneId, limit: 3, db });
const reference = formatKnowledgeForPrompt(hits); // "REFERENCE (verified; ...)\n\n(1) Emergency: Fire or smoke — ... [SRC-004]\n..."
// Put `reference` in the system or user prompt, then after saving the assistant message:
if (db) await logCitations(db, { mode: 'on-ship-pipeline', query: transcript, hits, astronautId: crewId, messageId });
```

### Wired across Voice, Chat, and HUD (#40)
- `src/types/aiApi.ts` declares `'lookup_medical_protocol'` in `VoiceToolName` and exposes `ragHits` on `VoiceToolCallResponse`, `VoiceTurnResponse`, and `ChatStreamEvent`.
- `server/routes/voice.ts` includes `LOOKUP_MEDICAL_PROTOCOL_TOOL` in `live-token`, executes `lookupMedicalProtocol` in `voice-tool`, and injects `searchKnowledge` + `formatKnowledgeForPrompt` into `voice-turn` (logging citations to `rag_citations`).
- `server/routes/chat.ts` retrieves matching reference chunks via `searchKnowledge`, injects `formatKnowledgeForPrompt`, emits `ragHits` in the SSE `meta` frame, and logs citations to `rag_citations`.
- `src/components/FlightSurgeonPanel.tsx` renders expandable **Verified protocol citations** cards (`SRC-xxx` badge, kind, heading, and full clinical-unit checklist/procedure text) alongside concise spoken guidance.

---

## 6. HTTP API

Both routes sit under `/api/ai`, so they need a session when a database is configured (any signed-in role). Request and response types are in `src/types/aiApi.ts` (`RagSearchRequest`, `RagSearchEnvelope`, `RagStatusEnvelope`).

```bash
# sign in (demo accounts need ARGUS_DEMO_PASSWORD; see docs/DATABASE.md)
curl -s -c /tmp/argus.cookies -H 'Content-Type: application/json' \
  -d '{"username":"surgeon","password":"<demo password>"}' http://localhost:8787/api/auth/login

curl -s -b /tmp/argus.cookies -H 'Content-Type: application/json' \
  -d '{"query":"CO2 headache and slow thinking","zoneId":"neuro","limit":3,"crewMember":{"id":"crew-vance"}}' \
  http://localhost:8787/api/ai/rag/search

curl -s -b /tmp/argus.cookies http://localhost:8787/api/ai/rag/status
```

| Field | Meaning |
|---|---|
| `query` | 2–1000 characters |
| `zoneId` | optional body zone to prefer |
| `limit` | 1–10, default 5 |
| `mode` | `search` (default), `chat`, `live-api`, `on-ship-pipeline`: stored in the citation log |
| `crewMember.id`, `messageId` | optional; link the citation log to an astronaut and a chat message. `crewMember.id` is checked against your access. |

The response is `{ result: { hits, retrieval, embeddingModel, latencyMs }, meta }`. `status` returns `{ retrieval, documents, chunks, embeddedChunks, embeddingModel }`. If `embeddedChunks` is lower than `chunks`, re-run `rag:ingest`.

---

## 7. Inspecting the data

```bash
npm run db:sql -- "select id, kind, source_id, array_length(zone_ids,1) zones, updated_at from rag_documents order by id"
npm run db:sql -- "select document_id, ordinal, heading, token_count, embedding_model from rag_chunks order by document_id, ordinal"
npm run db:sql -- "select ts, mode, query, document_id, source_id, rank from rag_citations order by ts desc limit 20"
npm run db:sql -- "select started_at, status, row_count, detail->>'embeddingModel' model from ingest_runs where detail->>'target' = 'rag' order by started_at desc limit 5"
```

---

## 8. How retrieval works (short version)

1. **Keyword:** Postgres full-text search (`rag_chunks.search_tsv`, `ts_rank_cd`) over the question's terms. Without a database, BM25 runs in memory instead.
2. **Vector:** cosine similarity between the question's embedding and each chunk's embedding, computed in the server. Embeddings are stored as `real[]` instead of pgvector, so the same migrations run on Azure, Docker and PGlite.
3. **Fusion:** Reciprocal Rank Fusion (k = 60) merges both rankings. Chunks tagged with the requested zone get a small boost, and weak vector-only matches are dropped, so an unrelated question returns no hits instead of random ones.

Chunks are cached in the server for 5 minutes. A local `rag:ingest` clears the cache. Another server instance picks up changes within 5 minutes.

Retrieval only supplies reference text. It never changes triage status or urgency.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `rag:search` says `memory` although `DATABASE_URL` is set | Nothing ingested yet: run `npm run rag:ingest`. |
| `skipped: <file>: "source_id" must be an ID listed in SOURCES.md` | Register the source in `SOURCES.md`, or fix the typo. |
| `<doc>: SRC-xxx is not in data_sources` | Run `npm run db:seed` (it copies `SOURCES.md` into `data_sources`), then ingest again. |
| `AI_EMBEDDINGS=…: … using the offline hash embedder` | The setting is incomplete; see §4. |
| `query embedding failed (local:nomic-embed-text)` | Ollama isn't running or the model isn't pulled: `ollama pull nomic-embed-text`. |
| A relevant document doesn't show up | Try `rag:search` with the words a crew member would use. Add those terms to the document's heading or body, or switch to a semantic embedder (§4). |
| `401 Sign in required` from `/api/ai/rag/*` | A database is configured, so sign in first (§6). |
