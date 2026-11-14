# ARGUS — Astronaut Readiness Guidance & Unified Surveillance

> **Autonomous Crew Bio-Twin & Clinical Decision Support System for Deep-Space Missions**

ARGUS is a tabbed spacecraft HUD (Bio-Twin · Trends · Check-in · Flight Surgeon · Crew) designed for astronauts operating under significant one-way Earth communication delays (**14+ minutes in deep-space transit**). It pairs **deterministic physiological threshold evaluation** for `0g` microgravity (`0g_transit`) with an **interactive 3D Holographic Anatomical Bio-Twin**, **longitudinal 14-to-30-day drift telemetry**, and **multimodal Clinical AI Flight Surgeon guidance** (with 100% deterministic offline fallback).

---

## 1. Spec-Driven Development (SDD) Workflow

This repository strictly follows **Spec-Driven Development** (`AGENTS.md`). Every contributor (human or AI agent) **must** follow these rules:

1. **Canonical Specifications (`/specs`) are the Single Source of Truth:**
   - [`specs/00-architecture.md`](./specs/00-architecture.md) — System architecture, tech stack, and folder layout.
   - [`specs/01-data-schema.md`](./specs/01-data-schema.md) — Domain models, `0g` microgravity vital thresholds, and AI JSON schemas.
   - [`specs/02-ui-dashboard.md`](./specs/02-ui-dashboard.md) — Single-screen HUD grid, 3D Bio-Twin layers/zones, and interactive clinical workflows.
   - [`specs/03-requirements.md`](./specs/03-requirements.md) — Mission health monitoring challenge requirements, considerations, and traceability matrix.
   - [`specs/04-ai-backend.md`](./specs/04-ai-backend.md) — AI backend: local/free provider chain, endpoints, and deterministic models.
   - [`specs/tasks.md`](./specs/tasks.md) — Active sprint task board, status tracking (`[TODO]`, `[IN PROGRESS]`, `[DONE]`), and file ownership.
2. **Spec First:** Never introduce new telemetry fields, status thresholds, or component props in code without updating the corresponding file in `/specs` first.
3. **Claim Your Task:** Mark your task as `[IN PROGRESS]` in `specs/tasks.md` before modifying files, and `[DONE]` once verified by `npm run build` and `npm test`.
4. **Deterministic Triage + AI Guidance:** Keep `green` / `yellow` / `red` threshold evaluation strictly deterministic in TypeScript (`src/utils/triageEngine.ts`). Use the Clinical AI layer (`src/services/flightSurgeonAi.ts`) strictly for plain-language explanations, step-by-step guided self-exams, and visual self-exam triage.

See [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for the complete contributor guide and architecture handover.

---

## 2. Quick Start

### Prerequisites
- **Node.js** `>= 18.x` (tested on Node `22.x`)
- **npm** `>= 9.x`

### Install & Run
```bash
npm install
npm run dev
```

### Optional: Live AI (free — local model or free cloud tier)
ARGUS works **100% offline out-of-the-box** using NASA HRP-grounded pre-cached clinical protocols. Live AI runs on the ARGUS backend (`server/`), so no key ever reaches the browser:

```bash
cp .env.example .env   # pick AI_PROVIDERS and set AI_LOCAL_MODEL and/or a free key
npm run ai:local       # optional: check that Ollama and the model are ready
npm run dev:all        # Vite + AI backend (or `npm run dev:local` to force the local model)
```
Providers: local Ollama / LM Studio, OpenRouter free models, Gemini free tier, Groq, or any OpenAI-compatible endpoint. See [`specs/04-ai-backend.md`](./specs/04-ai-backend.md).

### Verify Build & Deterministic Triage Tests
```bash
npm test
npm run build
```

---

## 3. System Architecture & Key Modules

| Path | Responsibility | Spec Reference |
|---|---|---|
| `src/types/argus.ts` | Canonical TypeScript interfaces for zones, vitals, scenarios, AI JSON, and Earth packets | `specs/01-data-schema.md` |
| `src/utils/triageEngine.ts` | Pure, deterministic `green`/`yellow`/`red` threshold evaluator for `0g_transit` + Crew Readiness Score | `specs/01-data-schema.md` (§2–§3) |
| `src/data/telemetryScenarios.ts` | 30-day longitudinal telemetry datasets, 4 crisis scenarios (`nominal`, `sans_alert`, `high_co2`, `solar_storm`), offline protocols, and SVG medical imaging samples | `specs/01-data-schema.md` (§1–§4) |
| `src/services/flightSurgeonAi.ts` | Structured Clinical AI output & multimodal image triage with automatic offline fallback | `specs/00-architecture.md`, `specs/01-data-schema.md` (§4) |
| `src/context/MissionContext.tsx` | Central mission state (`useReducer`) coordinating environment, scenario, 3D Bio-Twin selection, checklist progress, and queued Earth telemetry packets | `specs/00-architecture.md` |
| `src/components/TopMissionBar.tsx` | Spacecraft HUD top bar: comm delay badge, Readiness Score, Medical Event Simulator, and interactive Crew Roster Strip | `specs/02-ui-dashboard.md` (§1) |
| `src/components/CrewManagerModal.tsx` | "Add crew member" dialog with individualized physiological baselines (`restingHrBaselineBpm`, `preFlightOnsdMm`) | `specs/01-data-schema.md` (§1), `specs/02-ui-dashboard.md` (§2.5) |
| `src/components/BioTwinMap.tsx` | Interactive rotating **3D Holographic Human Bio-Twin** (`@react-three/fiber` + `@react-three/drei`) with layer switcher (`All`, `Dermal`, `Skeletal`, `Organs`) & 5 clickable anatomical regions | `specs/02-ui-dashboard.md` (§1) |
| `src/utils/driftAnalytics.ts` | Personal-baseline drift (σ, EWMA), 3-day forecast with 90% interval, evidence-backed metric links ("Why") | `specs/01-data-schema.md` (§5) |
| `src/utils/checkIns.ts` | Daily check-in validation, overlay onto telemetry, logging streak | `specs/01-data-schema.md` (§6) |
| `src/components/TabBar.tsx` | Accessible 5-tab navigation (arrow keys, badges, persisted tab) | `specs/02-ui-dashboard.md` (§1) |
| `src/components/BioTwinTab.tsx` | Bio-Twin tab: 3D stage + selected-zone vital tiles with drift chips | `specs/02-ui-dashboard.md` (§2.1) |
| `src/components/TrendsTab.tsx` | Trends tab: chart with nominal/baseline/forecast bands, drift card, "Why" links | `specs/02-ui-dashboard.md` (§2.2) |
| `src/components/CheckInTab.tsx` | Check-in tab: manual readings, inline range validation, status-change summary | `specs/02-ui-dashboard.md` (§2.3) |
| `src/components/CrewTab.tsx` | Crew tab: roster cards with zone status, readiness, streak, details | `specs/02-ui-dashboard.md` (§2.5) |
| `src/components/ui/`, `InfoTip.tsx` | Shared primitives (`Card`, `StatTile`, `StatusPill`, `ZoneIcon`) and ⓘ popover for low-text UI | `specs/02-ui-dashboard.md` (§3) |
| `src/components/FlightSurgeonPanel.tsx` | Flight Surgeon tab: situation card, guided steps, visual self-exam, Earth packet queue (guidance follows live check-in status) | `specs/02-ui-dashboard.md` (§2.4) |
| `.agents/skills/` | Vendor-neutral agent skills for UI work (`frontend-design`, `design-system`, `ux-copy`, `accessibility-review`, `design-critique`) | `AGENTS.md` (§5) |

---

## 4. Roadmap

- **ARGUS Companion (AI chat):** a chat drawer with a deterministic offline "brain", optional live Clinical AI, and voice in/out, ported from the `ARGOS_The_Thousand_Eyes.html` prototype. Specified in `specs/02-ui-dashboard.md` §5 and `specs/01-data-schema.md` §7, tracked as a `[TODO]` backlog item in `specs/tasks.md`.
