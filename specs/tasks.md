# ARGUS — Sprint Tasks & File Ownership

> **Protocol Reminder (`AGENTS.md`):**
> 1. Never invent new telemetry fields, status thresholds, or component props in code without updating `/specs` first.
> 2. State which spec sections apply and which files will change before modifying code.
> 3. Mark your active task as `[IN PROGRESS]` before editing files, and `[DONE]` once verified.

---

## Sprint 1: Core ARGUS Autonomous Crew Bio-Twin Platform

### Task 1: Canonical Specifications & Repo Documentation
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md`, `specs/02-ui-dashboard.md`
- **Files Owned:**
  - `specs/00-architecture.md`
  - `specs/01-data-schema.md`
  - `specs/02-ui-dashboard.md`
  - `specs/tasks.md`
  - `README.md`
  - `docs/CONTRIBUTING.md`

### Task 2: Project Scaffolding & Build Configuration
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md` (Tech Stack)
- **Files Owned:**
  - `package.json`
  - `tsconfig.json`
  - `vite.config.ts`
  - `tailwind.config.js`
  - `postcss.config.js`
  - `index.html`
  - `src/index.css`
  - `src/main.tsx`

### Task 3: Canonical Data Schema, Deterministic Triage Engine & Synthetic Telemetry Scenarios
- **Status:** `[DONE]`
- **Spec References:** `specs/01-data-schema.md` (§1–§4)
- **Files Owned:**
  - `src/types/argus.ts`
  - `src/utils/triageEngine.ts`
  - `src/data/telemetryScenarios.ts`

### Task 4: Multimodal Gemini AI Service + Offline Verified Fallback & Mission State Context
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md` (§4)
- **Files Owned:**
  - `src/services/flightSurgeonAi.ts`
  - `src/context/MissionContext.tsx`

### Task 5: Top Mission Bar & 3D Holographic Anatomical Bio-Twin (`BioTwinMap.tsx`)
- **Status:** `[DONE]`
- **Spec References:** `specs/02-ui-dashboard.md` (§1 Top Bar & Left Column)
- **Files Owned:**
  - `src/components/TopMissionBar.tsx`
  - `src/components/BioTwinMap.tsx`

### Task 6: Longitudinal Telemetry Panel (`TelemetryPanel.tsx`) & Autonomous Flight Surgeon Panel (`FlightSurgeonPanel.tsx`)
- **Status:** `[DONE]`
- **Spec References:** `specs/02-ui-dashboard.md` (§1 Center Column & Right Column)
- **Files Owned:**
  - `src/components/TelemetryPanel.tsx`
  - `src/components/FlightSurgeonPanel.tsx`
  - `src/App.tsx`

### Task 7: Automated Unit Tests, Build Verification & Developer Handover Docs
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md`, `specs/02-ui-dashboard.md`
- **Files Owned:**
  - `src/utils/__tests__/triageEngine.test.ts`
  - `README.md`
  - `docs/CONTRIBUTING.md`

---

## Sprint 2: Multi-Crew Roster & Custom Astronaut Bio-Twin Creator

### Task 8: Multi-Crew Roster, Individualized Telemetry Modifiers & Custom Crew Member Creator
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md` (§1 `CrewMemberProfile`, §4 `EarthTelemetryPacket`), `specs/02-ui-dashboard.md` (§1 Top Bar, Crew Roster Strip & `CrewManagerModal.tsx`)
- **Files Owned:**
  - `src/types/argus.ts`
  - `src/data/telemetryScenarios.ts`
  - `src/services/flightSurgeonAi.ts`
  - `src/context/MissionContext.tsx`
  - `src/components/CrewManagerModal.tsx`
  - `src/components/TopMissionBar.tsx`
  - `src/components/BioTwinMap.tsx`
  - `src/utils/__tests__/triageEngine.test.ts`
  - `README.md`

---

## Sprint 3: Central Hero 3D Bio-Twin Stage & Sculpted Male/Female 3D Anatomy

### Task 9: Central Hero Dashboard Layout & Realistic Sculpted Male/Female 3D Bio-Twin
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md` (§1 `BiologicalSex`, `CrewMemberProfile`), `specs/02-ui-dashboard.md` (§1 Center Hero Column `BioTwinMap.tsx`, Left Column `TelemetryPanel.tsx`, `CrewManagerModal.tsx`)
- **Files Owned:**
  - `src/types/argus.ts`
  - `src/data/telemetryScenarios.ts`
  - `src/context/MissionContext.tsx`
  - `src/utils/anatomicalGeometry.ts`
  - `src/App.tsx`
  - `src/components/BioTwinMap.tsx`
  - `src/components/TelemetryPanel.tsx`
  - `src/components/CrewManagerModal.tsx`
  - `src/components/TopMissionBar.tsx`
  - `src/utils/__tests__/triageEngine.test.ts`

### Task 9: Remove Gemini Product Branding & Standardize Clinical AI Naming
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md` (§4), `specs/02-ui-dashboard.md` (§1)
- **Files Owned:**
  - `specs/00-architecture.md`
  - `specs/01-data-schema.md`
  - `specs/01-ui-dashboard.md`
  - `specs/02-ui-dashboard.md`
  - `specs/tasks.md`
  - `src/types/argus.ts`
  - `src/services/flightSurgeonAi.ts`
  - `src/context/MissionContext.tsx`
  - `src/components/TopMissionBar.tsx`
  - `src/components/FlightSurgeonPanel.tsx`
  - `.env.example`
  - `README.md`
  - `docs/CONTRIBUTING.md`
