# Spec 04: ARGUS AI Backend (Provider-Agnostic, Free & Local-First)

## 1. Purpose
A small Node/TypeScript server (`server/`) hosts every AI feature so that:
- **No API key ever ships to the browser** (replaces the old `VITE_AI_API_KEY` browser call).
- **Nothing costs money**: any OpenAI-compatible endpoint works — a local model (Ollama / LM Studio), OpenRouter free models, the Gemini free tier, Groq's free tier, or a custom/hosted agent endpoint.
- **Deterministic first**: triage status, trend models, wellbeing risk and crisis detection are plain TypeScript. The LLM only explains, ranks, personalizes and converses (AGENTS.md §2.4).
- **Always works offline**: every endpoint returns a deterministic `offline_verified_cache` result when no provider answers.
- **Data-backed** (`specs/05-data-platform.md`): when `DATABASE_URL` is set, AI routes require a session, check the user may read `crewId`, build the crew snapshot from the database (real observations and check-ins), and `/api/ai/chat` stores every message with the provider, model and context snapshot (§3.5). Prompts are pseudonymized: legal name and medical notes go only to the `local` provider.

## 2. Stack & Layout
- Hono + `@hono/node-server`, run with `tsx`; `openai` SDK pointed at any OpenAI-compatible `baseURL`; `zod` validates all request bodies and LLM JSON.
- Port `8787` (`PORT` or `ARGUS_SERVER_PORT`). Vite proxies `/api` → `http://localhost:8787` in dev; in production (`PORT` set), the server binds `0.0.0.0` and serves the built `dist/` SPA alongside `/api`.
- The server imports shared code directly from `src/` (`types/argus.ts`, `types/aiApi.ts`, `utils/triageEngine.ts`, `data/telemetryScenarios.ts`) — no duplicated thresholds.

| Path | Role |
|---|---|
| `server/index.ts` / `server/app.ts` | Entry point / Hono app factory (testable via `app.request`) |
| `server/ai/providers.ts` | Provider registry, key-prefix detection, fallback-chain resolution |
| `server/ai/llm.ts` | `completeJson` (zod-validated, retry, chain fallback), `streamChat` |
| `server/ai/json.ts` | Robust JSON extraction (code fences, `<think>` blocks) |
| `server/models/trendModels.ts` | Baseline z-score, EWMA drift, OLS slope, days-to-red forecast |
| `server/models/diagnosticsRules.ts` | Deterministic HRP-risk candidate hypotheses (offline fallback + LLM grounding) |
| `server/models/countermeasureLibrary.ts` | Deterministic countermeasure library (offline fallback) |
| `server/models/wellbeingModel.ts` | Behavioral-health risk score + crisis-language detector |
| `server/models/crewSnapshot.ts` | Builds the crew/telemetry/triage context given to prompts |
| `server/routes/voice.ts` | Real-Time Voice/Video Flight Surgeon (`live-token`, `stt`, `tts`, `voice-tool`, `voice-turn`) |
| `server/rag/*.ts` | AI knowledge base: corpus, clinical-unit chunker, embeddings, ingest, hybrid retriever, `lookup_medical_protocol` tool (spec 05 §3.6) |
| `server/routes/rag.ts` | `rag/search`, `rag/status` |
| `server/routes/*.ts` | One file per endpoint |

## 3. Providers & Fallback Chain
Env vars are **server-only** (never `VITE_`). See `.env.example`.

| Provider id | Selected when | Base URL default | Model default |
|---|---|---|---|
| `local` | `AI_LOCAL_MODEL` set | `http://localhost:11434/v1` (Ollama) | — (required) |
| `openrouter` | `OPENROUTER_API_KEY` or a key starting `sk-or-` | `https://openrouter.ai/api/v1` | `openrouter/free` |
| `gemini` | `GEMINI_API_KEY` or a key starting `AIza` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.8-flash` |
| `groq` | `GROQ_API_KEY` or a key starting `gsk_` | `https://api.groq.com/openai/v1` | — (`GROQ_MODEL` required) |
| `custom` | `AI_API_KEY`/`AI_BASE_URL` with no known prefix (LM Studio, vLLM, hosted agent gateway) | `AI_BASE_URL` | `AI_MODEL` |

- `AI_PROVIDERS` — ordered chain, e.g. `local`, `local,openrouter`, `openrouter,gemini`. Default `auto` = every configured cloud provider, then `local`.
- `AI_ROUTE_<FEATURE>` — per-feature chain override (`AI_ROUTE_CHAT=local`, `AI_ROUTE_DIAGNOSTICS=openrouter,local`).
- `X-AI-Key` request header — a key typed into the HUD; its provider is detected by prefix and tried first for that request only.
- A provider that errors, times out (`AI_TIMEOUT_MS`, `AI_LOCAL_TIMEOUT_MS`) or returns invalid JSON twice is skipped; the next one is tried; then the offline result is returned.
- Vision requests use `<PROVIDER>_VISION_MODEL` (OpenRouter defaults to `openrouter/free`, Gemini to its chat model); providers without a vision model are skipped.

## 4. Endpoints
Every request may include `locationId` (`SpaceLocationId`, spec 01 §8) and `telemetryCheckIns` (`CheckInEntry[]`, spec 01 §6); the server adds the mission location (gravity, comm delay) to prompts and runs `applyCheckIns` before triage, readiness, and trend models.

All JSON endpoints return `AiEnvelope<T> = { result: T, meta: { source, provider?, model?, latencyMs? } }` (types in `src/types/aiApi.ts`).

| Method & path | Request | Result | Deterministic part | LLM part |
|---|---|---|---|---|
| `GET /api/health[?probe=1]` | — | `AiProviderStatus` | chain resolution | — |
| `POST /api/ai/guidance` | `GuidanceRequest` (`zoneId`, optional `crewSymptoms`) | `FlightSurgeonGuidance` | zone triage status, deterministic offline symptom fallback | headline, explanation, guided steps |
| `POST /api/ai/vision` | `VisionRequest` | `VisualExamAnalysis` | status for reference samples | summary, guidance, action (status only for custom uploads) |
| `POST /api/ai/diagnostics` | `CrewContextRequest` | `DiagnosticsReport` | zone statuses, readiness, trends, rule candidates, urgency floor | ranked hypotheses + rationale, summary |
| `POST /api/ai/recommendations` | `CrewContextRequest` | `CountermeasurePlan` | library baseline per flagged metric | personalization, ordering |
| `POST /api/ai/wellbeing` | `WellbeingRequest` | `WellbeingAssessment` | risk score, status, trend, factors, crisis flag, urgency | supportive message, suggested actions |
| `POST /api/ai/chat` | `ChatRequest` | SSE `ChatStreamEvent`s | crisis detection + escalation preamble, offline intent replies | companion reply grounded in the crew snapshot |
| `POST /api/ai/live-token` | `LiveTokenRequest` | `LiveTokenResponse` | crew snapshot, deterministic urgency floor, tool schemas | short-lived Gemini Live API ephemeral token (`v1beta/auth_tokens`) |
| `POST /api/ai/stt` | `VoiceSttRequest` | `VoiceSttResponse` | crisis language detection on transcript, offline fallback | speech-to-text transcription (Gemini multimodal / local Whisper) |
| `POST /api/ai/tts` | `VoiceTtsRequest` | `VoiceTtsResponse` | deterministic WAV fallback + browser speech flag | speech synthesis (`gemini-3.8-flash-lite-tts` / local TTS) |
| `POST /api/ai/voice-tool` | `VoiceToolCallRequest` | `VoiceToolCallResponse` | `get_crew_snapshot`, `log_checkin_reading` & `lookup_medical_protocol` execution + triage | — |
| `POST /api/ai/voice-turn` | `VoiceTurnRequest` | `VoiceTurnResponse` | crisis & red-flag escalation, urgency floor, hybrid RAG protocol retrieval (`ragHits`), DB chat/voice + `rag_citations` audit | concise spoken clinical guidance grounded in `CrewSnapshot` and `REFERENCE` chunks |
| `POST /api/ai/rag/search` | `RagSearchRequest` (`query`, optional `zoneId`, `limit` 1–10, `mode`, `crewMember.id`) | `RagSearchResponse` (`hits[]`, `retrieval`, `embeddingModel`) | hybrid keyword + vector retrieval, citation log | — |
| `GET /api/ai/rag/status` | — | `RagStatus` | document/chunk counts, embedding model, `db` or `memory` | — |

### 4.1 Voice transport (legacy routes)
`/api/ai/live-token`, `/api/ai/voice-tool` and `/api/ai/voice-turn` stay for API compatibility and their tests; the HUD now uses §4.2. `/api/ai/stt` and `/api/ai/tts` are shared: given a `tier`, they route by comm tier (below) and report the real provider and model. The old simulated "on-ship" labels are only used when no `tier` is sent.

### 4.2 Unified ARGUS conversation and comm tiers

One assistant, one thread, in the ARGUS console (spec 02 §2.4). It is the crew's **onboard doctor and therapist**: someone to talk to, not a data readout.

**Comm tier** (`shared/commProfile.ts`, used by HUD and server). The live one-way light time to Earth (`commDelayAt`, spec 01 §8) picks the AI stack:

| Tier | When (one-way) | Language model | STT | TTS | Camera to the model | Earth doctors |
|---|---|---|---|---|---|---|
| `live` | ≤ 0.4 s (ITU-T G.114 [SRC-100]): Earth, LEO | Gemini Live, full duplex | in-session | in-session, chosen voice | ~1 frame/s + on-device summary | real time |
| `relay` | ≤ 5 s: Gateway, lunar | Earth cloud chain, streamed turns | `/stt` (Gemini) | `/tts` (Gemini), sentence-streamed | 1 still per turn + summary | real time |
| `autonomous` | > 5 s (Mars), offline, or crew "blackout" override | on-ship `local` provider only | on-ship (Speaches/faster-whisper) | on-ship (Kokoro) | 1 still per turn (local vision model) + summary | store-and-forward reports |

- The crew override can only move **away** from Earth (`resolveCommTier`); physics forbids a live session from Mars. `autonomous` makes `resolveProviderChain` return the local provider only, even with cloud keys or a typed `X-AI-Key`: nothing leaves the ship.
- Failure falls back one tier at a time (live → relay → autonomous → the HUD's rule-based `companionBrain`), shown in the tier badge.
- On-ship speech: `AI_LOCAL_SPEECH_BASE_URL` (OpenAI-compatible, `docker compose up -d speaches`, then `uvx speaches-cli model download` for `AI_LOCAL_STT_MODEL` and `AI_LOCAL_TTS_MODEL`) [SRC-105]. Unset = browser voice off-Earth. `npm run ai:local` checks it.
- Voices: `GET /api/ai/voices` lists the 30 Gemini prebuilt voices [SRC-106] and the Kokoro voices, with availability. Default Earth voice `Sulafat` (warm). The crew picks one per engine, with preview and speed; the browser voice is the last resort and never switches mid-reply.

**`POST /api/ai/converse` (SSE, `ConverseEvent`)**: request = crew context + thread (`user`/`assistant`/`earth` roles), `modality` (`text`|`voice`), `tierOverride`, optional `frame`, `observation` (§4.3), `activeProtocol`, `guidedSteps`, wellbeing `checkIns`, `previousAssessment`, `countermeasureLog`. Each turn:
1. **Fast path, before any model** (deterministic): the single red-flag detector (`shared/redFlags.ts`, English + Hebrew; crisis, acute medical, habitat emergencies) opens the matching emergency protocol and queues an `immediate_emergency_packet`; spoken vital logs ("log resting heart rate 68") are validated and logged; "done"/"next" during a protocol ticks the next step. These arrive as `action` events before the first token.
2. **Conversation**: the model streams a full reply and may call tools (`server/ai/assistantTools.ts`, same set for Gemini Live): `log_checkin_reading`, `get_crew_snapshot`, `start_emergency_protocol`, `mark_step_done`, `set_guided_steps`, `suggest_countermeasure`, `request_visual_check`, `queue_earth_packet`. Calls are validated in code; invalid calls produce no action. Models without tool support still get the fast path.
3. **After the reply** (`reply_end`): mental-state assessment (§4.4), a countermeasure card when there is strain and none is pending, an automatic Earth report when the concern level calls for it, then `assessment` and `done`.
- With no provider, a deterministic supportive reply answers (never a bare data readout). Messages are logged to `conversations`/`messages` with `contextSnapshot.tier`, `modality`, actions and the mental-state summary.
- Live tier: `POST /api/ai/live-session` returns a single-use token, the WebSocket URL and the setup message (persona + chart + recent thread + voice + tools); `POST /api/ai/assistant-tool` validates tool calls from the session; `POST /api/ai/assess` runs step 1 and 3 for each spoken live turn.

**Prompt** (`ASSISTANT_PERSONA`, `buildAssistantPrompt`): answer what they said, in full (what is likely going on and why, what it means, what to do); vitals are background, cited when they explain something; length follows the moment, plain speech, no lists in conversation. Doctor: a clinical read with stated certainty and how to confirm, always ending with something to do; anything serious is confirmed by Earth doctors, and zone colours stay authoritative. Therapist: listen and validate first, explore, offer one or two things to try and check back later; notice when facial expression and words disagree and ask. Only a running emergency protocol switches to terse step-by-step delivery. Stable persona first, volatile data last (prompt caching). Speed comes from the pipeline: fast-path actions, streaming, speech starting on the first sentence.

### 4.3 Camera observation (on-device)
The camera is on by default in the console after a one-time consent, with an always-visible indicator and one-tap off. `src/services/vision/observer.ts` reads the face every ~200 ms with face-api in the browser [SRC-102]: 68 landmarks (eye aspect ratio [SRC-107], mouth opening, head roll/yaw, position), the 7-class facial-expression model (neutral, happy, sad, angry, fearful, surprised, disgusted), and forehead green brightness. `src/services/vision/signals.ts` rolls the last 30 s into a `VisualObservation`: presence, blink rate (normal 6–30/min [SRC-108]), PERCLOS (moderate ≥ 8 %, high ≥ 15 % [SRC-101]), yawns, **facial emotion mix**, affect, fatigue, posture, restlessness, and a camera pulse estimate (rPPG [SRC-103]) shown only at confidence ≥ 0.5 and **never logged as a vital**. Only the summary and, per tier, a downscaled JPEG leave the browser; frames are never stored. Observations never change zone colours.

### 4.4 Mental state, countermeasures and reports to Earth
- `shared/mentalState.ts` fuses: conversation cues (lexicon, English + Hebrew, with negation and fading of older messages), camera cues (fatigue, sustained sad / fearful / angry expression, capped at "clear", never "strong"), the wellbeing self-report model (§5), and behavioral-zone physiology. A background model call may **raise** cue strengths (`MentalStateLlmSchema`), never lower them. The concern level (`none`/`watch`/`concern`/`urgent`) is computed in code: hopelessness or very low mood ⇒ at least `concern`; crisis language ⇒ `urgent`. Screening to guide support, not a diagnosis.
- Countermeasures (`shared/countermeasures.ts`, NASA HRP behavioural-health themes [SRC-104]) appear as "Try this now" cards; the crew says whether it helped, and that goes into the next turn and the Earth report.
- Reports to Earth: `urgent` ⇒ immediate, `concern` ⇒ automatic with a visible notice, otherwise a daily digest. `EarthTelemetryPacket` carries `urgency`, `kind`, `behavioralHealth` (assessment, history, countermeasures and outcomes, crew note) and the camera summary. Server mode stores them in `earth_packets`: visible to flight surgeons only after the one-way light time (`deliverAt`), and the reply visible to the crew only after the trip back (`replyDeliverAt`). Routes: `POST/GET /api/astronauts/:id/packets` (self or flight surgeon), `GET /api/packets/inbox`, `POST /api/packets/:id/read`, `POST /api/packets/:id/reply` (flight surgeons). Assessments are kept in `mental_state_assessments` (`POST/GET /api/astronauts/:id/mental-state`).

### 4.5 Knowledge retrieval (RAG)
Storage and retrieval are specified in spec 05 §3.6. How the AI uses them:
- **3-Tier Latency-Aware Retrieval:**
  1. *Tier 0 (Zero-latency session context):* `CrewSnapshot` (vitals, drift trends, flagged zones, allergies/medical notes when local, mission location/comm delay) is pre-loaded into the session instruction at 0 ms per-turn cost.
  2. *Tier 1 (Sub-50 ms hybrid search):* Keyword (`ts_rank_cd` in Postgres / BM25 in memory) + vector cosine similarity fused with Reciprocal Rank Fusion (`k = 60`).
  3. *Tier 2 (Mode-specific integration):*
     - **Tool for tool-calling models (`live-api`, OpenAI-compatible):** `lookup_medical_protocol`, exported from `server/rag/tool.ts` as `LOOKUP_MEDICAL_PROTOCOL_TOOL` (Live API `functionDeclarations` shape, `behavior: "NON_BLOCKING"`) and `LOOKUP_MEDICAL_PROTOCOL_OPENAI_TOOL`, declared in `VOICE_TOOL_DECLARATIONS` (`live-token`) and executed by `POST /api/ai/voice-tool`. Parameters: `query` (string, required), `zoneId` (`BodyZoneId`, optional). Returns at most 3 chunks as `{ sourceId, title, heading, text }` plus `citations` and `ragHits`.
     - **Prompt injection for sequential / non-tool turns (`on-ship-pipeline` `voice-turn`, `chat`):** `searchKnowledge` retrieves top chunks (`limit: 3`) and `formatKnowledgeForPrompt(hits)` renders them as a numbered `REFERENCE` block with `[SRC-xxx]` tags. The prompt instructs the model to use only that block for steps and doses and to cite the tag.
- **Voice vs. HUD Citation Separation:** The AI speaks a concise 2–3 step plain-language summary for non-physician crew, while the HUD simultaneously renders the full cited protocol cards (`ragHits`: title, heading, `SRC-xxx` source badge, kind, and expandable clinical-unit checklist/steps) in `FlightSurgeonPanel.tsx`.
- **Logging:** With a database, every retrieval for a turn is written to `rag_citations` (with `message_id` when known).
- Retrieval never changes triage status or urgency. It only supplies reference text.
- **Unified console (§4.2):** `/api/ai/converse` retrieves the top chunks for the latest message up front (one round trip, no tool latency), injects `formatKnowledgeForPrompt(hits)`, sends the hits in the `meta` event (`ragHits`) for the citation chips, and logs `rag_citations`. Live sessions get `lookup_medical_protocol` alongside the other assistant tools, executed by `POST /api/ai/assistant-tool`.


Guardrails enforced in code:
- LLM-returned metric ids are filtered to known `METRIC_THRESHOLDS` keys; LLM urgency and concern can raise but never lower the deterministic floor.
- Crisis language (self-harm, suicidal ideation; English + Hebrew) always yields the fixed escalation message first, `crisis: true`, concern `urgent` and an immediate report, regardless of model output.
- A life-threatening reading (spec 02 §7) opens the matching protocol in the console and sends an immediate report.

## 5. Deterministic Models
- **Trend model** (`MetricTrend`): personal baseline = mean of first 7 mission days, SD floored at ⅛ of the nominal band; z-score of the latest value; EWMA z (α 0.3) → `steady` (<1σ) / `watch` (≥1σ) / `drifting` (≥2σ); OLS slope over the last 10 days → 3-day forecast and days until the red band (0 if already red, `null` if moving away or >60 days). Task 27 switches this to Sprint 7's `src/utils/driftAnalytics.ts`.
- **Wellbeing risk** (0–100): last-3-day mean of the six 1–5 scales (stress inverted) weighted mood 25 / stress 20 / sleepQuality 15 / energy 15 / motivation 15 / cohesion 10 → up to 70 pts; worsening 7-day slope up to +10; `sleep_eff` and `pvt_lapses` triage status +5/+10 each. `<35` green, `35–59` yellow, `≥60` red; crisis forces red.

## 6. Running
- `npm run dev:all` — Vite + server (whatever `.env` configures).
- `npm run dev:local` — same, forcing `AI_PROVIDERS=local` (Ollama).
- `npm run ai:local` — checks Ollama is up and `AI_LOCAL_MODEL` is pulled.
- `npm run build && npm start` — production build (`dist/`) served by `tsx server/index.ts`.
- `docker compose up ollama` — optional Ollama container for teammates without a local install.
- `npm run rag:ingest` — (re)builds the AI knowledge base in `DATABASE_URL` with the `AI_EMBEDDINGS` model.
- `npm run rag:search -- "<question>"` — runs hybrid keyword + vector retrieval from the CLI.
