# Spec 02: ARGUS Mission Control Bio-Twin Dashboard UI

> Sprint 7 replaces the fixed 3-column single screen with a **slim top bar + 5-tab HUD**. Ideas are ported from the ARGOS prototype (`ARGOS_The_Thousand_Eyes.html`). Design guidance: `.agents/skills/frontend-design`, `design-system`, `ux-copy`, `accessibility-review`.

## 1. Layout

```
┌───────────────────────────────────────────────────────────────┐
│ Top Mission Bar: brand · comm delay · readiness · scenario · ⚙ │
│ Crew strip: pills (callsign + status dot) · + Add crew         │
├───────────────────────────────────────────────────────────────┤
│ Tab bar: Bio-Twin | Trends | Check-in | Flight Surgeon | Crew  │
├───────────────────────────────────────────────────────────────┤
│                    Active tab content (full width)             │
└───────────────────────────────────────────────────────────────┘
```

- **Top Bar (`TopMissionBar.tsx`) — slim, low-text:**
  - Brand `ARGUS` (display font) + expanded abbreviation `Astronaut Readiness Guidance & Unified Surveillance` + small `Crew Bio-Twin · <Location> (<Gravity>)`.
  - Dynamic **Signal Comm Delay to Earth** badge (`Real-time to Earth`, `1.3s to Earth`, `14m 22s to Earth`, `18m 10s to Earth`).
  - Dynamic **Surface/Orbital Gravity** badge (`0.00g`, `0.16g`, `0.38g`).
  - **Location / Habitat Selector** dropdown (`iss_leo`, `lunar_base`, `0g_transit`, `mars_base` presets) dynamically updating comm delay, gravity thresholds, Earth packet metadata, and autonomous urgency.
  - **Crew Readiness Score** `0–100%` with status color + daily countermeasure streak.
  - **Milestone Badges Trigger**: Interactive badge chip (`🏆 <n> Badges`) with popover/modal to inspect unlocked readiness milestones and streak progress (`REQ-09`).
  - **Simulate Medical Event** dropdown (`nominal`, `sans_alert`, `high_co2`, `solar_storm`).
  - Optional Clinical AI key button (icon only + tooltip).
  - **Crew Roster Strip:** selectable pills (callsign, name, live readiness dot) + `+ Add crew` (opens `CrewManagerModal.tsx` in create mode).
- **Scheduled Mission Routine Banner (`ScheduledRoutineBanner.tsx`):**
  - Prominently positioned above tab content to prompt astronauts for pending daily measurements (`REQ-08`).
  - Displays sol indicator (`MD-<n>`), check-in status, quick-log action (1-click completion of nominal routine), link to full check-in tab, and expandable readiness milestone progress shelf (`REQ-09`).
- **Tab Bar (`TabBar.tsx`):** `role="tablist"`. Each tab is a `role="tab"` button with icon + short label + optional badge (e.g. red count on Bio-Twin when any zone is red; check-in due dot when today is not logged). Left/Right/Home/End keys move focus and selection. The active tab persists in `localStorage` (`argus_active_tab_v1`). Type: `HudTabId = 'biotwin' | 'trends' | 'checkin' | 'surgeon' | 'crew'`.

## 2. Tabs

### 2.1 Bio-Twin (`BioTwinTab.tsx`) — default tab
- Grid: 3D stage (≈ 2/3 width, `BioTwinMap.tsx`, unchanged behavior) + side column (≈ 1/3) of **vital tiles** for the selected zone (`StatTile`: big value, small unit, status pill, drift chip, ⓘ with `plainDescription` + flight norm). Clicking a tile selects the metric and switches to **Trends**.
- 3D Bio-Twin details (preserved from Sprint 3):
  - **Anatomically Sculpted 3D Human Morphology (Male & Female Differentiation):**
    - Continuous parametric vertex-sculpted cranial/facial mesh, neck (sternocleidomastoid/trapezius), torso (pectoralis major plates & rectus abdominis in `male`; anatomically sculpted mammary contours, narrower ribcage, indented waist, and flared iliac/trochanteric hip curves in `female`), sculpted upper limbs (deltoids, biceps/triceps, forearms, hands with fingers), and sculpted lower limbs (quadriceps, hamstrings, femorotibial Q-angle, patella, gastrocnemius calves, ankles, and feet).
    - **Sex-Dimorphic Skeletal Layer:** Anatomical cranium & mandible, 24-segment curved vertebral column, clavicles, sternum, 10-pair curved thoracic ribcage, sex-differentiated pelvic girdle (wider subpubic angle and flared iliac wings in `female`; taller, narrower pelvis in `male`), humeri, radius/ulna, femurs, patellae, and tibia/fibula.
    - **Detailed Visceral & Vascular Layer:** Gyri-sculpted cerebral hemispheres, cerebellum, brainstem, ocular globes with irises & optic nerve sheaths (`neuro`), beating 4-chamber myocardium, aortic arch, vena cava, carotid/femoral arterial-venous tree, trachea, bronchi & multi-lobe breathing lungs (`cardio`), thymus, spleen, liver silhouette, bone marrow cores & interconnected lymphatic vessel/node network (`immune`).
  - **Interactive Controls:**
    - `OrbitControls` with auto-rotate (pauses on hover/drag), zoom, and **Camera View Presets** (`Full Body`, `Cranial / SANS`, `Thorax / Core`).
    - **Anatomy Morphology Switcher (`Female` | `Male`):** Automatically syncs with the active astronaut's `sex` and allows instant 1-click toggling on the HUD to inspect or compare female vs. male 3D anatomical models.
    - **Anatomical Layer Switcher:** Toggle or isolate body layers (`All Layers`, `Dermal / Surface`, `Skeletal / Musculoskeletal`, `Organs / Vascular`).
    - **Clickable 3D Body Parts / Zones & Floating HUD Callouts:** 5 clickable anatomical regions (`neuro`, `cardio`, `musculo`, `immune`, `behavioral`) dynamically colored by `TriageStatus` (`#22c55e`, `#eab308`, `#ef4444`) with 3D spatial callouts and bottom 5-zone status matrix.

### 2.2 Trends (`TrendsTab.tsx`, `TelemetryPanel.tsx`)
- **Metric picker row:** every metric of the selected zone as compact chips (label + value + drift arrow). Zone switcher (5 zone pills with status color).
- **Interactive Vital Reading Logger (`TelemetryPanel.tsx`):**
  - Collapsible/inline **"+ Log Vital Reading"** interactive form to record live astronaut health readings directly onto `MD-30` (latest day).
  - Zone selector (5 zones: Neuro, Cardio, Musculo, Immune, Behavioral).
  - Metric picker covering all 17 canonical metrics, including systolic blood pressure (`systolic_bp`), blood glucose (`blood_glucose`), core body temperature (`core_temp`), daily sleep duration (`daily_sleep_hours`), and behavioral mood index (`mood_index`).
  - Numeric input with instant client validation against `METRIC_INPUT_RANGES`, measurement guidance tooltip (`how`), live Green/Yellow/Red triage preview badge, and one-click presets (`Nominal`, `Caution`, `Alert`) for rapid demonstration/testing.
  - **Responsive Layout:** Separated 3-column input fields row (`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0`) and dedicated action footer (`presets · range · Record reading`) with `flex-wrap` and `min-w-0`, ensuring controls never spill into the adjacent Drift card at any viewport or column width.
  - Submitting calls `logVitalReading(zoneId, metricKey, value)` to update `MD-30` live, re-evaluate deterministic status & readiness score, update the 3D Bio-Twin colors, and trigger Flight Surgeon AI guidance synthesis.
- **Main chart (Recharts `ComposedChart`):** history line/area (14d / 30d toggle) · shaded nominal band (`ReferenceArea`) · dashed yellow limit lines · dotted **personal baseline** band (mean ± 1 SD) · dashed **forecast** line for `MD+1..+3` with shaded 90% interval · check-in and logged points drawn as larger dots. A legend with 4 swatches replaces explanatory text.
- **Drift card:** big `↑ 1.8σ` with level word (`Steady` / `Watch` / `Drifting`), one line "vs your first-week baseline (mean ± SD)". Forecast summary: `MD+3 ≈ value (lo–hi)`.
- **"Why" card:** up to 5 `MetricLink` rows: `Sleep eff ↓ → HRV ↓ · next day`, a strength bar for `|r|`, the mechanism in an ⓘ tooltip. Footer: "Association, not cause." Empty state: "No strong links yet".

### 2.3 Check-in (`CheckInTab.tsx`)
- Header: mission day stepper (`MD-<n>`, default = latest day, range `1 .. latest+1`), **streak** chip, "last logged MD-x".
- One compact row per metric, grouped by zone (zone icon + name heading): label · numeric input with unit suffix · ⓘ "how to measure" (`METRIC_INPUT_RANGES.how`) · current value placeholder. Invalid input gets a red border + `Allowed min–max unit` helper and an `aria-invalid` message. Empty fields are ignored.
- Optional note field. **Log check-in** primary button (disabled until ≥ 1 valid value).
- After submit, a result banner lists zones whose status changed (e.g. `Neuro: Green → Red`) and links to Bio-Twin. Below it, a history list of recent entries (day, # values, time) with delete.

### 2.4 Flight Surgeon (`FlightSurgeonPanel.tsx`)
Laid out in 2 columns on wide screens:
- **Left Column: Situation, Symptoms & Countermeasure Checklist:**
  - **Hazard context card:** Live/Offline status badge, situation headline, triage status pill, consult urgency, expandable "What this means" (NASA HRP mechanism & non-physician explanation), and refresh action.
  - **Crew Symptom & Clinical Q&A Card:** Free-text input (`crewSymptoms`) allowing astronauts during communication blackouts to report symptoms or ask medical questions. Features one-click rapid symptom presets (e.g., "Throbbing Headache & Blurred Vision", "Palpitations & Short of Breath", "Back Pain & Lumbar Strain", "Skin Rash & Itch"), clear submit action, and synthesizes updated Flight Surgeon guidance deterministically (offline keyword engine) or with live Clinical AI.
  - **Guided Countermeasure Checklist:** Numbered self-assessment checklist with completion checkboxes, estimated durations, expandable instructions, and hardware requirements.
- **Right Column: Visual Self-Exam & Earth Telemetry Packet:**
  - **Visual Self-Exam Card:**
    - Live optical capture: **Webcam snapshot** via `navigator.mediaDevices.getUserMedia` + `<video>` viewfinder and `<canvas>` frame capture, with clean permission/unavailable handling and stream track termination on capture/cancel.
    - File upload fallback with `capture="environment"`.
    - Reference sample presets (`Nominal Retina`, `SANS Ultrasound`, `Cabin Rash`).
    - AI vision triage result display with clinical summary, non-physician guidance, and recommended action.
  - **Earth Telemetry Packet Card:**
    - Summary tags (countermeasure count, visual exam attachment, recent check-ins).
    - **Editable Crew Notes:** Astronauts can review and edit custom clinical observations, operational notes, and symptom context before dispatching.
    - **Queue Packet Action:** Packages readiness score, zone statuses, check-ins, visual exam, and edited crew notes, calculates arrival time based on comm delay, and allows JSON inspection / export.

### 2.5 Crew (`CrewTab.tsx`)
- Grid of crew cards: callsign, name, role, sex icon, readiness (computed for that member's `defaultScenarioId`, or the active scenario for the active member), 5-dot zone status row, check-in streak, `Set active` button. Custom crew can be deleted.
- `+ Add crew member` opens the existing creator form in `CrewManagerModal.tsx`. Crew details (baselines, blood type, age, medical notes) appear in an expandable section on each card.

## 3. UI Primitives (`src/components/ui/`, `InfoTip.tsx`)
- `Card`: glass panel (`bg-slate-900/70`, `backdrop-blur`, `border-slate-800`, rounded-xl) with optional title row (icon + uppercase display label + right-side actions).
- `StatTile`: label, big value + small unit, `StatusPill`, optional drift chip, optional ⓘ, selectable state.
- `StatusPill`: color + icon + word (`Nominal` ✓, `Caution` ▲, `Alert` ●), never color alone.
- `InfoTip`: ⓘ button (`aria-label`, keyboard focusable) that shows a popover on hover/focus/click and closes on Esc. Long text lives here instead of on cards.

## 4. Visual Language & Accessibility
- Dark spacecraft HUD (`bg-slate-950`, subtle grid overlay, `cyan-400` primary accent, `#22c55e` Nominal, `#eab308` Caution, `#ef4444` Alert). Tokens are defined in `tailwind.config.js` (`hud.*`, `status.*`) and as CSS variables in `src/index.css`.
- Typography: `Orbitron` (display: brand, tab labels, card titles), `Inter` (body), monospace for numbers/units.
- WCAG 2.2 AA: text contrast ≥ 4.5:1 (≥ 3:1 for large text and UI boundaries), visible focus rings (`focus-visible:ring-cyan-400`), full keyboard operation of tabs/inputs/popovers, `prefers-reduced-motion` disables auto-rotate and other decorative motion, status is never shown by color alone.
- Copy: short, plain labels (≤ 3 words where possible). Sentence-length explanations go in `InfoTip`.
- Responsive Layout Architecture (360px–1920px widths, ≥650px window heights):
  - **Grid & Flex Child Contraction (`min-w-0`):** All CSS grid items and flex containers across tabs (`BioTwinTab`, `TrendsTab`, `CheckInTab`, `FlightSurgeonPanel`, `TelemetryPanel`) explicitly declare `min-w-0` to override the default CSS `min-width: auto`, preventing wide inputs, tables, or Recharts from expanding columns and overflowing into adjacent cards.
  - **Wrapping Card Headers:** The `Card` component header uses `flex-wrap` and `min-w-0` on both titles and right-side action trays so titles, badges, and action buttons wrap gracefully rather than pushing past card borders.
  - **Responsive 3D Bio-Twin Stage:** Central 3D canvas viewport (`BioTwinMap.tsx`) scales smoothly (`min-h-[320px]` on small screens up to `min-h-[520px]` on desktop), remaining fully operational and preventing vertical viewport blowouts on windows as short as 650px. Camera view presets, layer switcher, and bottom 5-zone matrix buttons wrap and scale cleanly down to 360px mobile viewports.
  - **Screen-Constrained Popovers:** `TopMissionBar` popovers (Readiness Milestone Badges and Clinical AI key) use viewport-safe positioning (`fixed inset-x-3 top-16` on mobile `< sm`, `absolute right-0` with `max-w-[calc(100vw-1.5rem)]` on desktop) with keyboard Esc dismiss to eliminate horizontal scroll and viewport spillover.
  - Tabs scroll horizontally on narrow screens with no page-level horizontal overflow. The Bio-Twin grid stacks on `< lg`, and Trends / Check-in grids stack on `< xl`.

## 5. ARGUS Companion (AI chat) (`src/components/CompanionDrawer.tsx`, `src/utils/companionBrain.ts`)
Port of the ARGOS prototype's chat companion (`jv()`, `send()`, `brain()`, `speak()`, `mic()` in `ARGOS_The_Thousand_Eyes.html`). Fully implemented (issue #7).
- **Entry point:** `ARGUS Companion` button in the top mission bar (`TopMissionBar.tsx`) opens a right slide-over drawer, accessible across all tabs with keyboard shortcut and Esc dismiss.
- **Offline brain first:** a deterministic intent engine in `src/utils/companionBrain.ts` (`red_flag`, `status`, `metric`, `symptom`, `forecast`, `why`, `radiation`, `help`) answers from triage, drift, forecast, links, and check-ins with 0 network calls.
- **Live Clinical AI second:** when the backend / provider is available, replies stream via `streamCrewChat` with a structured snapshot context, seamlessly falling back to the offline brain on network error or timeout.
- **Voice I/O:** optional text-to-speech replies via `window.speechSynthesis` (British voice heuristic) and dictation via browser Web Speech API (`SpeechRecognition`).
- **Red flags:** critical phrases (chest pain, shortness of breath, faint, self-harm/crisis in English and Hebrew) trigger an immediate urgent fixed protocol pointing to the Flight Surgeon / Earth emergency packet, vital checks, and crewmate notification.
- **Guardrails:** never sets or overrides a triage status, never lowers urgency, invents no numbers, uses plain language, and conversation history is persisted per crew member in `localStorage`.
