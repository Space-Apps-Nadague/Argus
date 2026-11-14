# ARGUS — Astronaut Readiness Guidance & Unified Surveillance

> **Autonomous Crew Bio-Twin & Clinical Decision Support System for Deep-Space Missions**

ARGUS is a spacecraft medical HUD built for crews operating under significant one-way Earth communication delays (**14+ minutes in deep-space transit**). It pairs **deterministic physiological threshold evaluation** with an **interactive 3D Holographic Anatomical Bio-Twin**, **longitudinal 14-to-30-day drift telemetry**, and **multimodal Clinical AI Flight Surgeon guidance**—while remaining **100% functional offline**.

---

## Key Capabilities

- **Deterministic Triage Engine:** Green / Yellow / Red status evaluation and Crew Readiness Scoring (`0–100%`) run purely in TypeScript (`src/utils/triageEngine.ts`)—the AI layer never sets or overrides clinical triage states.
- **3D Holographic Anatomical Bio-Twin:** Interactive Three.js (`@react-three/fiber`) human model with male/female morphological differentiation, vertex-sculpted visceral organs (gyri-contoured brain, 4-chamber heart, lungs with cardiac notch, liver, spleen, thymus), skeletal/vascular/lymphatic layers, and 5 clickable physiological zones (`neuro`, `cardio`, `musculo`, `immune`, `behavioral`).
- **Personal-Baseline Drift & Forecasting:** Tracks 14- and 30-day telemetry against each astronaut's personal baseline ($\sigma$-drift, EWMA), projects 3-day forecasts with 90% intervals, and surfaces lagged cross-metric associations.
- **Offline-First Flight Surgeon & Visual Self-Exam:** Provides NASA HRP-grounded self-assessment checklists, camera/upload visual triage, and delay-tolerant Earth telemetry packet queuing, with optional local or free-tier LLM synthesis via the `server/` backend.

---

## HUD Overview (5 Tabs)

| Tab | Purpose |
|---|---|
| **Bio-Twin** | Interactive 3D anatomical stage (layer switcher, sex toggle, camera presets) + live vital tiles for the selected zone |
| **Trends** | 14d/30d Recharts telemetry with nominal bands, personal baseline, 3-day forecast, drift $\sigma$ card, and "Why" links; includes inline **Log Vital Reading** |
| **Check-in** | Daily mission-day (`MD-n`) manual vital entry with range validation, logging streak, and zone status-change summary |
| **Flight Surgeon** | Hazard-aware clinical guidance, step-by-step crew self-exam checklist, visual self-exam triage, and Earth packet queue |
| **Crew** | Roster cards with per-crew readiness, 5-zone status dots, check-in streaks, and custom crew member creation |

---

## Quick Start

### Prerequisites
- **Node.js** `>= 18.x` (tested on Node `22.x`)
- **npm** `>= 9.x`

### Run Offline (Frontend Only)
ARGUS works **100% offline out-of-the-box** using NASA HRP-grounded pre-cached clinical protocols:

```bash
npm install
npm run dev
```

### Optional: Live AI Backend (Local or Free Cloud Tier)
Live AI runs on the ARGUS Hono backend (`server/`), keeping API keys out of the browser:

```bash
cp .env.example .env   # configure AI_PROVIDERS, AI_LOCAL_MODEL, and/or a free API key
npm run ai:local       # optional: verify Ollama and local model readiness
npm run dev:all        # start Vite frontend + AI backend together
```

Supported providers: local **Ollama / LM Studio** (`npm run dev:local` to force local), **OpenRouter** free models, **Gemini** free tier, **Groq**, or any OpenAI-compatible endpoint. See [`specs/04-ai-backend.md`](./specs/04-ai-backend.md).

### Verify Tests & Build
```bash
npm test               # Vitest unit & backend test suite
npm run build          # TypeScript check (tsc -b) + Vite production bundle
npm run typecheck:server
```

---

## Architecture & Key Modules

| Path | Responsibility | Spec Reference |
|---|---|---|
| `src/types/argus.ts` | Canonical TypeScript interfaces for zones, vitals, scenarios, AI JSON, and Earth packets | `specs/01-data-schema.md` |
| `src/utils/triageEngine.ts` | Pure, deterministic `green`/`yellow`/`red` threshold evaluator + Crew Readiness Score | `specs/01-data-schema.md` (§2–§3) |
| `src/utils/anatomicalGeometry.ts` | Parametric vertex-sculpted 3D meshes for dermal, skeletal, vascular, lymphatic, and visceral organ structures | `specs/02-ui-dashboard.md` (§2.1) |
| `src/utils/driftAnalytics.ts` | Personal-baseline drift ($\sigma$, EWMA), 3-day forecast with 90% interval, and lagged metric links | `specs/01-data-schema.md` (§5) |
| `src/utils/checkIns.ts` | Daily check-in validation, telemetry overlay, and logging streak | `specs/01-data-schema.md` (§6) |
| `src/data/telemetryScenarios.ts` | 30-day longitudinal telemetry, 4 medical event scenarios (`nominal`, `sans_alert`, `high_co2`, `solar_storm`), offline protocols, and sample imaging | `specs/01-data-schema.md` (§1–§4) |
| `src/services/flightSurgeonAi.ts` | Structured Clinical AI client & multimodal image triage with automatic offline fallback | `specs/00-architecture.md`, `specs/01-data-schema.md` (§4) |
| `src/context/MissionContext.tsx` | Central mission state (`useReducer`) coordinating scenario, active crew, 3D Bio-Twin selection, check-ins, and Earth packets | `specs/00-architecture.md` |
| `src/components/TopMissionBar.tsx` | HUD top bar: ARGUS title, comm delay badge, Readiness Score, Medical Event Simulator, and Crew Roster Strip | `specs/02-ui-dashboard.md` (§1) |
| `src/components/TabBar.tsx` | Accessible 5-tab navigation with keyboard support, alert badges, and persisted active tab | `specs/02-ui-dashboard.md` (§1) |
| `src/components/BioTwinMap.tsx` | Interactive 3D Holographic Human Bio-Twin (`@react-three/fiber` + `@react-three/drei`) with layer switcher & 5 clickable zones | `specs/02-ui-dashboard.md` (§2.1) |
| `src/components/BioTwinTab.tsx` | Bio-Twin tab: 3D stage + selected-zone vital tiles with drift chips | `specs/02-ui-dashboard.md` (§2.1) |
| `src/components/TrendsTab.tsx` | Trends tab: Recharts telemetry chart, vital reading logger, drift card, and "Why" links | `specs/02-ui-dashboard.md` (§2.2) |
| `src/components/CheckInTab.tsx` | Check-in tab: manual readings, inline range validation, and status-change summary | `specs/02-ui-dashboard.md` (§2.3) |
| `src/components/FlightSurgeonPanel.tsx` | Flight Surgeon tab: hazard context, guided self-exam steps, visual triage, and Earth packet queue | `specs/02-ui-dashboard.md` (§2.4) |
| `src/components/CrewTab.tsx` & `CrewManagerModal.tsx` | Crew roster cards and individualized baseline creation modal | `specs/02-ui-dashboard.md` (§2.5) |
| `src/components/ui/`, `InfoTip.tsx` | Shared HUD primitives (`Card`, `StatTile`, `StatusPill`, `ZoneIcon`) and accessible ⓘ popovers | `specs/02-ui-dashboard.md` (§3) |
| `server/` | Hono AI backend with provider fallback chain, Zod schemas, and deterministic test suite | `specs/04-ai-backend.md` |

---

## Spec-Driven Development (SDD) Workflow

This repository follows **Spec-Driven Development** ([`AGENTS.md`](./AGENTS.md)). Every contributor (human or AI agent) should follow these rules:

1. **Canonical Specifications (`/specs`) are the Single Source of Truth:**
   - [`specs/00-architecture.md`](./specs/00-architecture.md) — System architecture, tech stack, and folder layout.
   - [`specs/01-data-schema.md`](./specs/01-data-schema.md) — Domain models, `0g` microgravity vital thresholds, and AI JSON schemas.
   - [`specs/02-ui-dashboard.md`](./specs/02-ui-dashboard.md) — HUD layout, 3D Bio-Twin layers/zones, and interactive workflows.
   - [`specs/03-requirements.md`](./specs/03-requirements.md) — Challenge requirements and traceability matrix.
   - [`specs/04-ai-backend.md`](./specs/04-ai-backend.md) — AI backend provider chain, endpoints, and deterministic models.
2. **Spec First:** Update the relevant file in `/specs` before adding new telemetry fields, thresholds, or component props.
3. **Claim Your Task:** Track work in [GitHub Issues](https://github.com/Space-Apps-Nadague/Argus/issues) and the GitHub Projects kanban (`In Progress` while working, closed via `Closes #<n>` once `npm test` and `npm run build` pass).
4. **Authoritative References:** Clinical indicators and spaceflight hazards are grounded in [`SOURCES.md`](./SOURCES.md) (NASA HRP & CSA).

See [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for the full contributor guide and `.agents/skills/` for UI/UX design and accessibility skills.

---

## Roadmap

- **ARGUS Companion (AI chat):** Slide-over chat drawer with a deterministic offline "brain", optional live Clinical AI, and browser voice in/out, ported from the `ARGOS_The_Thousand_Eyes.html` prototype. Specified in `specs/02-ui-dashboard.md` §5 and `specs/01-data-schema.md` §7, tracked in issue [#7](https://github.com/Space-Apps-Nadague/Argus/issues/7).
