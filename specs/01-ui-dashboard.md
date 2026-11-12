# Spec 02: ARGUS Mission Control Bio-Twin Dashboard UI

## 1. Layout Grid (Single-Screen Spacecraft HUD)
- **Top Bar (`TopMissionBar.tsx`):**
  - Branding: `ARGUS // AUTONOMOUS CREW BIO-TWIN` with subtitle `Astronaut Readiness Guidance & Unified Surveillance`
  - Simulated Earth comm delay badge (`14m 22s ONE-WAY`)
  - **Environment Context Switcher:** `0g Transit` | `1/6g Moon` | `3/8g Mars`
  - **Crew Readiness Score:** `0–100%` + daily countermeasure streak
  - **Simulate Medical Event** dropdown (`nominal`, `sans_alert`, `high_co2`, `solar_storm`)
- **Left Column — 30% (`BioTwinMap.tsx`):**
  - Interactive SVG human silhouette with 5 clickable zones (`neuro`, `cardio`, `musculo`, `immune`, `behavioral`) dynamically colored by `TriageStatus` (`#22c55e`, `#eab308`, `#ef4444`) plus quick-select zone pills.
- **Center Column — 40% (`TelemetryPanel.tsx`):**
  - Selected zone's vital sign cards (current value, unit, flight norm badge)
  - Recharts longitudinal line/area chart showing 14-day drift against a shaded `ReferenceArea` nominal range
- **Right Column — 30% (`FlightSurgeonPanel.tsx`):**
  - Plain-language *"Spaceflight Hazard Context ([Environment])"* card
  - Numbered **Guided Self-Assessment & Countermeasures** checklist
  - **Visual Self-Exam Input:** Webcam/file uploader + 1-click sample test images (*Nominal Retina*, *SANS Optic Nerve Ultrasound*, *Closed-Cabin Skin Rash*)
  - **Queue Telemetry Packet for Earth Flight Surgeon** button with confirmation state