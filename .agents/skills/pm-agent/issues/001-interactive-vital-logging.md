**Priority:** `P0` • **Refs:** `REQ-05`, `REQ-06`

### Why it matters
Judges will test how an astronaut logs new health readings (`blood sugar mg/dL`, `blood pressure`, `temperature`, `sleep hours`, `mood`). Right now, `TelemetryPanel.tsx` is 100% read-only.

### PM Critique
- Clicking a vital card only switches static charts; there is no way to type or log a new reading.
- Explicit challenge indicators (`blood_glucose` mg/dL, `blood_pressure`, `core_temp`, `sleep_hours`, `mood`) are still missing.

### Tasks
- [ ] Add `blood_glucose`, `systolic_bp`, `core_temp`, `daily_sleep_hours`, and `mood_index` to `specs/01-data-schema.md` & `telemetryScenarios.ts`.
- [ ] Add a quick **"+ Log Vital Reading"** input in `TelemetryPanel.tsx` to update `MD-30` live.
- [ ] Ensure logged values immediately update the chart, 3D Bio-Twin status color, and Flight Surgeon guidance.
