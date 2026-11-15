# Spec 05: ARGUS Data Platform (Database, Users, Wearables, Analytics, NASA Data)

## 1. Purpose & Principles
ARGUS stores crew health data in a shared **PostgreSQL** database instead of each browser's `localStorage`.

- **One system of record.** Accounts, the crew roster, every reading, analytics results and AI chat messages live in Postgres. The browser keeps only UI conveniences (active tab).
- **Server-side trust.** Login, roles and access checks run on the server (`server/`). The browser is never trusted with another person's data.
- **Deterministic first** (AGENTS.md §2.4). Triage status comes only from `src/utils/triageEngine.ts` thresholds. Baselines and anomalies are informational. The LLM explains numbers that code computed; it never computes them.
- **Provenance everywhere.** Every row that came from outside or was derived records where it came from: `source_id` (an ID from `SOURCES.md`), `ingest_run_id` and `pipeline_version`.
- **Privacy by design.** Health data references a pseudonymous astronaut id and callsign. Legal name and medical notes live in a separate table that only flight surgeons can read. Cloud LLMs never receive them.
- **Mission framing.** On a real deep-space mission (up to 20 min one-way delay), this database runs **on board** as the system of record and Earth receives a delayed mirror. For the hackathon a single shared Azure instance plays both roles.

## 2. Hosting & Environments

| Environment | Database | Who uses it |
|---|---|---|
| Local dev | `docker compose up -d postgres` (`pgvector/pgvector:0.8.0-pg17`) | each developer, with throwaway data |
| Shared team | Azure Database for PostgreSQL Flexible Server, B1MS, PostgreSQL 17, free tier [SRC-061] | the whole team and the demo |

- **Connection, in this order** (`server/db/connectionString.ts`):
  1. `DATABASE_URL` (local dev and teammates).
  2. `AZURE_POSTGRESQL_CONNECTIONSTRING` as an app setting.
  3. The same name as an App Service connection string, which Linux exposes as `CUSTOMCONNSTR_…` or `POSTGRESQLCONNSTR_…`.

  Azure's `Server=…;Database=…;User Id=…;Password=…` format is converted to a TLS URL. Values are server-only: never prefix them with `VITE_`.
- **Production (argus-space.health):** web app `argus-space` uses the private database `argus-space-server` (reachable only through the app's private network). With `ARGUS_BOOTSTRAP_ON_START=1` the app seeds an empty database on first start, then generates 30 days of simulated history and loads the NASA reference CSVs. Every `ARGUS_SIMULATE_TOPUP_MIN` minutes (default 15) it extends the simulated history to the present (`server/jobs/bootstrap.ts`).
- Extensions: `citext` (case-insensitive usernames) and `pgcrypto` (`gen_random_uuid`). `vector` is allowlisted on Azure [SRC-062] but **not required**: the AI knowledge base (§3.6) stores embeddings as `real[]` so the same migrations run on Azure, Docker and embedded PGlite (PGlite 0.5 ships no pgvector build).
- Schema changes go **only** through Drizzle migrations (`server/db/migrations/`, `npm run db:migrate`). Nobody edits the Azure schema by hand.
- Team access: one firewall rule per teammate IP, plus DB roles `argus_app` (the server) and `argus_analyst` (read-only, for notebooks). See `docs/DATABASE.md`.

## 3. Schema
Defined in `server/db/schema.ts` (Drizzle). All timestamps are `timestamptz`, stored in UTC.

- Astronaut ids are text (`crew-<slug>` for the seeded roster, `crew-<random>` for new ones) so existing `CrewMemberProfile.id` values keep working.
- Other ids are UUIDs.

### 3.1 Identity & access
| Table | Columns (key ones) | Notes |
|---|---|---|
| `users` | `id` uuid, `username` citext unique, `role` (`admin` \| `astronaut` \| `flight_surgeon`), `astronaut_id` → `astronauts` (unique, required for `astronaut`), `password_hash` (argon2id), `created_at`, `disabled_at`, `failed_logins`, `locked_until` | One login per astronaut. Admins and flight surgeons may also link an astronaut profile, for example the crew medical officer. |
| `sessions` | `id` uuid, `user_id`, `token_hash` (SHA-256 of the cookie token), `created_at`, `expires_at`, `ip`, `user_agent` | Revocable server-side sessions. Logout deletes the row. |
| `audit_log` | `id` bigserial, `ts`, `actor_user_id`, `action`, `target_type`, `target_id`, `detail` jsonb, `ip` | Append-only. Written on login (success and failure), logout, admin actions, roster changes and medical-data reads. |

### 3.2 Crew & missions
| Table | Columns | Notes |
|---|---|---|
| `missions` | `id`, `name`, `location_id` (`SpaceLocationId`), `start_at`, `gravity_env` | Mission day = `floor((ts − start_at) / 1 day) + 1`. Mission day is derived from real time, not stored. |
| `astronauts` | `id` text, `mission_id`, `callsign`, `sex`, `birth_year`, `blood_type`, `crew_role`, `resting_hr_baseline_bpm`, `pre_flight_onsd_mm`, `default_scenario_id`, `countermeasure_streak_sols`, `ai_consent` (bool, default true), `is_demo`, `created_at`, `archived_at` | Pseudonymous profile. Safe to show any signed-in user and to send to an LLM. |
| `astronaut_private` | `astronaut_id` (PK, FK), `legal_name`, `medical_notes` | Readable by flight surgeons and by the astronaut themself. Never sent to cloud LLMs. |

Deleting an astronaut sets `archived_at` (a soft delete), which hides them and keeps their history. An admin **purge** hard-deletes the astronaut and cascades to all their rows (§6 data rights).

### 3.3 Catalog, devices & sources
| Table | Columns | Notes |
|---|---|---|
| `data_sources` | `id` (`SRC-xxx`), `title`, `url`, `kind`, `access` | Mirrors `SOURCES.md`; seeded from it. |
| `metrics` | `id`, `label`, `unit` (canonical), `zone` (`BodyZoneId`, nullable), `kind` (`passive` \| `clinical` \| `self_report` \| `environment` \| `derived`), `plausible_min`, `plausible_max`, `source_id` | §4.2 lists every metric. Units are canonical; the UI only formats them. |
| `devices` | `id` uuid, `astronaut_id`, `kind` (§4.1), `model`, `serial`, `token_hash`, `source_id`, `created_at`, `retired_at` | `token_hash` authenticates the ingest API. |
| `ingest_runs` | `id` uuid, `source_id`, `kind` (`wearable_batch` \| `simulator_backfill` \| `nasa_dataset` \| `check_in` \| `import`), `script`, `checksum`, `row_count`, `status`, `started_at`, `finished_at`, `detail` jsonb | One row per batch or load. |

### 3.4 Data layers (medallion)
| Layer | Table | Contents |
|---|---|---|
| Bronze | `raw_readings` (`id` bigserial, `device_id`, `received_at`, `payload` jsonb, `ingest_run_id`) | Exactly what the device sent. Append-only and never edited. |
| Silver | `observations` (`astronaut_id`, `metric_id`, `ts`, `value` double, `device_id`, `quality` (`ok` \| `artifact` \| `out_of_range`), `origin` (`wearable` \| `check_in` \| `clinical` \| `simulated`), `ingest_run_id`) | PK `(astronaut_id, metric_id, ts)`. BRIN index on `ts`. Values are in canonical units. |
| Silver | `wellbeing_check_ins` (`id`, `astronaut_id`, `ts`, `mood`, `stress`, `energy`, `sleep_quality`, `cohesion`, `motivation`, `note`) | Six 1–5 scales (`WellbeingCheckIn`). |
| Silver | `environment_readings` (`mission_id`, `metric_id`, `ts`, `value`, `source_id`) | Habitat data such as cabin CO₂. Per mission, not per astronaut. |
| Gold | `daily_metrics` (`astronaut_id`, `metric_id`, `day` date, `value`, `n`, `method`, `pipeline_version`, `computed_at`) | The per-day value of each of the 12 triage metrics, derived from observations as described in §5.1. Feeds the HUD series and triage. |
| Gold | `baselines` (`astronaut_id`, `metric_id`, `kind` (`preflight` \| `rolling_14d` \| `hour_of_day`), `hour` nullable, `n`, `mean`, `sd`, `median`, `mad`, `p05`, `p95`, `window_start`, `window_end`, `pipeline_version`, `computed_at`) | §5.2 |
| Gold | `anomalies` (`id`, `astronaut_id`, `metric_id`, `ts_start`, `ts_end`, `detector` (`robust_z` \| `ewma` \| `cusum`), `score`, `severity` (`watch` \| `drifting`), `detail` jsonb, `pipeline_version`, `computed_at`) | Informational only. Never changes triage. |
| Gold | `triage_events` (`id`, `astronaut_id`, `ts`, `zone`, `status`, `previous_status`, `metrics` jsonb, `engine_version`) | Written when a zone's deterministic status changes. |
| Reference | `ref_thresholds`, `ref_radiation_dose_rates`, `ref_osdr_studies`, `ref_osdr_lab_values` | Curated NASA reference data (§7). Every row has `source_id` and `ingest_run_id`. `ref_osdr_lab_values` is long-format (study, pseudonymous subject, timepoint, analyte, value, unit, reference range). |

### 3.5 AI chat link
Stores what was said to the AI, which astronaut it was about, and the data the AI saw. No chat analytics. Retrieved knowledge used in a reply is logged in `rag_citations` (§3.6).

| Table | Columns |
|---|---|
| `conversations` | `id` uuid, `astronaut_id`, `started_by` (user), `started_at` |
| `messages` | `id` uuid, `conversation_id`, `ts`, `role` (`user` \| `assistant`), `author_user_id` (null for assistant), `content`, `provider`, `model`, `source` (`ai` \| `offline_verified_cache`), `context_snapshot` jsonb (the zone statuses, flagged metrics and wellbeing summary sent with the prompt), `triage_event_id` (nullable: latest triage event at that time), `crisis_flag` bool |

### 3.6 AI knowledge base (RAG)
Verified reference text the AI looks up before giving clinical or procedural answers (issue #40). The AI never answers a protocol question from model weights alone: it cites a chunk, and every chunk traces to a `SRC-xxx` source.

| Table | Columns | Notes |
|---|---|---|
| `rag_documents` | `id` text (stable slug, e.g. `emergency/fire`), `source_id` → `data_sources`, `title`, `kind` (`emergency_checklist` \| `countermeasure` \| `clinical_reference` \| `medication`), `origin` (repo file or corpus file it was built from), `url`, `zone_ids` text[] (body zones it applies to, empty = all), `content_hash`, `ingest_run_id`, `updated_at` | One row per source document. Re-ingest skips documents whose `content_hash` and embedding model are unchanged. |
| `rag_chunks` | `id` uuid, `document_id` (cascade), `ordinal`, `heading`, `content`, `token_count`, `embedding` real[], `embedding_model`, `search_tsv` tsvector (generated from heading + content, GIN index) | One **clinical unit** per chunk: a whole checklist, a whole dosage with its contraindications, or a whole countermeasure. Chunks are split only at headings or between paragraphs, never inside a list or table. |
| `rag_citations` | `id` bigserial, `ts`, `astronaut_id` (nullable), `message_id` → `messages` (nullable), `mode` (`search` \| `chat` \| `live-api` \| `on-ship-pipeline`), `query`, `chunk_id`, `document_id`, `source_id`, `rank`, `score` | Which chunks were shown to the AI for which turn. |

**Corpus.** `npm run rag:ingest` (also run by the hosted bootstrap on every start; unchanged documents are skipped) builds documents from:
1. in-repo content: `src/data/emergencyProtocols.ts` [SRC-004] and `server/models/countermeasureLibrary.ts` (no `SRC-xxx` yet, so its documents have `source_id = null` and cite their `origin` file until a primary source is registered);
2. Markdown files in `server/rag/corpus/*.md` with front matter `id`, `title`, `source_id`, `kind`, optional `zones` ([SRC-004], [SRC-007], [SRC-008], [SRC-010]). A file without a `source_id` that exists in `SOURCES.md` is rejected (AGENTS.md §7).

**Embeddings** (`AI_EMBEDDINGS`): `hash` (default, offline, deterministic 384-dim feature hashing of word unigrams + bigrams [SRC-083]), `local` (Ollama `/v1/embeddings` [SRC-085], default `nomic-embed-text`), `gemini` (OpenAI-compatible endpoint [SRC-086], default `gemini-embedding-001`) or `custom` (`AI_BASE_URL`). Only chunks embedded with the active model take part in vector scoring; changing the model means re-running `npm run rag:ingest`.

**Retrieval** (`server/rag/retriever.ts`), target < 50 ms for a few thousand chunks:
1. keyword: Postgres full-text search, `ts_rank_cd` over an OR query of the question's terms [SRC-084];
2. vector: cosine similarity between the query embedding and cached chunk embeddings (in process);
3. fusion: Reciprocal Rank Fusion with k = 60 [SRC-088]; optional `zoneId` boosts chunks for that zone.

Without a database, the same corpus is indexed in memory (BM25 with k1 = 1.2, b = 0.75 [SRC-087] + hash embeddings), so offline and stateless modes still retrieve.

## 4. Passive Data: Assumed Kit (watch + dosimeter)
No public dataset has per-astronaut, minute-level vitals. NASA LSDA and LSAH data are request-only or restricted [SRC-005, SRC-006]. **ARGUS assumes each astronaut wears exactly two devices: a smartwatch and a personal dosimeter.** Everything else arrives without typing. Data is simulated at realistic cadences until real devices are connected.

**Why only two.**
- A current smartwatch measures heart rate, HRV, SpO₂, breathing rate, sleep, activity, ECG, overnight wrist temperature against a personal baseline [SRC-074] and cuff-calibrated blood pressure [SRC-075].
- Watches have flown: an Apple Watch on Inspiration4 [SRC-027] and a Garmin on Polaris Dawn [SRC-028]. NASA crews already wear wrist actigraphs continuously [SRC-009, SRC-023, SRC-024].
- A watch **cannot** measure radiation, so a personal dosimeter stays [SRC-026, SRC-079]. A dosimeter with a wristwatch display is in development [SRC-078].
- A watch **cannot** measure blood sugar: no non-invasive watch is authorized [SRC-076]. A **CGM patch** (continuous glucose monitor, as flown on Polaris Dawn [SRC-028]) streams 5-minute interstitial `blood_glucose` readings automatically, catching postprandial excursions and spaceflight insulin resistance during comm blackouts [SRC-072, SRC-073]. A weekly finger-prick glucometer photo (`manual`) remains as a calibration/backup modality [SRC-077].

### 4.1 Sources of data (`devices.kind`)
| Kind | Worn? | Streams | Cadence stored |
|---|---|---|---|
| `smartwatch` | worn | `heart_rate`, `activity`, `sleep_state` | every 1 min |
| | | `spo2`, `resp_rate`, `skin_temp` | every 2 min (`DEFAULT_SECONDARY_EVERY_MIN`; `--full` = 1 min) |
| | | `resting_hr`, `hrv_rmssd`, `sleep_eff`, `wrist_temp`, `wrist_temp_dev`, `sleep_resp_rate` | nightly, at wake-up |
| | | `bp_sys`, `bp_dia` | 3 spot readings a day while seated. Cuff calibration every 28 days [SRC-075] |
| | | `pvt_lapses`, `reaction_time` (PVT app) | daily |
| | | wellbeing tap-survey (`mood_index`, `headache_severity`) | daily |
| `dosimeter` | worn | `dose_rate` (µGy/h); the daily `rad_dose` is derived from it | every 1 min |
| `cgm` | worn | `blood_glucose` (interstitial mg/dL, trend, Time-in-Range) [SRC-028, SRC-072, SRC-073] | every 5 min |
| `habitat_sensor` | no | `cabin_co2` | automatic |
| `exercise_device` | no | `ared_load` from the device log | automatic, per session |
| `clinical_exam` | no | `onsd`, `iop`, `wbc_lymph`, `bmd_delta`. Ultrasound and retina images go through the camera (Eyes tab) | every 3–7 days |
| `manual` | no | `blood_glucose` backup from a glucometer photo, fasting [SRC-077] | as needed |

Devices from the earlier kit (`smart_shirt`, `bp_cuff`, `wrist_actigraph`, `ring`, `core_temp_patch`) are retired: `devices.retired_at` is set. Their enum values remain so historic rows stay valid.

### 4.2 Metric catalog
The triage metrics from spec 01 §2 keep their ids, units and thresholds. Four challenge core indicators are now triaged too: `bp_sys`, `bp_dia`, `glucose`, `wrist_temp_dev`.

Passive minute streams:

| Metric id | Unit | Plausible range | Feeds |
|---|---|---|---|
| `heart_rate` | bpm | 25–220 | `resting_hr` fallback, hour-of-day baseline |
| `resp_rate` | breaths/min | 4–60 | AI context |
| `activity` | g | 0–8 | sleep detection, exercise context |
| `sleep_state` | 0 / 1 | 0–1 | `sleep_eff` |
| `wrist_temp` | °C | 25–42 | `wrist_temp_dev` |
| `dose_rate` | µGy/h | 0–10000 | `rad_dose` (daily mean × 24 h) |

## 5. Analytics
Shared TypeScript lives in `shared/analytics/` and is used by both the server and the HUD. It replaces the duplicated maths in `src/utils/driftAnalytics.ts` and `server/models/trendModels.ts`.

### 5.1 Daily rollup (`daily_metrics`)
`server/jobs/analytics.ts` recomputes the rollup after each ingest batch and every 5 minutes.

| Metric | Daily value |
|---|---|
| `resting_hr` | Watch nightly value if present, otherwise the 5th percentile of minute `heart_rate` |
| `spo2` | Median of minute values with `quality = ok` |
| `rad_dose` | Sum of `dose_rate` × minutes, converted to mSv/d |
| `sleep_eff` | Night summary if present, otherwise `asleep minutes / in-bed minutes × 100` |
| `hrv_rmssd` | Nightly value |
| `bp_sys`, `bp_dia` | Mean of the day's watch spot readings |
| `glucose`, `wrist_temp_dev`, clinical metrics | Latest value that day |

Days are UTC calendar days, labelled as mission days (`MD-n`) from `missions.start_at`.

### 5.2 Baselines (`baselines`)
Computed per astronaut × metric. As NASA does, in-flight values are compared with the same person **on Earth before launch**. Spaceflight Standard Measures collect pre-flight data [SRC-009], ARCHeR crews wore their actigraph months before flight [SRC-024], and Inspiration4 drew blood at L-92/L-44/L-3 [SRC-047].

| Kind | Method |
|---|---|
| `preflight` | **Earth pre-flight**: daily values dated before `missions.start_at` (default 30 days, `--preflight-days`). Mean and SD, with SD floored at `METRIC_TYPICAL_SD`. This is the reference for drift. Without at least 2 Earth days (e.g. `cabin_co2`, `ared_load`, which only exist in the habitat), it falls back to `early_flight`. |
| `early_flight` | Mission days 1–7: the adaptation reference. Radiation (`rad_dose`) drifts from this one, because its rise from Earth is environmental, not physiological (`DRIFT_FROM_EARLY_FLIGHT`). |
| `rolling_14d` | The last 14 in-flight days: median, MAD, mean, SD, p05 and p95. This is the "your normal" band in the HUD. |
| `hour_of_day` | `heart_rate` minute data over 14 days, grouped by UTC hour. This is the circadian reference, so the 03:00 heart rate is compared with that person's own 03:00. |

The simulated Earth phase uses each crew member's recorded pre-flight values (`restingHrBaselineBpm`, `preFlightOnsdMm`), natural background radiation (≈ 3.1 mSv/yr [SRC-080]), weekly exams, no circadian shift, and no habitat CO₂ or flight exercise device. In the HUD these days appear at the start of each series as `L-n` (L-1 = the day before launch). The client drift maths uses the same rule, `baselinePoints()` in `shared/analytics`.

### 5.3 Anomaly detectors (`anomalies`)
These are informational only: an anomaly never changes a triage status.

| Detector | Data | Rule | Source |
|---|---|---|---|
| `robust_z` | Minute data against `hour_of_day` | `|x − median| / (1.4826 · MAD) ≥ 3.5` for **at least 10 consecutive minutes**. The persistence rule suppresses wearable artifacts. | [SRC-063] |
| `ewma` | Daily values against `preflight` | EWMA of z (α 0.3): ≥ 1σ = `watch`, ≥ 2σ = `drifting` | [SRC-064] |
| `cusum` | Daily values against `preflight` | One-sided CUSUM with k = 0.5σ and h = 4σ, for sustained small shifts such as SpO₂ creeping down | [SRC-064] |

`quality` flags set at ingest:
- `out_of_range`: outside `metrics.plausible_min/max`;
- `artifact`: a jump of more than 40% from the previous minute in `heart_rate` or `spo2`.

Both flags exclude the value from analytics. Raw data is never deleted.

### 5.4 AI usage of analytics
`/api/ai/diagnostics`, `/recommendations` and `/chat` receive a JSON block of computed numbers: current value, baseline, z, detector and window. The prompt tells the LLM to explain those numbers and never invent new ones. Every AI output keeps the "decision support, not a diagnosis" framing.

## 6. Users, Roles & Privacy
| Capability | `astronaut` | `flight_surgeon` | `admin` |
|---|---|---|---|
| See own profile, vitals, analytics, chat | ✓ | ✓ | only if linked to an astronaut |
| See other astronauts' vitals, analytics, chat | — | ✓ | — |
| See `astronaut_private` (legal name, medical notes) | own | ✓ | — |
| Add / edit / archive astronauts | — | ✓ | ✓ |
| Manage accounts (create, reset password, disable, delete) | — | — | ✓ |
| Purge an astronaut's data (hard delete) | — | — | ✓ (audited) |
| Export own data (JSON) | ✓ | ✓ (any) | — |

- **Passwords:** argon2id (m = 19 MiB, t = 2, p = 1) [SRC-060], at least 10 characters.
- **Lockout:** 15 minutes after 5 failed logins on an account. There is also a per-IP rate limit of 20 login attempts per minute.
- **Sessions:** a 32-byte random token in the `argus_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` outside localhost, 12 h). Only its SHA-256 is stored. Mutating requests must have an `Origin` header in `ARGUS_CORS_ORIGINS`.
- **Face ID:** the face is matched in the browser (template stays on the device, specs/02 §6). Setting it up calls `POST /api/auth/face/enroll` (signed in), which returns a 32-byte random device token; only its SHA-256 is stored in `face_logins`. After a face match the browser sends the token to `POST /api/auth/face/login`, which opens a normal session (same lockout and disabled checks, per-IP limit of 20 per minute, audited as `login` with `method: face_id`). `POST /api/auth/face/remove` turns it off. A password reset or disabling the account deletes all Face ID tokens of that user. Limit: the face check runs on the client, so it protects a trusted device; it is not a substitute for the password on an untrusted one.
- **Family email (Photobooth):** `POST /api/family/mail` (signed in; needs the database, otherwise 503; only for an astronaut the user can see; 30 per user per hour; audited without the addresses) queues the photo in memory and emails it after the one-way light time with nodemailer. SMTP from `SMTP_HOST/PORT/USER/PASS/MAIL_FROM`. Without SMTP nothing is sent and the status says email is not set up; `MAIL_TEST=ethereal` (demo only) sends to an Ethereal test inbox and returns a preview link. `GET /api/family/mail/:id` returns the status to the sender only. A server restart drops emails still waiting.
- **First run:** `npm run db:seed` creates the admin from `ARGUS_BOOTSTRAP_ADMIN_USERNAME/PASSWORD`. Demo accounts are created only when `ARGUS_DEMO_PASSWORD` is set: one per default crew member (username = callsign, lower-case) plus `surgeon`.
- **LLM privacy:**
  - Prompts carry the callsign, age band, sex, blood type and computed metrics.
  - `legal_name` and `medical_notes` are added only when the provider is `local`.
  - If `ai_consent = false`, AI endpoints serve the offline deterministic result for that astronaut.
- **Offline demo:** if the HUD can't reach the API, it runs on the synthetic in-browser data and shows an "Offline demo" badge. This follows the AGENTS.md rule that every feature must work offline.

## 7. NASA Reference Data & Analysis
Medallion applies here too:
1. Downloads land in `data/raw/<SRC-id>/`, which is gitignored and whose checksums are recorded in `ingest_runs`.
2. Curated small tables live in `data/reference/*.csv`, committed, every row carrying `source_id`.
3. Pipelines load them into the `ref_*` tables.

Loaders that write to the database are TypeScript (`scripts/ingest/`, `npm run data:nasa`) so they work against every engine, PGlite included. Analysis is Python (`analysis/`).

| Dataset | Access | Pipeline | Table |
|---|---|---|---|
| NASA OSDR API, Inspiration4 studies OSD-569…575 [SRC-046, SRC-047] | open, no key | `scripts/ingest/osdr.ts` | `ref_osdr_studies` |
| Inspiration4 Complete Blood Count, 4 crew × 7 timepoints (OSD-569, `LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv`) [SRC-047] | open | `scripts/ingest/osdr.ts` | `ref_osdr_lab_values` |
| Mission dose rates from MSL RAD papers and DOSIS ISS [SRC-042..045] | open | `scripts/ingest/reference.ts` | `ref_radiation_dose_rates` |
| NASA-STD-3001 limits and OCHMO radiation limits [SRC-007, SRC-008] | open | `scripts/ingest/reference.ts` | `ref_thresholds` |
| LSDA / LSAH / CIPHER per-astronaut data [SRC-005, SRC-006] | request-only or restricted | — | Not ingested; this is why §4 is simulated |

### Best-practice rules
- Raw is immutable. Derived data is always reproducible from raw plus a script at a known `pipeline_version`.
- Notebooks (`analysis/notebooks/`) are for exploration. Logic that the app relies on is promoted into `analysis/pipelines/` or `shared/analytics/`. A notebook is never the source of truth.
- Notebooks connect as `argus_analyst` (read-only). Only pipelines write, and every load creates an `ingest_runs` row.
- Traditional statistics (pandas, scipy, statsmodels, DuckDB) produce every number. AI is used only to summarize or explain computed tables, and any hypotheses it raises are labelled as hypotheses. Every AI-written insight records its model and provider.

## 8. API
All routes are under `/api`. Every route except `health`, `auth/login` and `ingest` requires a session.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | anyone | Sessions. `me` returns the user and `setupNeeded`. |
| `POST /auth/setup` | anyone, only while no users exist | Creates the first admin |
| `GET/POST /admin/users`, `PATCH/DELETE /admin/users/:id` | admin | Account management |
| `GET /astronauts`, `POST /astronauts`, `PATCH /astronauts/:id`, `DELETE /astronauts/:id` | read: all signed-in users (pseudonymous fields); write: admin, flight surgeon | Roster |
| `GET /astronauts/:id/private` | flight surgeon, self | Legal name and medical notes |
| `GET /astronauts/:id/zones?scenario=` | self, flight surgeon | `Record<BodyZoneId, VitalSignReading[]>` built from `daily_metrics`, with the same shape the HUD already uses |
| `GET /astronauts/:id/series?metric&from&to&bucket=minute\|hour\|day` | self, flight surgeon | Raw or bucketed observations |
| `GET /astronauts/:id/analytics` | self, flight surgeon | Baselines, current vs normal, recent anomalies |
| `POST /astronauts/:id/check-ins`, `POST /astronauts/:id/wellbeing` | self, flight surgeon | Manual readings, stored as observations with `origin = check_in` |
| `GET /astronauts/:id/conversations/latest` | self, flight surgeon | Chat history |
| `GET /astronauts/:id/export` | self, flight surgeon | JSON export |
| `POST /ingest/readings` | a device (`Authorization: Bearer <device token>`) | Batched readings (§4) |
| `POST /ai/*` | signed-in user who may read the astronaut | Existing AI endpoints (spec 04). `crewId` is checked against the session. |
| `POST /ai/rag/search`, `GET /ai/rag/status` | any signed-in user | Knowledge-base retrieval (§3.6, spec 04 §4.2). Reference text only, no crew data. |
