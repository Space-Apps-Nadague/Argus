# ARGUS — Astronaut Readiness Guidance & Unified Surveillance

> **Autonomous Crew Bio-Twin & Clinical Decision Support System for Deep-Space Missions**

ARGUS is a single-screen spacecraft HUD designed for astronauts operating under significant one-way Earth communication delays (**14+ minutes in deep-space transit**). It pairs **deterministic physiological threshold evaluation** for `0g` microgravity (`0g_transit`) with an **interactive 3D Holographic Anatomical Bio-Twin**, **longitudinal 14-to-30-day drift telemetry**, and **multimodal Clinical AI Flight Surgeon guidance** (with 100% deterministic offline fallback).

---

## 1. Spec-Driven Development (SDD) Workflow

This repository strictly follows **Spec-Driven Development** (`AGENTS.md`). Every contributor (human or AI agent) **must** follow these rules:

1. **Canonical Specifications (`/specs`) are the Single Source of Truth:**
   - [`specs/00-architecture.md`](./specs/00-architecture.md) — System architecture, tech stack, and folder layout.
   - [`specs/01-data-schema.md`](./specs/01-data-schema.md) — Domain models, `0g` microgravity vital thresholds, and AI JSON schemas.
   - [`specs/02-ui-dashboard.md`](./specs/02-ui-dashboard.md) — Single-screen HUD grid, 3D Bio-Twin layers/zones, and interactive clinical workflows.
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

### Optional: Live Multimodal Clinical AI API Key
ARGUS works **100% offline out-of-the-box** using NASA HRP-grounded pre-cached clinical protocols. To enable live multimodal synthesis and vision triage:

```bash
cp .env.example .env
# Set VITE_AI_API_KEY=your_api_key_here in .env
```
*(You can also enter or clear a Clinical AI API key directly from the top HUD bar at runtime.)*

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
| `src/components/CrewManagerModal.tsx` | Crew Roster inspector & Custom Crew Member Bio-Twin creator with individualized physiological baselines (`restingHrBaselineBpm`, `preFlightOnsdMm`) | `specs/01-data-schema.md` (§1), `specs/02-ui-dashboard.md` (§1) |
| `src/components/BioTwinMap.tsx` | Interactive rotating **3D Holographic Human Bio-Twin** (`@react-three/fiber` + `@react-three/drei`) with layer switcher (`All`, `Dermal`, `Skeletal`, `Organs`) & 5 clickable anatomical regions | `specs/02-ui-dashboard.md` (§1) |
| `src/components/TelemetryPanel.tsx` | Selected zone vital cards + 14/30-day Recharts `AreaChart` with shaded `ReferenceArea` nominal range band | `specs/02-ui-dashboard.md` (§1) |
| `src/components/FlightSurgeonPanel.tsx` | Spaceflight hazard context card, numbered self-exam checklist, webcam/file/sample visual self-exam input, and Earth Flight Surgeon packet queue | `specs/02-ui-dashboard.md` (§1) |
