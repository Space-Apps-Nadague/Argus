# Spec 03: Mission Health Monitoring Challenge Requirements & Traceability

> **Canonical Source:** This specification captures the full challenge brief, background, objectives, and design considerations for **ARGUS** (*Astronaut Readiness Guidance & Unified Surveillance*), and maps each requirement to existing or planned ARGUS capabilities.

---

## 1. Challenge Summary

Long-duration missions expose astronauts to **space radiation**, **isolation and confinement**, **altered gravity**, and a **hostile closed environment**, which can bring **immune changes**, **bone loss**, **cardiovascular events**, and **behavioral health problems**. On long missions, astronauts carry much of the responsibility for spotting these changes in themselves.

The core challenge is to build **health monitoring software** that gathers health indicators and enables astronauts to **evaluate and act on the status of their health**.

---

## 2. Background & Spaceflight Context

- **Exploration Trajectory:** With rising investment in spacecraft technology and research, space missions have become more ambitious—NASA's Artemis program recently accomplished a crewed lunar flyby, and NASA and partner agencies plan to send humans to Mars in the future.
- **NASA HRP Five Hazards of Human Spaceflight:**
  1. **Space radiation**
  2. **Isolation and confinement**
  3. **Distance from Earth**
  4. **Gravity fields** (altered gravity)
  5. **Hostile closed environments**
- **Associated Health Risks:** Immune system changes, bone density loss, cardiovascular events, inadequate nutrition, behavioral health conditions, and related multi-system clinical risks.
- **Crew Self-Assessment Responsibility:** Astronauts must be capable of making health assessments on themselves during a mission to prevent and treat health problems that may arise.
- **Example Core Health Indicators:** Blood pressure, heart rate, blood sugar (e.g., mg/dL), body temperature, daily sleep hours, and mood (alongside mission-specific spaceflight indicators such as ONSD, IOP, $\text{ppCO}_2$, HRV, $\text{SpO}_2$, BMD delta, radiation dose rate, lymphocyte count, and psychomotor vigilance).

---

## 3. Core Objectives

1. **Visual Self-Assessment & Action Guidance:**
   - Provide a visual tool that helps astronauts assess their own health during space missions and provides actionable guidance on **treatments** and **health improvements**.
2. **Multimodal Data Gathering:**
   - Support gathering health indicator data from the user through any appropriate input modality—such as **keyboard text**, **mouse clicks**, or **camera images** (including medical imaging such as **ultrasound images** or **blood sugar levels in mg/dL**).
3. **Evidence-Based Spaceflight Grounding:**
   - Ground indicators, thresholds, and guidance in NASA's Human Research Program (HRP) resources and publicly available resources from other space agencies (see [`SOURCES.md`](../SOURCES.md)).
   - Address key operational clinical questions:
     - *Which measurements can be performed in space?*
     - *Why is an exam needed?*
     - *How do spaceflight hazards affect these health indicators?*
     - *When might a result warrant attention from the crew or from flight surgeons on the ground?*
     - *What actions can be taken to prevent a critical health condition?*
4. **Interactive & Animated User Interface:**
   - Use clear UI design, animations, and interactivity to present metrics and diagnosis clearly.
   - Display a **human figure** where **each part of the body is clickable** and displays information about its **function and health status**.

---

## 4. Potential Considerations & Feature Targets

The following capabilities are recommended considerations to strengthen crew engagement, usability, and operational realism:

1. **Multi-Environment Insights:**
   - Provide health insights tailored to astronauts in different mission environments, such as a **spacecraft**, **space station**, **rover**, or a **base on another planet or moon**.
2. **Scheduled Mission Routine Prompts:**
   - Prompt astronauts to take measurements or complete specific health actions periodically as part of the mission routine.
3. **Gamification System:**
   - Include a gamification system (e.g., streaks, readiness milestones, or mission-task engagement) to help astronauts stay engaged with health-supporting tasks.
4. **Dynamic Longitudinal Charts:**
   - Display dynamic charts showing how an astronaut's health indicators change over time.
5. **At-a-Glance Color Coding:**
   - Use clear color coding (e.g., Green / Yellow / Red) to help the astronaut interpret the status of a health indicator immediately.
6. **Accessible Non-Physician Explanations:**
   - Do not assume astronauts know everything about how to assess their health; provide simple instructions and plain-language explanations covering **measurements**, **health indicators**, and **risks**.

---

## 5. Requirement-to-ARGUS Traceability Matrix

| ID | Requirement / Consideration | Current ARGUS Status | Spec / Module Reference |
|---|---|---|---|
| `REQ-01` | Interactive animated human figure with clickable body parts showing function & health status | **Implemented** (3D rotating Bio-Twin with 5 clickable zones & anatomical layers) | `specs/02-ui-dashboard.md`, `src/components/BioTwinMap.tsx` |
| `REQ-02` | At-a-glance color coding for health status | **Implemented** (Deterministic Green `#22c55e`, Yellow `#eab308`, Red `#ef4444` triage) | `specs/01-data-schema.md` (§2), `src/utils/triageEngine.ts` |
| `REQ-03` | Dynamic charts showing health indicators over time | **Implemented** (14/30-day Recharts `AreaChart` with `ReferenceArea` nominal bands) | `specs/02-ui-dashboard.md`, `src/components/TelemetryPanel.tsx` |
| `REQ-04` | Plain-language explanations of measurements, indicators, risks, and treatments | **Implemented** (`plainDescription`, `hazardContextSummary`, numbered `guidedSteps` with hardware & duration) | `specs/01-data-schema.md` (§3–§4), `src/components/FlightSurgeonPanel.tsx` |
| `REQ-05` | Multimodal user data input (clicks, text, camera/ultrasound images, manual indicator entry) | **Partial** (Webcam/file image upload + sample ultrasound/retina/rash triage & crew notes text; manual numeric entry for vitals such as blood pressure, blood sugar mg/dL, body temperature, daily sleep hours, and mood is a future target) | `src/components/FlightSurgeonPanel.tsx`, `specs/01-data-schema.md` |
| `REQ-06` | Additional core indicators (blood pressure, blood sugar mg/dL, body temp, daily sleep hours, mood, nutrition) | **Partial** (Heart rate & sleep efficiency implemented; blood pressure, blood sugar, body temperature, daily sleep hours, mood, and nutrition indicators are future targets) | `specs/01-data-schema.md` (§2) |
| `REQ-07` | Multi-environment support (spacecraft, space station, rover, lunar/planetary base) | **Implemented** (4 location/habitat presets: `iss_leo`, `lunar_base`, `0g_transit`, `mars_base` with dynamic comm delay, gravity-adjusted thresholds, and Earth telemetry packet routing) | `specs/01-data-schema.md` (§1–§2), `src/components/TopMissionBar.tsx`, `src/utils/triageEngine.ts` |
| `REQ-08` | Periodic mission routine measurement & action prompts | **Implemented** (`ScheduledRoutineBanner.tsx` with sol indicator, due alert & 1-click quick-log) | `specs/01-data-schema.md` (§8), `specs/02-ui-dashboard.md` (§1) |
| `REQ-09` | Gamification system for health task engagement | **Implemented** (`ReadinessMilestone` badges, streak tracking, interactive badge popover) | `specs/01-data-schema.md` (§8), `src/utils/routineMilestones.ts` |
| `REQ-10` | NASA HRP & partner agency grounding | **Implemented** (Mapped to 5 HRP hazards & cataloged in `SOURCES.md`) | `SOURCES.md`, `specs/01-data-schema.md` |
