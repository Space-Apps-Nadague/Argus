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
  - Dynamic **Signal Comm Delay to Earth** badge (live light time, e.g. `0.000 s to Earth`, `240 ms to Earth`, `1.35 s to Earth`, `10m 58s to Earth`).
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
- **Manual Vital Check-in Trigger (`+ Log Vital`):** Button in the selected-zone card header opens `VitalLoggerModal.tsx` pre-focused on the active zone (and selected metric), submitting via `MissionContext.logVitalReading` (persisted to PostgreSQL in database mode or `localStorage` in offline demo mode).
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
    - **Organ details** (`OrganPanel.tsx`): click/tap a marker or the organ opens a card (bottom sheet on mobile) listing the organ's indicators, problems first: value + unit, status word + symbol, personal baseline, expected shift at the current location, and a tip when off baseline; "No data yet" + how to measure otherwise. Closes with Esc, ✕ or a click on empty space. Selecting an organ also selects its HUD zone (`neuro` / `cardio` / `musculo` / `metabolic` / `immune`) so the side tiles follow (`liver` maps to `metabolic`, with an abdominal pancreatic/hepatic metabolic mesh).

### 2.2 Trends (`TrendsTab.tsx`, `TelemetryPanel.tsx`)
- **Metric picker row:** every metric of the selected zone as compact chips (label + value + drift arrow). Zone switcher (6 zone pills with status color).
- **Interactive Vital Reading Logger (`VitalLoggerModal.tsx`, accessible from `+ Log Vital` in `BioTwinTab.tsx` and `TelemetryPanel.tsx` / `TrendsTab.tsx`):**
  - Compact accessible modal dialog (`role="dialog"`, `aria-modal="true"`, Esc to close, focus return) to record live astronaut health readings directly onto `MD-30` (latest day).
  - Zone selector (6 zones: Neuro, Cardio, Musculo, Metabolic, Immune, Behavioral) + quick core-vital shortcuts (`systolic_bp`, `blood_glucose`, `core_temp`, `daily_sleep_hours`, `mood_index`).
  - Metric picker covering all 17 canonical metrics, including systolic blood pressure (`systolic_bp`), blood glucose (`blood_glucose`, mg/dL), core body temperature (`core_temp`), daily sleep duration (`daily_sleep_hours`), and behavioral mood index (`mood_index`).
  - Numeric input with instant client validation against `METRIC_INPUT_RANGES`, measurement guidance (`how`), live deterministic Green/Yellow/Red triage preview (`evaluateMetricStatus` + `StatusPill` with icon & label), and one-click presets (`Nominal`, `Caution`, `Alert`) for rapid demonstration/testing.
  - Submitting calls `logVitalReading(zoneId, metricKey, value)` to persist the reading (database via `dataApi.checkIn` + `refreshServerZones` when server-backed, or `localStorage` in offline demo mode), re-evaluate deterministic status & readiness score, update the 3D Bio-Twin colors, and trigger Flight Surgeon AI guidance synthesis.
- **Main chart (Recharts `ComposedChart`):** history line/area (14d / 30d toggle) · shaded nominal band (`ReferenceArea`) · dashed yellow limit lines · dotted **personal baseline** band (mean ± 1 SD) · dashed **forecast** line for `MD+1..+3` with shaded 90% interval · check-in and logged points drawn as larger dots. A legend with 4 swatches replaces explanatory text.
- **Drift card:** big `↑ 1.8σ` with level word (`Steady` / `Watch` / `Drifting`), one line "vs your first-week baseline (mean ± SD)". Forecast summary: `MD+3 ≈ value (lo–hi)`.
- **"Why" card:** up to 5 `MetricLink` rows: `Sleep eff ↓ → HRV ↓ · next day`, a strength bar for `|r|`, the mechanism in an ⓘ tooltip. Footer: "Association, not cause." Empty state: "No strong links yet".
- **CGM 24h Curve & Time-in-Range (`CgmPanel.tsx`, shown when `blood_glucose` is selected):** displays the active crew member's 5-minute interstitial glucose stream (`getCrewCgmMockData`), latest glucose + trend arrow (`double_up`..`double_down`), Time-in-Range (70–140 mg/dL %), Mean, CV%, Low/High %, and a 24h Recharts `AreaChart` with the 70–140 mg/dL target band shaded.

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
- **Real-Time Voice & Video AI Flight Surgeon (`FlightSurgeonPanel.tsx`, `src/services/realtimeDoctor.ts`):**
  - Hands-free and push-to-talk clinical voice/video interface supporting two transport modes (`specs/04-ai-backend.md` §4.1–§4.2):
    1. **Online Mode (`live-api`):** Connects directly to the Gemini Live API WebSocket via a server-minted ephemeral token (`POST /api/ai/live-token`) with bidirectional PCM audio, optional live webcam frame streaming (`image/jpeg`) for visual exams (SANS ocular checks, dermal lesions), **barge-in** interruption, and non-blocking tool execution (`get_crew_snapshot`, `log_checkin_reading`, `lookup_medical_protocol`).
    2. **Offline / Deep-Space Blackout Mode (`on-ship-pipeline`):** Presents as **"On-Ship Local Flight Surgeon (Autonomous Mode)"** with an `on-ship-local` badge (no cloud/Gemini branding) and a visible 3-stage pipeline progress bar (`Listening [STT]` → `Thinking [Local LLM]` → `Speaking [TTS]`). Retrieves verified clinical-unit chunks via hybrid RAG (`server/rag/`) before generating the spoken response. Uses Gemini behind the scenes when internet is reachable, or local Ollama / browser Web Speech fallback when truly disconnected.
  - **Voice vs. UI Protocol Citation Cards (`citedProtocols` / `ragHits`):** While the voice AI speaks a concise 2–3 step plain-language summary, `FlightSurgeonPanel.tsx` simultaneously renders a **Verified Protocol Citations** panel displaying the retrieved clinical-unit cards (`title`, `heading`, `SRC-xxx` source badge, document kind badge, and expandable full checklist/procedure text).
  - **Connectivity Auto-Detect + Simulated Comm Blackout Toggle:** Automatically probes `navigator.onLine` and `/api/health` + `/api/ai/live-token`, and exposes a manual **Simulated Comm Blackout / Offline Mode** switch (`role="switch"`) so judges and crew can compare `live-api` vs `on-ship-pipeline` on demand.
  - **Clinical Framing & Guardrails:** Displays *"Decision support, not a medical diagnosis"* on the voice HUD. Deterministic triage (`triageEngine.ts`) and crisis escalation (`wellbeingModel.ts`) are never overridden or lowered by the voice model.

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

### 2.6 Training (`TrainingTab.tsx`, `src/features/training/`)
- **Two exercise sets, by location (`exercises.ts`):** without gravity body weight loads nothing, so:
  - **Microgravity** (ISS, Mars transit): the ISS countermeasure devices: **ARED** squat, deadlift and heel raise (vacuum cylinders give up to 272 kg of load), **treadmill with a bungee harness** (70–80 % of body weight pulls the runner onto the belt) and the **cycle ergometer** (no seat; feet clipped in, hands on the bar).
  - **Gravity** (Moon, Mars, Earth): squats, push-ups, reverse lunges, forearm plank, crunches. On the Moon and Mars the tab says to wear the weighted vest (1/6 g, 3/8 g).
- **When training is needed (`recommend.ts`):** deterministic rules on the latest readings with the same gravity-specific thresholds as triage.
  - `bmd_delta` below its nominal range → bone loading (micro: ARED squat, deadlift, heel raise, treadmill; gravity: squats, lunges, push-ups).
  - `ared_load` below its nominal range → resistance (micro: ARED squat, deadlift, heel raise; gravity: squats, push-ups, plank).
  - Musculoskeletal zone not green → spine-protecting work (micro: ARED deadlift, squat; gravity: plank, crunches, squats).
  - Microgravity only: `resting_hr` above or `hrv_rmssd` below range → aerobic (cycle ergometer, treadmill).
  - **Safety first:** with a cardiovascular alert, body temperature ≥ 38 °C or SpO₂ < 93 % the tab says **Do not exercise now** and recommends nothing.
- **Banner:** *Training required today* (amber, with the reasons), *No extra training needed* (green), or *Do not exercise now* (red), plus one line explaining the exercise set for the location. The tab rail shows an amber or red **!** badge for the first and last.
- **Each exercise:** dose, what it works, device, why it matters in spaceflight, numbered steps, common mistakes and a tip. Recommended ones are listed first with a **Today** chip.
- **3-D astronaut (`ExerciseFigure3D.tsx`, three.js):** a white-suited astronaut with helmet, gold visor and life-support pack performs every exercise in a loop, with its equipment (ARED platform, bar and load cables; treadmill belt and harness bungees; ergometer crank, pedals and handlebar). `mannequin.ts` keeps feet, toes, back or hands on the floor and solves elbows (push-up) and knees (pedalling) with 2-link IK. Drag to turn, scroll to zoom, pause; reduced motion starts paused.

### 2.7 Photobooth (`PhotoboothTab.tsx`, `src/features/photobooth/`)
A fun camera booth so the crew can send photos home. Camera frames are processed on the device only (MediaPipe Tasks, Apache-2.0, gesture recogniser only; the 8 MB gesture model is downloaded to `public/models/vision` and the WASM copied to `public/vision/wasm` by `scripts/copy-vision-assets.mjs` before `dev`/`build` (online fallback if the download is missing); loaded only when the tab opens).
- **Hands-free shutter (`gesture.ts`):** show a **peace sign ✌️** (MediaPipe `Victory`, score ≥ 0.5, checked every 2nd frame, misses under 180 ms ignored) for 0.25 s → a big **3-2-1** countdown → the photo is taken (shutter sound and flash). A *Peace sign seen* badge shows when the hand is recognised. The countdown keeps going if the hand drops; the next photo needs the sign to drop first. The **Take photo (3 s)** button starts the same timer.
- **Modes:** **Single photo** or **4-photo strip** (classic photobooth: 4 photos, 2 s countdown between them with *Photo n of 4*, stacked on a cream card with the "Greetings from …" caption, callsign, mission day and message; frames are hidden in strip mode).
- **Effects (`effects.ts`, all drawn on a canvas, no image files):**
  - No fake backgrounds: the photo keeps the real camera view.
  - Overlays & stickers: a **mission-camera data stamp** (viewfinder corners and a monospace block: callsign, UTC date and time, mission day and sol, location and light time to Earth; on by default), an ARGUS mission patch with the callsign, zero-g floaties (stars, water bubbles, a planet, a bolt) and a "Hi from Mars!" banner.
  - **Greetings from:** the place follows the top-bar mission location (Mars → "Greetings from Mars!", ISS → orbit) and can be changed in a select (Earth, orbit, lunar orbit, the Moon, deep space, Mars).
  - Colour filters: Mars red, Lunar grey, Night vision (green, scan lines), Retro film (vignette).
  - Frames: Postcard ("Greetings from Mars!", callsign, mission day, sol on Mars, date, message, stamp) and Polaroid (handwritten-style message).
- **Photo strip:** each photo lands in a strip under the camera and the camera keeps running, so the crew can keep shooting (last 8 per session). Each photo has **Send**, **Download** and **Delete**, and opens larger on click (Esc or click to close). The Send box lists family members and can add a new one on the spot.
- **Family mail (`familyMail.ts`):** the photo (JPEG, 800 px) goes into an Earth downlink queue and shows *On its way · arrives in 10m 58s*, using the live one-way light time (`commDelayAt`), then *Delivered*. Family contacts (name, relation, optional email) are kept per astronaut. With the ARGUS server, contacts with an email get the photo by real email at the moment it "arrives" (`POST /api/family/mail`, specs/05 §6); the photo shows *Emailed to …* or the error; without the server (offline demo) nothing is emailed: **Send** shows the light-time countdown under the photo and then *Delivered*, labelled *Demo: delivery simulated*; the last 12 postcards per astronaut are kept on this device. Download is always available.

### 2.8 Cognition (`CognitionTab.tsx`, `src/features/cognition/`)
- **Today's game** card: the game of the day (§12.2 of spec 01), Play button, or today's points when done. Below it a **rotation track** of 9 boxes for the current cycle: past days show the game with ✓ (played) or – (missed), today is highlighted, upcoming days show ? (the order stays a surprise). After a game: points, *Personal best* badge, status pill (or *Calibrating n/3*), primary metric.
- **Game frame** (`GameShell.tsx`): intro (one-line how-to) → 3-2-1 countdown → play with live points, combo and progress bar. Keyboard alternatives for every game; sounds can be muted.
- **Crew leaderboard** (7 days) with streaks; **Your recent games** table with status per session.
- **Alert** (`CognitionAlert.tsx`, `role="alertdialog"`): yellow (caution) or red (alert) header, then *1 Assess the urgency · 2 Follow the instructions (checklist) · 3 Stay informed (Earth packet ID and comm delay, or "within CMO scope") · 4 Be prepared (retest, open medical protocol)*.
- Stimulus colors use the categorical `game-1…6` tokens, never status colors. Animations respect `prefers-reduced-motion`.

### 2.5 Crew (`CrewTab.tsx`) — admin only
- Grid of crew cards: callsign, name, role, sex icon, readiness (computed for that member's `defaultScenarioId`, or the active scenario for the active member), 6-dot zone status row, check-in streak, `Set active` button. Custom crew can be deleted.
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
  - **Responsive 3D Bio-Twin Stage:** Central 3D canvas viewport (`BioTwinMap.tsx`) scales smoothly (`min-h-[320px]` on small screens up to `min-h-[520px]` on desktop), remaining fully operational and preventing vertical viewport blowouts on windows as short as 650px. Camera view presets, layer switcher, and bottom 6-zone matrix buttons (`grid-cols-3 sm:grid-cols-6`) wrap and scale cleanly down to 360px mobile viewports.
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
- **Face ID (`src/features/faceId/`):** a second way to sign in, like Face ID on an iPhone. The signed-in user sets it up from the face icon in the top bar: the camera captures 5 clear frames and stores their average 128-number face template (`@vladmandic/face-api`, TensorFlow.js) on **this device only**; no image or template is sent to the server. The sign-in screen then shows **Sign in with Face ID**: the same face must match in 2 frames (distance < 0.45), **then blink or turn the head slightly** (liveness), within 25 s, so a printed photo is not enough. The liveness step reads face landmarks only (≈3× faster than recognition) so a quick blink is not missed; a blink counts when the eye-aspect ratio drops below 75 % of the person's own open-eye value and recovers, and a head turn when the nose moves ≥ 22 % of the eye distance sideways. Password sign-in always stays available. Models (~7 MB) are copied to `public/models/face` by `scripts/copy-face-models.mjs` before `dev`/`build` and load only when Face ID is used. Server mode: see specs/05 §6 (device token).
- **Roles:** `admin` sees every crew member (crew strip, Crew tab, Users tab) and manages accounts. `crew` users are linked to one `CrewMemberProfile` and only see that astronaut: no crew strip, no Crew/Users tabs, their own chat, check-ins and location.
- **Users tab (`UsersTab.tsx`, admin only):** list accounts; create a crew or admin account (username, password, linked crew member); reset a password; delete an account (never the last admin or yourself).
- **Mission location (`SpaceLocationId`, §8 of spec 01):** selector in the top bar, stored per crew member. Drives the comm-delay badge, gravity label, the clock's local-time line and the AI context. Thresholds stay on the `0g_transit` table until location-aware thresholds are specified.
- **Comm delay (`commDelayAt` / `formatCommDelay`, `src/data/lightTime.ts`):** a single live one-way light time, not a range. Mars surface/rover: Earth–Mars distance today (JPL approximate planetary elements) / c, e.g. `10m 58s`. Moon and Gateway: Earth–Moon distance (Meeus ch. 47) / c, e.g. `1.35 s`. LEO: geostationary relay path ≈ `240 ms`. Mars transit: `up to` the current Earth–Mars value, because the craft's position on the trajectory is not tracked. Earth: `0.000 s`. Relay/processing time is not included.
- **Clock (`MissionClock.tsx`, `src/data/dualClock.ts`):** two clocks. **Earth** is always Houston (NASA JSC, `America/Chicago`, with CST/CDT). Away from Earth, the **mission area's own time** is shown above it: Mars (`MTC hh:mm` + sol) on Mars surface and rover; Moon (`Day x / 29.5` of the lunar cycle) on the Moon and Gateway; Station (`GMT`, as on the ISS, + orbit minute and day/night side) in LEO; Ship (`UTC`) in Mars transit. On Earth (before/after mission) only the Earth clock is shown. Plus `Mission day N`.
- **Security note:** accounts live in the browser (`localStorage`, PBKDF2-hashed passwords). This separates astronauts' views on a shared device; it is not server-side security.
