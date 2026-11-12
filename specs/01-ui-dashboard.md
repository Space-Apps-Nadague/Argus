# Spec 02: ARGUS Mission Control Bio-Twin Dashboard UI

## 1. Layout Grid (Single-Screen Spacecraft HUD)
- **Visual Language:** Dark spacecraft HUD (`bg-slate-950`, subtle grid overlay, `cyan-400` primary HUD accents, `#22c55e` Nominal Green, `#eab308` Caution Yellow, `#ef4444` Alert Red).
- **Top Bar (`TopMissionBar.tsx`) & Crew Roster Strip:**
  - Branding: `ARGUS // AUTONOMOUS CREW BIO-TWIN` with subtitle `Astronaut Readiness Guidance & Unified Surveillance`
  - Simulated Earth comm delay badge (`14m 22s ONE-WAY` in `0g_transit`, `1.3s ONE-WAY` in `1_6g_moon`, `18m 40s ONE-WAY` in `3_8g_mars`)
  - **Environment Context Switcher:** `0g Transit` | `1/6g Moon` | `3/8g Mars`
  - **Crew Readiness Score:** `0–100%` + daily countermeasure streak
  - **Simulate Medical Event** dropdown (`nominal`, `sans_alert`, `high_co2`, `solar_storm`)
  - **Interactive Crew Roster Strip:** Displays all astronauts in the mission roster as selectable HUD pills (showing Callsign, Name, Role, Blood Type, and live Readiness status dot) + **`+ Add / Manage Crew`** button opening `CrewManagerModal.tsx`.
- **Crew Roster & Custom Astronaut Creator Modal (`CrewManagerModal.tsx`):**
  - Lists all crew members with their physiological baselines (`restingHrBaselineBpm`, `preFlightOnsdMm`), mission sols logged, blood type, age, role, and medical notes.
  - **Create Custom Crew Member Form:** Allows creating a new astronaut with full details (Full Name, Callsign, Mission Role, Age, Blood Type, Pre-Flight Resting HR, Pre-Flight ONSD, Mission Sols Logged, Countermeasure Streak, Initial Telemetry Scenario, and Medical / Physiological Notes). Custom crew members are persisted to `localStorage` and immediately receive individualized 30-day Bio-Twin telemetry.
- **Left Column — 30% (`BioTwinMap.tsx`):**
  - Active Crew Member Bio-Twin header card showing callsign, age, blood type, mission sols, and medical note summary.
  - Rotating interactive **3D Holographic Human Bio-Twin** (`OrbitControls` with auto-rotate that pauses on hover/drag, zoom, and camera reset).
  - **Anatomical Layer Switcher:** Toggle or isolate body layers (`All Layers`, `Dermal / Surface`, `Skeletal / Musculoskeletal`, `Organs / Vascular`) to inspect internal vs. surface systems.
  - **Clickable 3D Body Parts / Zones:** 5 clickable anatomical regions (`neuro` brain/optic nerve, `cardio` heart/vessels, `musculo` spine/femurs, `immune` lymphatic core/skin, `behavioral` circadian/neural halo) dynamically colored by `TriageStatus` (`#22c55e`, `#eab308`, `#ef4444`) with hover tooltips and quick-select zone pills.
- **Center Column — 40% (`TelemetryPanel.tsx`):**
  - Selected zone's vital sign cards individualized to the active crew member (current value, unit, delta from pre-flight baseline, flight norm badge, plain-language tooltip/caption, clickable to select the active chart metric)
  - Recharts longitudinal line/area chart (`AreaChart`, `ReferenceArea`, `ResponsiveContainer`) showing 14-day (or 30-day toggle) drift against a shaded `ReferenceArea` nominal range band for the current gravity environment
- **Right Column — 30% (`FlightSurgeonPanel.tsx`):**
  - Plain-language *"Spaceflight Hazard Context ([Environment])"* card tailored to the active crew member with optional *"Synthesize with Gemini AI"* button and source badge (`OFFLINE VERIFIED PROTOCOL` vs `GEMINI 3.8 FLASH LIVE`)
  - Numbered **Guided Self-Assessment & Countermeasures** checklist with interactive completion checkboxes, required onboard hardware badge, and estimated duration
  - **Visual Self-Exam Input:** Webcam capture / file uploader + 1-click sample test images (*Nominal Retina*, *SANS Optic Nerve Ultrasound*, *Closed-Cabin Skin Rash*) with instant multimodal triage analysis card
  - **Queue Telemetry Packet for Earth Flight Surgeon** button (including active crew member profile metadata) with confirmation banner, packet preview modal/drawer, and JSON packet download/inspection
