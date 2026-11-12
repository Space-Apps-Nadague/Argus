# Spec 01: ARGUS Data Models, Deterministic Triage Thresholds & AI JSON Schema

## 1. Core Domain Enumerations & Identifiers

### Gravity Environments (`GravityEnvironment`)
- `'0g_transit'` — Deep-Space Microgravity Transit (`0g Transit`, Comm Delay: `14m 22s ONE-WAY`)
  - Primary NASA HRP Hazards: Cephalad fluid shift, Spaceflight-Associated Neuro-ocular Syndrome (SANS), bone mineral density loss, aerobic deconditioning, closed-loop $\text{CO}_2$ buildup.
- `'1_6g_moon'` — Lunar Surface Operations (`1/6g Moon`, Comm Delay: `1.3s ONE-WAY`)
  - Primary NASA HRP Hazards: Lunar regolith inhalation/dermatitis, EVA suit musculoskeletal strain, vestibular adaptation to partial gravity, solar particle events.
- `'3_8g_mars'` — Martian Surface Habitat (`3/8g Mars`, Comm Delay: `18m 40s ONE-WAY`)
  - Primary NASA HRP Hazards: Orthostatic intolerance post-transit, perchlorate/dust toxicity, circadian desynchrony (24h 39m Martian sol), autonomous medical isolation.

### Anatomical Bio-Twin Zones (`BodyZoneId`)
1. `'neuro'` — **Neuro-Ocular & CNS** (Brain, Optic Nerve Sheath, Cerebral Perfusion)
2. `'cardio'` — **Cardiovascular & Pulmonary** (Heart, Thoracic Vessels, Gas Exchange)
3. `'musculo'` — **Musculoskeletal & Spine** (Vertebral Column, Femoral Neck, Load-Bearing Muscle)
4. `'immune'` — **Immune, Radiation & Dermal** (Lymphatic Core, Bone Marrow, Skin Barrier)
5. `'behavioral'` — **Behavioral, Circadian & Cognitive** (Neural Halo, Sleep Architecture, Alertness)

### Anatomical 3D Render Layers (`AnatomicalLayer`)
- `'all'` — Full multi-layer holographic composite
- `'dermal'` — Outer translucent dermal/surface mesh & radiation dosimetry shell
- `'skeletal'` — Axial & appendicular skeletal structure (skull, spine, ribcage, pelvis, femurs)
- `'organs'` — Internal visceral & vascular structures (brain, optic tracts, heart, aortic arch, lungs, lymphatic nodes)

### Triage Status (`TriageStatus`)
- `'green'` — Nominal for active spaceflight environment (`#22c55e`)
- `'yellow'` — Elevated drift / caution; preventive countermeasures required (`#eab308`)
- `'red'` — Critical threshold exceeded; immediate autonomous protocol & Earth packet queue required (`#ef4444`)

### Crisis Scenarios (`ScenarioId`)
- `'nominal'` — **Nominal Deep-Space Cruise**: All 5 zones within expected spaceflight norms.
- `'sans_alert'` — **SANS Optic Disc Edema Alert**: Elevated Optic Nerve Sheath Diameter (ONSD `6.4 mm`) and intraocular pressure (`23 mmHg`) in `neuro`.
- `'high_co2'` — **Habitat $\text{CO}_2$ Scrubber Degradation**: Elevated cabin $\text{ppCO}_2$ (`5.8 mmHg`) driving cerebral vasodilation (`neuro` yellow/red), tachycardia (`cardio` yellow), and cognitive fatigue (`behavioral` yellow).
- `'solar_storm'` — **SPE Radiation Storm Alert**: Acute solar particle event raising cumulative dose rate (`immune` red, lymphocyte drop `1.05 k/µL`, skin erythema risk) and stress response (`cardio` / `behavioral` yellow).

### Crew Member Profile (`CrewMemberProfile`)
ARGUS tracks a roster of astronauts (`DEFAULT_CREW_ROSTER` + user-created custom crew members persisted in `localStorage`). Each crew member has individualized baseline physiology that deterministically offsets their 30-day telemetry series:

```typescript
export type BloodType = 'O+' | 'O-' | 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-';

export type CrewRole =
  | 'Mission Commander'
  | 'Flight Engineer'
  | 'Flight Surgeon / Medical Officer'
  | 'Payload & Science Specialist'
  | 'EVA Surface Specialist';

export interface CrewMemberProfile {
  id: string;
  name: string;
  callsign: string;
  role: CrewRole | string;
  age: number;
  bloodType: BloodType;
  restingHrBaselineBpm: number; // Pre-flight resting HR baseline (e.g., 54-72 bpm)
  preFlightOnsdMm: number;      // Pre-flight optic nerve sheath baseline (e.g., 4.6-5.2 mm)
  missionDaysLogged: number;    // Mission duration in sols/days
  countermeasureStreakSols: number;
  defaultScenarioId: ScenarioId;
  medicalNotes: string;         // Individual spaceflight risk profile / notes
  isCustom?: boolean;
}
```

---

## 2. Vital Sign Definitions & Gravity-Adjusted Thresholds

Each zone tracks 2–3 primary metrics (`VitalMetric`). Deterministic triage (`src/utils/triageEngine.ts`) evaluates each metric against environment-adjusted thresholds:

```typescript
export interface ThresholdRange {
  nominalMin: number;
  nominalMax: number;
  yellowMin: number;
  yellowMax: number;
}
```
- Value within `[nominalMin, nominalMax]` $\rightarrow$ `'green'`
- Value outside nominal range but within `[yellowMin, yellowMax]` $\rightarrow$ `'yellow'`
- Value outside `[yellowMin, yellowMax]` $\rightarrow$ `'red'`
- Zone `TriageStatus` is the worst status among its constituent metrics (`red > yellow > green`).

### Zone Metric Catalog & Thresholds by Gravity Mode

| Zone | Metric ID | Label | Unit | `0g_transit` Nominal (Yellow) | `1_6g_moon` Nominal (Yellow) | `3_8g_mars` Nominal (Yellow) |
|---|---|---|---|---|---|---|
| `neuro` | `onsd` | Optic Nerve Sheath Diam. | `mm` | `4.5–5.5` (`4.2–5.9`) | `4.4–5.3` (`4.1–5.7`) | `4.3–5.2` (`4.0–5.6`) |
| `neuro` | `iop` | Intraocular Pressure | `mmHg` | `11–18` (`9–21`) | `10–17` (`9–20`) | `10–17` (`9–19`) |
| `neuro` | `cabin_co2` | Inspired $\text{ppCO}_2$ | `mmHg` | `1.5–3.5` (`1.0–4.5`) | `1.5–3.5` (`1.0–4.5`) | `1.5–3.8` (`1.0–4.8`) |
| `cardio` | `resting_hr` | Resting Heart Rate | `bpm` | `52–74` (`46–86`) | `55–78` (`48–88`) | `58–82` (`50–92`) |
| `cardio` | `hrv_rmssd` | Heart Rate Variability | `ms` | `42–85` (`30–95`) | `40–82` (`28–95`) | `38–80` (`26–95`) |
| `cardio` | `spo2` | Arterial $\text{SpO}_2$ | `%` | `96–100` (`93–100`) | `95–100` (`92–100`) | `95–100` (`92–100`) |
| `musculo` | `bmd_delta` | Femoral BMD Monthly $\Delta$ | `%` | `-0.8–0.2` (`-1.3–0.5`) | `-0.5–0.2` (`-1.0–0.5`) | `-0.4–0.3` (`-0.8–0.5`) |
| `musculo` | `ared_load` | Daily ARED Resistance Load | `kN·reps` | `18–30` (`12–35`) | `15–28` (`10–35`) | `14–26` (`10–35`) |
| `immune` | `rad_dose` | 24h Radiation Dose Rate | `mSv/d` | `0.4–1.2` (`0.0–2.5`) | `0.3–1.0` (`0.0–2.2`) | `0.2–0.8` (`0.0–2.0`) |
| `immune` | `wbc_lymph` | Lymphocyte Count | `k/µL` | `1.5–3.5` (`1.2–4.0`) | `1.5–3.5` (`1.2–4.0`) | `1.5–3.5` (`1.2–4.0`) |
| `behavioral` | `sleep_eff` | Circadian Sleep Efficiency | `%` | `82–96` (`72–100`) | `82–96` (`72–100`) | `80–95` (`70–100`) |
| `behavioral` | `pvt_lapses` | Psychomotor Vigilance Lapses | `lapses` | `0–2` (`0–4`) | `0–2` (`0–4`) | `0–3` (`0–5`) |

---

## 3. Longitudinal Telemetry Series & Readiness Score

```typescript
export interface TelemetryHistoryPoint {
  missionDay: number; // Day 1 to Day 30 (charts highlight last 14 or full 30 days)
  dateLabel: string;  // e.g., "MD-17" .. "MD-30"
  value: number;
}

export interface VitalSignReading {
  metricId: string;
  label: string;
  unit: string;
  currentValue: number;
  deltaFromBaseline: string; // e.g., "+1.2 mm vs Pre-Flight"
  flightNormLabel: string;   // e.g., "0g Norm: 4.5–5.5 mm"
  plainDescription: string;  // Non-physician explanation of what this metric means
  history: TelemetryHistoryPoint[];
}
```

### Deterministic Crew Readiness Score (`0–100%`)
Calculated deterministically in `src/utils/triageEngine.ts`:
- Base score: `98%`
- Each metric in `'yellow'` status deducts `3%`
- Each metric in `'red'` status deducts `8%`
- Completed countermeasure checklist items in the active session add `+3%` each (capped at `100%`, minimum `15%`).

---

## 4. AI Structured Output Schema (`FlightSurgeonGuidance` & `VisualExamAnalysis`)

The AI layer (`src/services/flightSurgeonAi.ts`) uses `@google/genai` (`client.interactions.create` with model `gemini-3.8-flash`) and `response_format` JSON Schema to generate or refresh guidance while guaranteeing deterministic offline fallback when no API key is configured.

```typescript
export interface CountermeasureStep {
  id: string;
  stepNumber: number;
  title: string;
  plainInstruction: string;
  hardwareRequired: string; // e.g., "Spaceflight Fundoscope / Eye Ultrasound", "LBNP Chibis Suit"
  estimatedMinutes: number;
}

export interface FlightSurgeonGuidance {
  zoneId: BodyZoneId;
  environment: GravityEnvironment;
  scenarioId: ScenarioId;
  triageStatus: TriageStatus;
  headline: string;
  hazardContextSummary: string;
  plainLanguageExplanation: string;
  earthConsultUrgency: 'routine_downlink' | 'priority_packet' | 'immediate_emergency_packet';
  guidedSteps: CountermeasureStep[];
  source: 'gemini_live' | 'offline_verified_cache';
}

export interface VisualExamSample {
  id: 'nominal_retina' | 'sans_ultrasound' | 'cabin_rash';
  title: string;
  zoneId: BodyZoneId;
  modality: string;
  previewSvgDataUrl: string;
  defaultFindingStatus: TriageStatus;
  clinicalSummary: string;
  plainCrewGuidance: string;
  recommendedAction: string;
}

export interface VisualExamAnalysis {
  sampleIdOrFileName: string;
  modality: string;
  findingStatus: TriageStatus;
  clinicalSummary: string;
  plainCrewGuidance: string;
  recommendedAction: string;
  analyzedAtIso: string;
  source: 'gemini_vision' | 'offline_verified_cache';
}

export interface EarthTelemetryPacket {
  packetId: string;
  timestampIso: string;
  missionDay: number;
  commDelayLabel: string;
  crewMember: {
    id: string;
    name: string;
    callsign: string;
    role: string;
    age: number;
    bloodType: BloodType;
  };
  environment: GravityEnvironment;
  scenarioId: ScenarioId;
  readinessScore: number;
  focusZone: BodyZoneId;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  completedSteps: string[];
  visualExamAttached?: VisualExamAnalysis | null;
  crewNotes: string;
}
```
