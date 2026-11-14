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
Every request may include `locationId` (`SpaceLocationId`, spec 01 §8); the server adds the mission location (gravity, comm delay) to prompts.

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

Guardrails enforced in code:
- LLM-returned metric ids are filtered to known `METRIC_THRESHOLDS` keys; LLM urgency can raise but never lower the deterministic urgency floor.
- Crisis language (self-harm, suicidal ideation; English + Hebrew) always yields `crisisFlag: true`, status `red`, `immediate_emergency_packet`, and a fixed escalation message — regardless of LLM output.
- Every result carries "decision support, not a diagnosis" framing for non-physician crew.

## 5. Deterministic Models
- **Trend model** (`MetricTrend`): personal baseline = mean of first 7 mission days, SD floored at ⅛ of the nominal band; z-score of the latest value; EWMA z (α 0.3) → `steady` (<1σ) / `watch` (≥1σ) / `drifting` (≥2σ); OLS slope over the last 10 days → 3-day forecast and days until the red band (0 if already red, `null` if moving away or >60 days). Task 27 switches this to Sprint 7's `src/utils/driftAnalytics.ts`.
- **Wellbeing risk** (0–100): last-3-day mean of the six 1–5 scales (stress inverted) weighted mood 25 / stress 20 / sleepQuality 15 / energy 15 / motivation 15 / cohesion 10 → up to 70 pts; worsening 7-day slope up to +10; `sleep_eff` and `pvt_lapses` triage status +5/+10 each. `<35` green, `35–59` yellow, `≥60` red; crisis forces red.

## 6. Running
- `npm run dev:all` — Vite + server (whatever `.env` configures).
- `npm run dev:local` — same, forcing `AI_PROVIDERS=local` (Ollama).
- `npm run ai:local` — checks Ollama is up and `AI_LOCAL_MODEL` is pulled.
- `npm run build && npm start` — production build (`dist/`) served by `tsx server/index.ts`.
- `docker compose up ollama` — optional Ollama container for teammates without a local install.
