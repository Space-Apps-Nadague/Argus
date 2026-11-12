# Spec 00: ARGUS System Architecture & Folder Structure

## Product Identity
- **System Name:** ARGUS (*Astronaut Readiness Guidance & Unified Surveillance*)
- **Core Purpose:** Autonomous crew health Bio-Twin and clinical decision support system for deep-space missions experiencing up to 20-minute one-way Earth communication delays.

## Tech Stack
- **UI Framework:** React 18+ (TypeScript) + Vite + Tailwind CSS
- **3D Bio-Twin:** Three.js (`three`, `@react-three/fiber`, `@react-three/drei`) for a rotating, interactive 3D anatomical figure with selectable layers and clickable body parts, plus a WebGL error-boundary fallback
- **Data Visualization:** Recharts (`AreaChart`, `ReferenceArea`, `ResponsiveContainer`, `Tooltip`, `XAxis`, `YAxis`) for 14-to-30-day vital trends
- **Icons:** `lucide-react`
- **AI Layer:** Multimodal Gemini API (`@google/genai`, `gemini-3.8-flash` via Interactions API — upgraded from deprecated `gemini-2.5-flash`) returning structured JSON (`FlightSurgeonGuidance` & `VisualExamAnalysis`) + deterministic pre-cached offline demo fallback when `VITE_GEMINI_API_KEY` is absent or offline
- **State Management:** React Context / `useReducer` (`MissionContext.tsx`) seeded with a multi-astronaut crew roster (persisted in `localStorage`), individualized 30-day synthetic telemetry, and instant crisis overrides

## Directory Structure
- `specs/` — Canonical Specification Documents (Single Source of Truth)
  - `specs/00-architecture.md` — System architecture, tech stack, and directory layout
  - `specs/01-data-schema.md` — Data models (including `CrewMemberProfile`), deterministic triage thresholds, and AI JSON schemas
  - `specs/02-ui-dashboard.md` — Spacecraft HUD layout, Crew Roster & Custom Crew Creator specs, 3D Bio-Twin specs, component props, and demo controls
  - `specs/tasks.md` — Active sprint backlog, task statuses, and file ownership
- `src/types/argus.ts` — Canonical TypeScript interfaces matching `specs/01-data-schema.md`
- `src/data/telemetryScenarios.ts` — Default 4-astronaut crew roster (`DEFAULT_CREW_ROSTER`), individualized 30-day telemetry generator, crisis scenarios (`nominal`, `sans_alert`, `high_co2`, `solar_storm`), pre-cached Flight Surgeon guidance, and visual self-exam samples
- `src/utils/triageEngine.ts` — Deterministic Green/Yellow/Red threshold evaluator across gravity modes (`0g_transit`, `1_6g_moon`, `3_8g_mars`) and Crew Readiness Score calculator
- `src/services/flightSurgeonAi.ts` — Multimodal Gemini API service (`@google/genai` `interactions.create` with `gemini-3.8-flash`) with automatic offline fallback
- `src/context/MissionContext.tsx` — Unified React Context & reducer managing crew roster, active crew member, custom crew creation, environment, active scenario, selected zone, anatomical layer, checklist completion, visual triage, and queued Earth packets
- `src/components/TopMissionBar.tsx` — ARGUS HUD header, Crew Roster Switcher & "+ Add Crew" trigger, Earth comm delay badge, Environment Switcher (`0g`, `1/6g`, `3/8g`), Crew Readiness Score, Demo Scenario Trigger
- `src/components/CrewManagerModal.tsx` — Interactive modal to inspect all crew members in the roster, switch active crew Bio-Twin, and create custom crew members with full physiological & mission details
- `src/components/BioTwinMap.tsx` — Interactive rotating 3D anatomical Bio-Twin with layer toggles (`all`, `dermal`, `skeletal`, `organs`) & clickable 5-zone body parts
- `src/components/TelemetryPanel.tsx` — Vital cards + 14-to-30-day Recharts trend graphs with shaded `ReferenceArea` nominal ranges
- `src/components/FlightSurgeonPanel.tsx` — Autonomous Flight Surgeon guidance, step-by-step exam checklist, webcam/image upload + 1-click sample test images, Earth packet export
