# Spec 00: ARGUS System Architecture & Folder Structure

## Product Identity
- **System Name:** ARGUS (*Astronaut Readiness Guidance & Unified Surveillance*)
- **Core Purpose:** Autonomous crew health Bio-Twin and clinical decision support system for deep-space missions experiencing up to 20-minute one-way Earth communication delays.

## Tech Stack
- **UI Framework:** React 18+ (TypeScript) + Vite + Tailwind CSS
- **Data Visualization:** Recharts (`AreaChart`, `ReferenceArea`, `ResponsiveContainer`) for 14-to-30-day vital trends
- **Icons:** `lucide-react`
- **AI Layer:** Multimodal Gemini API (`@google/genai`, Gemini 2.5 Flash) returning structured JSON (`FlightSurgeonGuidance`) + pre-cached offline demo fallback
- **State Management:** React Context / `useReducer` seeded with 30-day synthetic telemetry + instant crisis overrides

## Directory Structure
- `src/data/telemetryScenarios.ts` — Synthetic 30-day datasets & crisis scenarios (`nominal`, `sans_alert`, `high_co2`, `solar_storm`)
- `src/utils/triageEngine.ts` — Deterministic Green/Yellow/Red threshold evaluator across gravity modes
- `src/components/TopMissionBar.tsx` — ARGUS HUD header, Environment Switcher (`0g`, `1/6g`, `3/8g`), Crew Readiness Score, Demo Trigger
- `src/components/BioTwinMap.tsx` — Interactive 5-zone anatomical SVG body map
- `src/components/TelemetryPanel.tsx` — Vital cards + 14-day Recharts trend graphs
- `src/components/FlightSurgeonPanel.tsx` — Autonomous Flight Surgeon guidance, step-by-step exam checklist, webcam/image upload, Earth packet export