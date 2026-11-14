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

### Task 10: Remove Gemini Product Branding & Standardize Clinical AI Naming
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md` (§4), `specs/02-ui-dashboard.md` (§1)
- **Files Owned:**
  - `specs/00-architecture.md`
  - `specs/01-data-schema.md`
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

---

## Sprint 4: 0g Microgravity Baseline Simplification

### Task 11: Remove Multi-Gravity Modes & Standardize on 0g Microgravity Baseline
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/01-data-schema.md` (§1–§2), `specs/02-ui-dashboard.md` (§1)
- **Files Owned:**
  - `specs/00-architecture.md`
  - `specs/01-data-schema.md`
  - `specs/02-ui-dashboard.md`
  - `specs/tasks.md`
  - `src/types/argus.ts`
  - `src/utils/triageEngine.ts`
  - `src/data/telemetryScenarios.ts`
  - `src/services/flightSurgeonAi.ts`
  - `src/context/MissionContext.tsx`
  - `src/components/TopMissionBar.tsx`
  - `src/utils/__tests__/triageEngine.test.ts`
  - `README.md`
  - `docs/CONTRIBUTING.md`

---

## Sprint 5: Challenge Requirements & Traceability

### Task 12: Document Challenge Requirements & Traceability Spec
- **Status:** `[DONE]`
- **Spec References:** `specs/03-requirements.md`
- **Files Owned:**
  - `specs/03-requirements.md`
  - `specs/tasks.md`
  - `AGENTS.md`
  - `README.md`

---

## Sprint 6: Autonomous Product Manager (PM) Agent & Continuous Hackathon Audit

### Task 13: Product Manager Agent Skill, GitHub Issue Utility & Scheduled Automation
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/03-requirements.md`
- **Files Owned:**
  - `.agents/skills/pm-agent/SKILL.md`
  - `.agents/skills/pm-agent/scripts/gh-pm-issue.mjs`
  - `.agents/skills/pm-agent/scripts/miro-pm-board.mjs`
  - `.env.example`
  - `specs/00-architecture.md`
  - `specs/tasks.md`

### Task 14: GitHub Actions Autonomous PM Bot Workflow & Headless Audit Runner
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/03-requirements.md`
- **Files Owned:**
  - `.github/workflows/pm-agent.yml`
  - `.agents/skills/pm-agent/scripts/run-pm-audit.mjs`
  - `.agents/skills/pm-agent/scripts/gh-pm-issue.mjs`
  - `.agents/skills/pm-agent/SKILL.md`
  - `.env.example`
  - `specs/00-architecture.md`
  - `specs/tasks.md`

### Task 15: Swap Miro Kanban Sync for GitHub Projects v2 Integration
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/03-requirements.md`
- **Files Owned:**
  - `.agents/skills/pm-agent/scripts/gh-pm-project.mjs`
  - `.agents/skills/pm-agent/scripts/run-pm-audit.mjs`
  - `.github/workflows/pm-agent.yml`
  - `.agents/skills/pm-agent/SKILL.md`
  - `.env.example`
  - `specs/00-architecture.md`
  - `specs/tasks.md`

### Task 16: Issue Triage Labels (`human-review` / `agent-task`) & Urgency Kanban Columns (`Backlog` / `Todo` / `Urgent`)
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/03-requirements.md`
- **Files Owned:**
  - `.agents/skills/pm-agent/scripts/gh-pm-project.mjs`
  - `.agents/skills/pm-agent/scripts/run-pm-audit.mjs`
  - `.agents/skills/pm-agent/SKILL.md`
  - `specs/tasks.md`

### Task 17: Active Open Issue Lifecycle Management (Comment, Ping, Re-Label & Re-Prioritize)
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/03-requirements.md`
- **Files Owned:**
  - `.agents/skills/pm-agent/scripts/gh-pm-issue.mjs`
  - `.agents/skills/pm-agent/scripts/run-pm-audit.mjs`
  - `.agents/skills/pm-agent/SKILL.md`
  - `specs/tasks.md`

### Task 18: GitHub Projects `Priority` Field & Issue Category Labels
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/03-requirements.md`
- **Files Owned:**
  - `.agents/skills/pm-agent/scripts/gh-pm-project.mjs`
  - `.agents/skills/pm-agent/scripts/run-pm-audit.mjs`
  - `.agents/skills/pm-agent/SKILL.md`
  - `specs/tasks.md`

---

## Sprint 7: Autonomous Software Engineer (SWE) Agent & Dynamic Gemini 4 Model Routing

### Task 19: Local Antigravity (`agy`) SWE Agent Skill & GitHub PR CLI
- **Status:** `[DONE]`
- **Spec References:** `specs/00-architecture.md`, `specs/03-requirements.md`
- **Files Owned:**
  - `.agents/skills/swe-agent/SKILL.md`
  - `.agents/skills/swe-agent/scripts/gh-swe-pr.mjs`
  - `.env.example`
  - `specs/00-architecture.md`
  - `specs/tasks.md`
