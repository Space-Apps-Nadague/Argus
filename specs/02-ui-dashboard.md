# Spec 02: ARGUS Mission Control Bio-Twin Dashboard UI

> Sprint 7 replaced the fixed 3-column single screen with a tabbed HUD. HUD v2 (§6) adds per-astronaut sign-in, a left tab rail, mission location + clock, Forecast, Eyes and ARGUS AI tabs (the Emergency tab was removed later), and removes the Check-in tab. Ideas are ported from the ARGOS prototype (`ARGOS_The_Thousand_Eyes.html`). Design guidance: `.agents/skills/frontend-design`, `design-system`, `ux-copy`, `accessibility-review`.

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
  - **Simulate Medical Event** dropdown (`nominal`, `unexplained_fatigue`, `sans_alert`, `high_co2`, `solar_storm`).
  - Optional Clinical AI key button (icon only + tooltip).
  - **Crew Roster Strip:** selectable pills (callsign, name, live readiness dot) + `+ Add crew` (opens `CrewManagerModal.tsx` in create mode).
- **Scheduled Mission Routine Banner (`ScheduledRoutineBanner.tsx`, PR #22):** shown above tab content for users who can see health data.
  - Shows the sol indicator, routine status, streak and the readiness milestone shelf (`REQ-08`, `REQ-09`).
  - With the database connected, "quick log" only marks the routine as done; it never writes generated readings.
  - Data itself arrives from the watch and dosimeter (spec 05 §4).
- **Tab rail (`TabBar.tsx`):** vertical `role="tablist"` (`aria-orientation="vertical"`) on the left from `md` up; a horizontal scroll bar on phones. Each tab: icon + short label + optional badge (red count on Bio-Twin when any zone is red). Up/Down (Left/Right on phones), Home/End move focus and selection. Admin-only tabs are hidden for crew users. The active tab persists in `localStorage` (`argus_active_tab_v1`; unknown stored ids fall back to `biotwin`). Type: `HudTabId = 'biotwin' | 'trends' | 'forecast' | 'eyes' | 'ai' | 'cognition' | 'crew' | 'users' | …`.

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

### 2.4 ARGUS console (`console/ConsoleTab.tsx`, state in `context/AssistantContext.tsx`)
The one place to talk to ARGUS, the crew's onboard doctor and therapist. It replaces the ARGUS AI tab (chat + flight surgeon), the Companion drawer and the Emergency tab. State lives above the tabs, so a tab switch loses nothing; the thread, open protocol and cards are saved per crew member (server thread restored on a new device).
- **Header:** tier badge (Earth live / Earth relay / On-ship, live one-way delay, InfoTip with the stack in use and any fallback reason), comm override (auto, or further from Earth, e.g. "Blackout: on-ship only"), **Voice** popover (Earth voice, on-ship voice, browser voice: pick + play preview, speed, speak replies), section switch: Talk · Diagnostics · Plan · Check-in (· Earth inbox for flight surgeons).
- **Talk, left:** one conversation thread. Bubbles for crew, ARGUS (source: Earth AI / On-ship AI / onboard protocols) and Earth doctor replies (violet); action chips under the ARGUS message that did them; crisis replies outlined red. Composer: text (Enter sends), **Talk to ARGUS** (hands-free conversation: live session at Earth/LEO, voice detection + STT elsewhere; talking over ARGUS stops it), **Voice message** (press to record, press to send), mute, stop, status (Listening / Transcribing / Thinking / Speaking), mic level, time to first word and first audio.
- **Talk, right rail:** Emergency protocols (collapsed picker; a running protocol becomes a red checklist with step times, "say done", Close & report); **What ARGUS sees** (self-view, consent prompt, camera-on indicator, overlay chips: facial emotion with %, tired, slumped, restless, ~pulse; expression mix bar; close-up requests from ARGUS with Send close-up); steps ARGUS laid out; **Try this now** countermeasure cards with Did it help? Yes / No; **How you're doing** (mood, stress, fatigue, concern level, trend sparkline, what ARGUS noticed); **Doctors on Earth** (reports with urgency, kind and in-transit / delivered / read / replied state, round trip, Report to Earth with a note).
- **Verified protocol citations:** when ARGUS uses the knowledge base (spec 04 §4.5), the ARGUS message shows "Sources" chips (title, `SRC-xxx`, kind); each expands to the full checklist or procedure text, so a spoken 2–3 step summary is always backed by the full protocol on screen.
- No SOS shortcut in the tab rail (removed in PR #66); red flags in conversation and life-threat alarms (§7) start the protocol automatically.

### 2.4b Eyes (`EyesTab.tsx`)
A readable version of the prototype's "Thousand Eyes" ring plus the full data/configuration view:
- **Ring (`src/features/thousandEyes/`):** port of the prototype's "Thousand Eyes" (`ARGOS_The_Thousand_Eyes.html`). One eye per indicator from the prototype's 31-row table (`indicators.ts`), ordered by body system (Cardio → Habitat). Each indicator is compared only with the person's own pre-flight baseline, after subtracting the shift expected at their location (microgravity vs. Moon/Mars, `locationShift.ts`). Eye colour = status (grey no data, green on baseline, orange drifting, red flag); the pupil grows with severity and pulses (disabled with `prefers-reduced-motion`). Violet curves = links found in the person's data (|r| ≥ 0.6, n ≥ 7, same day or next day). Centre: personal readiness 0–100 and deviation index in σ.
  - The ring shows no values. Click / tap / Enter / Space on an eye opens a details box (popover on desktop, bottom sheet under 640 px): name and body system, value + unit, status word + symbol, personal baseline with the expected shift at the current location, and a one-line tip when not on baseline. Closes with Esc, click outside or ✕. Eyes are keyboard-focusable with an `aria-label`; status is never colour-only.
  - Data: real HUD data only, no demo values. A HUD metric feeds the ring when its `metricId` is an indicator key or is mapped in `adapter.ts` (`resting_hr`→`rhr`, `hrv_rmssd`→`hrv`, `spo2`→`spo2`). Indicators without readings stay grey.
  - **Sensor ring (inner ring, `SENSOR_INDICATORS` in `indicators.ts`):** 26 indicators from new wearable sensors, smaller eyes inside the main ring, same body-system colours and order. Each carries `sensor`: sample (interstitial fluid, sweat, skin, skin headspace, breath, ultrasound, ECG electrodes, optical), device family, cadence, readiness (`flight-proven` | `cleared` | `research`) and `SRC-xxx` sources; the details box shows them plus a caveat. Research-grade eyes have a dashed outline.
    - Biochemistry (microneedles, electronic skin, sweat patches): `glu` glucose [SRC-028, SRC-110, SRC-111], `lac` lactate [SRC-110, SRC-111], `na` sodium, `k` potassium [SRC-110], `cl` chloride [SRC-112], `cort` cortisol [SRC-113], `ua` uric acid [SRC-114], `urea` [SRC-115, SRC-116], `nh4` ammonium [SRC-116], `ph` local pH [SRC-112, SRC-116], `drug` drug level as % of the prescribed target [SRC-117].
    - Heart and vessels (wearable ultrasound, Bio-Monitor): `co` cardiac output, `sv` stroke volume, `ef` ejection fraction [SRC-119], `cbp` central systolic BP, `apw` arterial pulse waveform, `vd` jugular vein diameter [SRC-118], `ecg` ECG waveform [SRC-020, SRC-022].
    - Chemical signatures: `svoc` skin VOC pattern (A-Patch) [SRC-120], `bvoc` breath VOC pattern (electronic nose) [SRC-121], `ace` breath acetone, `iso` breath isoprene [SRC-122].
    - Skin, sweat and spectroscopy: `eda` skin conductance [SRC-123], `swr` sweat rate [SRC-112], `strn` skin strain / pressure [SRC-124], `rmn` tissue spectral signature (Raman / NIR) [SRC-125].
    - Waveforms and fingerprints (`apw`, `ecg`, `svoc`, `bvoc`, `rmn`) are reduced to one shape-change **score** 0–10 against the person's own pre-flight template, so they fit the ring.
    - **Trend only:** no red-flag limits; left out of the deviation index and readiness. They do take part in hidden links (same rule: |r| ≥ 0.6, n ≥ 7, strongest 8, of which at most 4 may touch a research sensor); a link that touches a research-grade sensor is drawn dashed and its description says "correlation only". Status comes only from drift against the person's own baseline. Sweat values do not necessarily match blood values. Only HUD `blood_glucose` (CGM) feeds the ring today (→ `glu`); the rest stay grey until a device sends data.
    - **Assumption:** each indicator's plausible range (`lo`/`hi`), typical day-to-day SD (`sd`) and cadence are ARGUS working values for the baseline maths, not clinical reference ranges from the cited sources.
- **Data table:** zone, metric, value + unit, status, personal baseline (mean ± SD), drift σ, nominal range, caution range, +3 day forecast.
- **Configuration:** signed-in user + role, crew profile (baselines, notes), mission location (gravity, comm delay), scenario, threshold environment, AI provider chain.

### 2.4c Emergency
No separate tab (removed in PR #66). Emergency protocols run inside the ARGUS console (§2.4): red flags in conversation and life-threat alarms (§7) open the matching checklist, and the console's "Emergency protocols" card starts one by hand. Protocol data: `src/data/emergencyProtocols.ts`.

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

## 5. ARGUS Companion
Merged into the ARGUS console (§2.4); the top-bar ARGUS button opens it. `src/utils/companionBrain.ts` remains the HUD's last-resort offline brain when the ARGUS server cannot be reached.

## 6. HUD v2: Sign-in, Location & Clock
- **Sign-in (`AuthGate.tsx`, `AuthContext.tsx`):** first run shows **Create admin account** (username + password ×2). Afterwards a **Sign in** screen (username + password). Session lasts until sign-out or the tab closes (`sessionStorage`).
- **Face ID (`src/features/faceId/`):** a second way to sign in, like Face ID on an iPhone. The signed-in user sets it up from the face icon in the top bar: the camera captures 5 clear frames and stores their average 128-number face template (`@vladmandic/face-api`, TensorFlow.js) on **this device only**; no image or template is sent to the server. The sign-in screen then shows **Sign in with Face ID**: the same face must match in 2 frames (distance < 0.45), **then blink or turn the head slightly** (liveness), within 25 s, so a printed photo is not enough. The liveness step reads face landmarks only (≈3× faster than recognition) so a quick blink is not missed; a blink counts when the eye-aspect ratio drops below 75 % of the person's own open-eye value and recovers, and a head turn when the nose moves ≥ 22 % of the eye distance sideways. Password sign-in always stays available. Models (~7 MB) are copied to `public/models/face` by `scripts/copy-face-models.mjs` before `dev`/`build` and load only when Face ID is used. Server mode: see specs/05 §6 (device token).
- **Roles:** `admin` sees every crew member (crew strip, Crew tab, Users tab) and manages accounts. `crew` users are linked to one `CrewMemberProfile` and only see that astronaut: no crew strip, no Crew/Users tabs, their own chat, check-ins and location.
- **Users tab (`UsersTab.tsx`, admin only):** list accounts; create a crew or admin account (username, password, linked crew member); reset a password; delete an account (never the last admin or yourself).
- **Mission location (`SpaceLocationId`, §8 of spec 01):** selector in the top bar, stored per crew member. Drives the comm-delay badge, gravity label, the clock's local-time line and the AI context. Thresholds stay on the `0g_transit` table until location-aware thresholds are specified.
- **Comm delay (`commDelayAt` / `formatCommDelay`, `src/data/lightTime.ts`):** a single live one-way light time, not a range. Mars surface/rover: Earth–Mars distance today (JPL approximate planetary elements) / c, e.g. `10m 58s`. Moon and Gateway: Earth–Moon distance (Meeus ch. 47) / c, e.g. `1.35 s`. LEO: geostationary relay path ≈ `240 ms`. Mars transit: `up to` the current Earth–Mars value, because the craft's position on the trajectory is not tracked. Earth: `0.000 s`. Relay/processing time is not included.
- **Clock (`MissionClock.tsx`, `src/data/dualClock.ts`):** two clocks. **Earth** is always Houston (NASA JSC, `America/Chicago`, with CST/CDT). Away from Earth, the **mission area's own time** is shown above it: Mars (`MTC hh:mm` + sol) on Mars surface and rover; Moon (`Day x / 29.5` of the lunar cycle) on the Moon and Gateway; Station (`GMT`, as on the ISS, + orbit minute and day/night side) in LEO; Ship (`UTC`) in Mars transit. On Earth (before/after mission) only the Earth clock is shown. Plus `Mission day N`.
- **Security note:** accounts live in the browser (`localStorage`, PBKDF2-hashed passwords). This separates astronauts' views on a shared device; it is not server-side security.

## 7. Emergency alert (`LifeThreatAlert.tsx`, `SettingsMenu.tsx`, `src/utils/vitalLimits.ts`, `src/utils/alarmTone.ts`)
- **Trigger:** the active crew member's latest reading of a metric is inside the physiological limits but at or beyond `LIFE_THREAT_LIMITS` (specs/01-data-schema.md §2), e.g. body temperature 42 °C. Physically impossible values (e.g. 50 °C) never trigger it: they are dropped as typos or sensor faults.
- **Screen:** pops up over every tab (mounted once at the HUD root, `z-[100]`, `role="alertdialog"`). Styled like a phone emergency alert: a red blob behind a phone-shaped white card with a red border, a red warning triangle, **EMERGENCY ALERT**, the crew callsign, each threatening metric with its value, the limit it crossed and one plain-language action, and a round **OK** button.
- **Sound:** one beep + spoken "Alert!", then a **spoken message** (browser speech synthesis, English, on the device; `runAlertSequence`, `alertSpeech`): "38.5 degrees Celsius body temperature detected for VEGA. You should stop strenuous work, drink water, recheck your temperature in 30 minutes and tell the crew medical officer now." Each step waits for the previous one to finish. Each new alert plays once; pressing OK stops it. Audio and speech are unlocked on the first click or key press (a silent utterance) because browsers block sound before a user gesture; speech waits 120 ms after a cancel and keeps a reference to the utterance (Chrome drops it otherwise).
- **Fever (yellow):** body temperature ≥ 38.5 °C and < 40 °C raises the same card in amber (*Health Alert · Act now*) with the fever action; ≥ 40 °C stays the red *Emergency Alert*.
- **Dismissal:** only **OK** closes it. Acknowledgement is stored per crew member, metric and value for the browser session, so a new dangerous value raises a new alert.
- **Test:** top bar **Settings** (gear) → **Test emergency alert** shows the same alert marked "Test · not a real reading" (38.5 °C fever, amber) with the alert sound and the spoken message. Nothing is logged or stored.
- Shown only to users who can view health data.


### 7b. Spacecraft link (`SpacecraftAlert.tsx`, `src/features/spacecraft/habitat.ts`) — demo
ARGUS as the ship's voice assistant: it watches the cabin, changes the (simulated) spacecraft systems itself, and tells the crew out loud what it saw and what it did.
- **Scenarios** (Settings → *Spacecraft · ARGUS takes action*): CO₂ spike (Lab, red), oxygen dropping, cabin too hot, humidity high, slow pressure leak (Node 3, red). Values, systems and recovery curves are illustrative, not flight data or flight rules.
- **Action tiers:** *auto* (safe, reversible: scrubber rate, fans, cooling, O₂ generator boost, repressurisation) runs at once and can be undone; *confirm* (backup LiOH canister, O₂ from tanks, closing a hatch) waits for the crew; life-support shutdowns are never automated.
- **Alarm card:** live reading recovering toward normal (progress bar), *What I changed* (from → to, Undo), pending actions with Confirm / Cancel, *What you should do*.
- **Voice:** one ring + "ARGUS!", then e.g. "Cabin CO2 jumped to 7.8 millimeters of mercury in the Lab… I set the CO2 scrubber to maximum, turned the Lab fans to high and boosted the air flow between modules. VALKYRIE, please move to Node 1… Shall I start the backup lithium hydroxide canister? Say confirm or cancel." Then it listens (browser speech recognition, Chrome/Edge) for *confirm*, *cancel*, *undo*, *status* and answers out loud; buttons do the same without a microphone.

### 7c. Return to Earth (`RecoveryTab.tsx`, `src/features/recovery/plan.ts`)
A personal 45-day recovery plan for each astronaut after landing, modelled on NASA's post-flight reconditioning (starts on landing day, 45 days, about two hours a day, tailored per astronaut; NTRS 20110020318).
- **Trigger:** the location changes to *Earth · after mission* (or **Land** in the tab). The landing day is saved per astronaut, the tab opens, and ARGUS starts talking by itself ("Welcome home, VEGA. I prepared your 45-day recovery plan… Your plan focuses on…"). It speaks again whenever the tab opens or the astronaut changes, and stops when the tab is left.
- **Phases:** *Stand again* (R+0–3, R+0–5 after missions ≥ 180 days), *Rebuild* (to R+14), *Back to baseline* (to R+44); checkpoints R+0, R+3, R+14, R+30, R+44 (flags on the timeline).
- **Findings from mission data** (Focus / Watch / Fine, worst first): bone (`bmd_delta`), eyes/SANS (`onsd` vs pre-flight, `iop`), heart & blood pressure (`resting_hr` vs baseline, `systolic_bp`), radiation (sum of `rad_dose`), immune (`wbc_lymph`), sleep & mind (`mood_index`, `sleep_eff`), balance, muscle (`ared_load`). Each has a typical time back to baseline and adds tasks (e.g. impact loading + calcium/vitamin D for bone loss, an eye exam on R+3 for SANS, a heart-rate cap).
- **Today:** checklist for the selected day (◀ ▶), minutes per task, done state per astronaut and day (`localStorage`).
- Thresholds, tasks and recovery times are ARGUS decision-support choices; the tab says the flight surgeon and reconditioning specialists set the real plan.
- **Voice:** messages are spoken one sentence at a time, old speech is always cancelled first, and a pause/resume keep-alive runs while speaking (Chrome's online voices otherwise stop a long utterance after ~15 s and stay stuck).
