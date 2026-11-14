# Spec 02: ARGUS Mission Control Bio-Twin Dashboard UI

> Sprint 7 replaced the fixed 3-column single screen with a tabbed HUD. HUD v2 (§6) adds per-astronaut sign-in, a left tab rail, mission location + clock, Forecast, Eyes, ARGUS AI and Emergency tabs, and removes the Check-in tab. Ideas are ported from the ARGOS prototype (`ARGOS_The_Thousand_Eyes.html`). Design guidance: `.agents/skills/frontend-design`, `design-system`, `ux-copy`, `accessibility-review`.

## 1. Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ Top bar: brand · location ▾ · comm delay · clock · readiness · user ▾ │
│ Crew strip (admin only): pills · + Add crew                            │
├──────────────┬────────────────────────────────────────────────────────┤
│ Tab rail     │                                                        │
│ Bio-Twin     │            Active tab content                          │
│ Trends       │                                                        │
│ Forecast     │                                                        │
│ Eyes         │                                                        │
│ ARGUS AI     │                                                        │
│ Emergency    │                                                        │
│ Crew · Users │  (admin only)                                          │
└──────────────┴────────────────────────────────────────────────────────┘
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
- **Scheduled Mission Routine Banner (`ScheduledRoutineBanner.tsx`, PR #22):** shown above tab content for users who can see health data.
  - Shows the sol indicator, routine status, streak and the readiness milestone shelf (`REQ-08`, `REQ-09`).
  - With the database connected, "quick log" only marks the routine as done; it never writes generated readings.
  - Data itself arrives from the watch and dosimeter (spec 05 §4).
- **Tab rail (`TabBar.tsx`):** vertical `role="tablist"` (`aria-orientation="vertical"`) on the left from `md` up; a horizontal scroll bar on phones. Each tab: icon + short label + optional badge (red count on Bio-Twin when any zone is red). Up/Down (Left/Right on phones), Home/End move focus and selection. Admin-only tabs are hidden for crew users. The active tab persists in `localStorage` (`argus_active_tab_v1`; unknown stored ids fall back to `biotwin`). Type: `HudTabId = 'biotwin' | 'trends' | 'forecast' | 'eyes' | 'ai' | 'emergency' | 'crew' | 'users'`.

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
    - **Peel layers** (`src/features/organs/organs.ts`, `PEEL_LEVELS`): `Body` (skin + muscles) → `Organs` (skin removed) → `Deep organs` (heart, lungs, liver and ribs removed) → `Skeleton` (bones only). Each step removes the outer layer. Only the organs of the current level take pointer events; other meshes are not raycast, so they never block a click on an organ behind them.
    - **Clickable organs** (`OrganTwinModel.tsx`): brain, eyes, heart, lungs, liver, spleen, kidneys, muscles (skin envelope, `Body` level) and bones (`Skeleton` level), each its own click target and coloured by its own status. Thymus, lymph nodes and vessels are shown but not targets. Kidneys are modelled posterior to the liver/spleen.
    - **Organ status:** worst Thousand Eyes status among the organ's indicators (`ORGANS` in `organs.ts`: heart = rhr, hrv, sbp, dbp; lungs = spo2, resp; brain = mood, stress, energy, cohes, priv, motiv, sleep, slq, diz; eyes = vis; liver = crp, wt, kcal; spleen = temp, sym; kidneys = urine, fluid; muscles = grip, resist, aero; bones = back, height). No indicator with data → grey.
    - **Markers:** a DOM button on every visible organ (outside the breathing animation so it holds still). Red flag → red ring with `!` (pulses unless reduced motion); drifting → amber ring with `!`; on baseline → small green dot; no data → grey dot. `aria-label` = organ + status.
    - **Organ details** (`OrganPanel.tsx`): click/tap a marker or the organ opens a card (bottom sheet on mobile) listing the organ's indicators, problems first: value + unit, status word + symbol, personal baseline, expected shift at the current location, and a tip when off baseline; "No data yet" + how to measure otherwise. Closes with Esc, ✕ or a click on empty space. Selecting an organ also selects its HUD zone (`neuro` / `cardio` / `immune` / `musculo`) so the side tiles follow.

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

### 2.3 Forecast (`ForecastTab.tsx`)
Readable 3-day outlook built only from deterministic models (`forecastMetric`, `computeDrift`, `calculateCrewReadinessScore`):
- **Readiness outlook:** today, +1, +2, +3 days as big numbers with status color (readiness recomputed from each metric's forecast mean).
- **What changes:** one row per metric, sorted worst-first: `Heart rate 76 → 82 bpm in 3 days`, status chips today → day 3 (`Caution → Alert`), a plain range sentence (`likely 79–85`), and a direction word (`Getting worse` / `Steady` / `Improving` relative to the nominal band). Filters: `Changing` (default) / `All`.
- Footer: "Projection from the last 10 days. Not a diagnosis."

### 2.4 ARGUS AI (`AiTab.tsx`) — all Flight Surgeon tools live here
- Header: provider badge from `GET /api/health` (`Local · qwen3.6`, `OpenRouter free`, or `Offline`).
- Sub-sections (segmented control): **Chat** (default; streaming companion via `POST /api/ai/chat`, history kept per crew member), **Flight Surgeon** (the former Flight Surgeon tab: situation + steps, visual self-exam, Earth packet — `FlightSurgeonPanel.tsx`), **Diagnostics** (`POST /api/ai/diagnostics`: ranked hypotheses with supporting metrics), **Plan** (`POST /api/ai/recommendations`), **Wellbeing** (1–5 mood check-in → `POST /api/ai/wellbeing`).
- Every AI result shows its source (`live_ai` / offline) and the disclaimer. The AI never sets a triage status.
- **Crew Symptom & Clinical Q&A (PR #27)** lives in the Flight Surgeon section (`FlightSurgeonPanel.tsx`):
  - Free-text symptoms with one-click presets, answered by the AI or the offline `symptomFallback.ts`.
  - Live webcam capture for the visual self-exam.

### 2.4b Eyes (`EyesTab.tsx`)
A readable version of the prototype's "Thousand Eyes" ring plus the full data/configuration view:
- **Ring (`src/features/thousandEyes/`):** port of the prototype's "Thousand Eyes" (`ARGOS_The_Thousand_Eyes.html`). One eye per indicator from the prototype's 31-row table (`indicators.ts`), ordered by body system (Cardio → Habitat). Each indicator is compared only with the person's own pre-flight baseline, after subtracting the shift expected at their location (microgravity vs. Moon/Mars, `locationShift.ts`). Eye colour = status (grey no data, green on baseline, orange drifting, red flag); the pupil grows with severity and pulses (disabled with `prefers-reduced-motion`). Violet curves = links found in the person's data (|r| ≥ 0.6, n ≥ 7, same day or next day). Centre: personal readiness 0–100 and deviation index in σ.
  - The ring shows no values. Click / tap / Enter / Space on an eye opens a details box (popover on desktop, bottom sheet under 640 px): name and body system, value + unit, status word + symbol, personal baseline with the expected shift at the current location, and a one-line tip when not on baseline. Closes with Esc, click outside or ✕. Eyes are keyboard-focusable with an `aria-label`; status is never colour-only.
  - Data: real HUD data only, no demo values. A HUD metric feeds the ring when its `metricId` is an indicator key or is mapped in `adapter.ts` (`resting_hr`→`rhr`, `hrv_rmssd`→`hrv`, `spo2`→`spo2`). Indicators without readings stay grey.
- **Data table:** zone, metric, value + unit, status, personal baseline (mean ± SD), drift σ, nominal range, caution range, +3 day forecast.
- **Configuration:** signed-in user + role, crew profile (baselines, notes), mission location (gravity, comm delay), scenario, threshold environment, AI provider chain.

### 2.4c Emergency (`EmergencyTab.tsx`)
- Banner: comm delay for the current location ("Act first, report as you act").
- Protocol cards (`EMERGENCY_PROTOCOLS`): fire/smoke, rapid depressurisation, toxic atmosphere, crew medical emergency, solar particle event, high CO₂. Each step is a checkbox; starting a protocol records start time and step completion times.
- `Notify Earth` queues an `immediate_emergency_packet` Earth packet with the protocol log.
- A red **SOS** shortcut at the bottom of the tab rail opens this tab from anywhere.
- Footer: "Generic training aid based on public ISS practice — follow your mission's flight rules."

### 2.5 Crew (`CrewTab.tsx`) — admin only
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
  - **Grid & Flex Child Contraction (`min-w-0`):** All CSS grid items and flex containers across tabs (`BioTwinTab`, `TrendsTab`, `FlightSurgeonPanel`, `TelemetryPanel`) explicitly declare `min-w-0` to override the default CSS `min-width: auto`, preventing wide inputs, tables, or Recharts from expanding columns and overflowing into adjacent cards.
  - **Wrapping Card Headers:** The `Card` component header uses `flex-wrap` and `min-w-0` on both titles and right-side action trays so titles, badges, and action buttons wrap gracefully rather than pushing past card borders.
  - **Responsive 3D Bio-Twin Stage:** Central 3D canvas viewport (`BioTwinMap.tsx`) scales smoothly (`min-h-[320px]` on small screens up to `min-h-[520px]` on desktop), remaining fully operational and preventing vertical viewport blowouts on windows as short as 650px. Camera view presets, layer switcher, and bottom 5-zone matrix buttons wrap and scale cleanly down to 360px mobile viewports.
  - **Screen-Constrained Popovers:** `TopMissionBar` popovers (Readiness Milestone Badges and Clinical AI key) use viewport-safe positioning (`fixed inset-x-3 top-16` on mobile `< sm`, `absolute right-0` with `max-w-[calc(100vw-1.5rem)]` on desktop) with keyboard Esc dismiss to eliminate horizontal scroll and viewport spillover.
  - The tab rail becomes a horizontal scroll bar below `md`; no page-level horizontal overflow. The Bio-Twin grid stacks on `< lg`, and Trends / Check-in grids stack on `< xl`.

## 5. ARGUS Companion (AI chat) (`src/components/CompanionDrawer.tsx`, `src/utils/companionBrain.ts`)
Port of the ARGOS prototype's chat companion (`jv()`, `send()`, `brain()`, `speak()`, `mic()` in `ARGOS_The_Thousand_Eyes.html`). Implemented in the ARGUS AI tab (§2.4) and as a global drawer (issue #7):
- **Entry point:** `ARGUS Companion` button in the top mission bar (`TopMissionBar.tsx`) opens a right slide-over drawer, accessible across all tabs with keyboard shortcut and Esc dismiss.
- **Offline brain first:** a deterministic intent engine in `src/utils/companionBrain.ts` (`red_flag`, `status`, `metric`, `symptom`, `forecast`, `why`, `radiation`, `help`) answers from triage, drift, forecast, links, and check-ins with 0 network calls.
- **Live Clinical AI second:** when the backend / provider is available, replies stream via `streamCrewChat` (`POST /api/ai/chat`, `specs/04-ai-backend.md`) with a structured snapshot context, seamlessly falling back to the offline brain on network error or timeout.
- **Voice I/O:** optional text-to-speech replies via `window.speechSynthesis` (British voice heuristic) and dictation via browser Web Speech API (`SpeechRecognition`).
- **Red flags:** critical phrases (chest pain, shortness of breath, faint, self-harm/crisis in English and Hebrew) trigger an immediate urgent fixed protocol pointing to the Flight Surgeon / Earth emergency packet, vital checks, and crewmate notification.
- **Guardrails:** never sets or overrides a triage status, never lowers urgency, invents no numbers, uses plain language, and conversation history is persisted per crew member in `localStorage`.

## 6. HUD v2: Sign-in, Location & Clock
- **Sign-in (`AuthGate.tsx`, `AuthContext.tsx`):** first run shows **Create admin account** (username + password ×2). Afterwards a **Sign in** screen (username + password). Session lasts until sign-out or the tab closes (`sessionStorage`).
- **Roles:** `admin` sees every crew member (crew strip, Crew tab, Users tab) and manages accounts. `crew` users are linked to one `CrewMemberProfile` and only see that astronaut: no crew strip, no Crew/Users tabs, their own chat, check-ins and location.
- **Users tab (`UsersTab.tsx`, admin only):** list accounts; create a crew or admin account (username, password, linked crew member); reset a password; delete an account (never the last admin or yourself).
- **Mission location (`SpaceLocationId`, §8 of spec 01):** selector in the top bar, stored per crew member. Drives the comm-delay badge, gravity label, the clock's local-time line and the AI context. Thresholds stay on the `0g_transit` table until location-aware thresholds are specified.
- **Clock (`MissionClock.tsx`):** live date + local time, UTC, and a location line: `Mars sol N · MTC hh:mm` (Mars locations), `Lunar day x / 29.5` (Moon, Gateway), `Orbit mm / 92 min · day/night side` (LEO), plus `Mission day N`.
- **Security note:** accounts live in the browser (`localStorage`, PBKDF2-hashed passwords). This separates astronauts' views on a shared device; it is not server-side security.
