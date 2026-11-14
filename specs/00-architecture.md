# Spec 00: ARGUS System Architecture & Folder Structure

## Product Identity
- **System Name:** ARGUS (*Astronaut Readiness Guidance & Unified Surveillance*)
- **Core Purpose:** Autonomous crew health Bio-Twin and clinical decision support system for deep-space missions experiencing up to 20-minute one-way Earth communication delays.

## Tech Stack
- **UI Framework:** React 18+ (TypeScript) + Vite + Tailwind CSS
- **3D Bio-Twin:** Three.js (`three`, `@react-three/fiber`, `@react-three/drei`) for a central hero-stage, rotating, interactive 3D sculpted anatomical figure differentiating male and female morphologies (`BiologicalSex`: `'female' | 'male'`), with selectable layers (`all`, `dermal`, `skeletal`, `organs`), camera focus presets, clickable body parts, and a WebGL error-boundary fallback
- **Data Visualization:** Recharts (`AreaChart`, `ReferenceArea`, `ResponsiveContainer`, `Tooltip`, `XAxis`, `YAxis`) for 14-to-30-day vital trends
- **Icons:** `lucide-react`
- **AI Layer:** Multimodal Clinical AI service returning structured JSON (`FlightSurgeonGuidance` & `VisualExamAnalysis`) served by the ARGUS AI backend (`server/`, `specs/04-ai-backend.md`: local or free cloud models, key never in the browser) + deterministic pre-cached offline fallback when no model or backend is reachable
- **State Management:** React Context / `useReducer` (`MissionContext.tsx`). When the API is reachable, the crew roster, telemetry zones, check-ins and chat history come from the server (`specs/05-data-platform.md`). When it is not, the HUD runs the synthetic in-browser data as an "Offline demo". Only UI conveniences (active tab) stay in `localStorage`.
- **Database:** PostgreSQL 17 (Azure Flexible Server for the team, Docker locally) through Drizzle ORM (`server/db/`). It holds users and sessions, the roster, wearable observations, analytics, triage events, the AI chat link and NASA reference data. See `specs/05-data-platform.md`.
- **Analysis:** live analytics in TypeScript/SQL (`shared/analytics/`, `server/jobs/`); NASA dataset analysis in Python (`analysis/`, managed by `uv`).
- **Analytics:** Pure deterministic TypeScript (`driftAnalytics.ts`) for personal-baseline drift (σ), short-range forecasts with 90% prediction intervals, and evidence-backed metric links. Informational only: it never changes a triage status.
- **Layout:** Slim top mission bar + 5-tab HUD (`Bio-Twin`, `Trends`, `Check-in`, `Flight Surgeon`, `Crew`). See `specs/02-ui-dashboard.md`.
- **Agent Skills:** Vendor-neutral design/UX skills in `.agents/skills/` (open Agent Skills `SKILL.md` format), referenced from `AGENTS.md`.

## Directory Structure
- `server/db/` — Drizzle schema (`schema.ts`), client, generated SQL migrations, seed (`specs/05-data-platform.md` §3)
- `server/auth/` — argon2id passwords, sessions, role and access checks (§6)
- `server/ingest/`, `server/jobs/` — wearable ingest normalization and the analytics refresh job (§4–§5)
- `shared/analytics/` — baselines, anomaly detectors and drift maths shared by the server and the HUD (§5)
- `scripts/simulate-wearables.ts` — assumed sensor kit simulator (§4); `scripts/check-sources.ts` — source attribution check (AGENTS.md §7)
- `analysis/` — Python pipelines and notebooks for NASA reference data (§7); `data/reference/` — curated CSVs with `source_id`
- `docs/DATABASE.md` — connecting to the shared database, migrations, seeding
- `.agents/skills/` — Vendor-neutral agent skills (`frontend-design`, `design-system`, `accessibility-review`, `ux-copy`, `design-critique`) used for all UI work
- `ARGOS_The_Thousand_Eyes.html` — Reference prototype (vanilla JS) whose ideas were ported in Sprint 7; not part of the build
- `specs/` — Canonical Specification Documents (Single Source of Truth)
  - `specs/00-architecture.md` — System architecture, tech stack, and directory layout
  - `specs/01-data-schema.md` — Data models (including `CrewMemberProfile`), deterministic triage thresholds, and AI JSON schemas
  - `specs/02-ui-dashboard.md` — Spacecraft HUD layout, Crew Roster & Custom Crew Creator specs, 3D Bio-Twin specs, component props, and demo controls
- `src/types/argus.ts` — Canonical TypeScript interfaces matching `specs/01-data-schema.md`
- `src/data/telemetryScenarios.ts` — Default 4-astronaut crew roster (`DEFAULT_CREW_ROSTER`), individualized 30-day telemetry generator, crisis scenarios (`nominal`, `sans_alert`, `high_co2`, `solar_storm`), pre-cached Flight Surgeon guidance, and visual self-exam samples
- `src/utils/triageEngine.ts` — Deterministic Green/Yellow/Red threshold evaluator for `0g_transit` microgravity and Crew Readiness Score calculator
- `src/utils/anatomicalGeometry.ts` — Parametric 3D anatomical mesh generators (`THREE.BufferGeometry`) for sex-differentiated (`female` | `male`) sculpted human head/neck, torso, limbs, skeletal ribcage/pelvis, and internal organs/vascular tracts
- `src/utils/driftAnalytics.ts` — Personal-baseline drift (σ, EWMA), least-squares forecast with 90% prediction interval, and evidence-backed metric links
- `src/utils/checkIns.ts` — Check-in validation against `METRIC_INPUT_RANGES`, overlay of manual readings onto telemetry, and logging streak
- `src/services/flightSurgeonAi.ts` — Multimodal Flight Surgeon AI service with automatic offline fallback
- `src/context/MissionContext.tsx` — Unified React Context & reducer managing crew roster, active crew member, custom crew creation, 0g transit environment state, active scenario, selected zone, anatomical layer, checklist completion, visual triage, and queued Earth packets
- `src/components/TabBar.tsx` — Accessible 5-tab navigation (`role="tablist"`, arrow-key navigation)
- `src/components/BioTwinTab.tsx` — Bio-Twin tab: 3D hero stage + selected-zone vital tiles
- `src/components/TrendsTab.tsx` — Trends tab: drift chips, forecast chart, and "Why" links
- `src/components/CheckInTab.tsx` — Check-in tab: daily manual readings form with inline validation and streak
- `src/components/CrewTab.tsx` — Crew tab: roster cards with per-crew zone status, readiness, and the custom crew creator
- `src/components/InfoTip.tsx` — ⓘ popover that holds long explanations, so cards stay low-text
- `src/components/ui/` — Shared primitives (`Card`, `StatTile` + `DriftChip`, `StatusPill`, `ZoneIcon`)
- `src/components/TopMissionBar.tsx` — ARGUS HUD header, Crew Roster Switcher & "+ Add Crew" trigger, Earth comm delay badge, Crew Readiness Score, Demo Scenario Trigger
- `src/components/CrewManagerModal.tsx` — "Add crew member" dialog to create custom crew members with full physiological & mission details (the roster lives in `CrewTab.tsx`)
- `src/components/BioTwinMap.tsx` — Interactive rotating 3D anatomical Bio-Twin with layer toggles (`all`, `dermal`, `skeletal`, `organs`) & clickable 5-zone body parts
- `src/components/FlightSurgeonPanel.tsx` — Flight Surgeon tab: guidance (re-selected to follow live check-in status), step-by-step exam checklist, webcam/image upload + 1-click sample test images, Earth packet export
- `.agents/skills/pm-agent/` — Autonomous Product Manager (PM) Agent workspace skill (`SKILL.md`), headless Gemini audit runner (`scripts/run-pm-audit.mjs`), GitHub Issues CLI utility (`scripts/gh-pm-issue.mjs`), and GitHub Projects v2 Kanban CLI utility (`scripts/gh-pm-project.mjs`) for continuous hackathon readiness auditing, issue management, and Kanban board synchronization
- `.github/workflows/pm-agent.yml` — Autonomous GitHub Actions workflow running the PM Agent as `github-actions[bot]` on `push` to `main`, scheduled intervals, and manual `workflow_dispatch`
