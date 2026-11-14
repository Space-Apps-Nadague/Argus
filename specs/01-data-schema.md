# Spec 01: ARGUS Data Models, Deterministic Triage Thresholds & AI JSON Schema

## 1. Core Domain Enumerations & Identifiers

### Operating Environment (`GravityEnvironment` / `MissionLocation`)
ARGUS supports 5 canonical mission location / habitat presets grounded in NASA Human Research Program exploration operational concepts:
- `'earth_1g'` — **Earth Surface Pre/Post-Flight Baseline & Rehabilitation** (`Earth (1.00g)`, Gravity: `1.00g`, Comm Delay: `On-Site`)
  - Primary NASA HRP / Grounding: NASA Lifetime Surveillance of Astronaut Health (LSAH) [SRC-006] and Spaceflight Standard Measures [SRC-009] terrestrial baseline testing and post-flight re-adaptation / rehabilitation protocols. Terrestrial 1.00g hydrostatic column, normal atmospheric composition, full geomagnetic/atmospheric radiation shielding, and direct on-site flight surgeon clinical consultation.
- `'iss_leo'` — **International Space Station / Low Earth Orbit** (`ISS (LEO)`, Gravity: `0.00g`, Comm Delay: `Real-time ONE-WAY`)
  - Primary NASA HRP Hazards: Microgravity cephalad fluid shift, geomagnetic partial radiation shielding, closed-loop ECLSS $\text{CO}_2$ management.
- `'lunar_base'` — **Artemis Lunar Surface Outpost** (`Lunar Base`, Gravity: `0.16g` / `1/6g`, Comm Delay: `1.3s ONE-WAY`)
  - Primary NASA HRP Hazards: Partial gravity musculoskeletal unloading, abrasive regolith/dust toxicity, secondary neutron radiation, lunar night circadian disruption.
- `'0g_transit'` — **Deep-Space Microgravity Transit** (`0g Transit`, Gravity: `0.00g`, Comm Delay: `14m 22s ONE-WAY`)
  - Primary NASA HRP Hazards: Unmitigated cephalad fluid shift, Spaceflight-Associated Neuro-ocular Syndrome (SANS), accelerated bone mineral density loss, unshielded SPE/GCR deep-space radiation, closed-loop $\text{CO}_2$ buildup.
- `'mars_base'` — **Mars Surface Outpost** (`Mars Base`, Gravity: `0.38g` / `3/8g`, Comm Delay: `18m 10s ONE-WAY`)
  - Primary NASA HRP Hazards: Hypogravity (3/8g), unshielded galactic cosmic rays (GCR), perchlorate dust toxicity, extreme isolation and communications latency (up to 24 min round-trip).

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

### Metric Identifiers (`MetricId`)
The 17 canonical metric IDs tracked across the 5 zones (see §2 catalog):
```typescript
export type MetricId =
  | 'onsd' | 'iop' | 'cabin_co2'
  | 'resting_hr' | 'hrv_rmssd' | 'spo2' | 'systolic_bp'
  | 'bmd_delta' | 'ared_load' | 'blood_glucose'
  | 'rad_dose' | 'wbc_lymph' | 'core_temp'
  | 'sleep_eff' | 'pvt_lapses' | 'daily_sleep_hours' | 'mood_index';
```
`VitalSignReading.metricId` stays typed as `string` for backward compatibility; new code uses `MetricId`.

### Crew Member Profile (`CrewMemberProfile`)
ARGUS tracks a roster of astronauts (`DEFAULT_CREW_ROSTER` + user-created custom crew members persisted in `localStorage`). Each crew member has individualized baseline physiology that deterministically offsets their 30-day telemetry series:

```typescript
export type BloodType = 'O+' | 'O-' | 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-';

export type BiologicalSex = 'female' | 'male';

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
  sex: BiologicalSex;           // Determines 3D Bio-Twin male vs. female anatomical morphology
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

## 2. Vital Sign Definitions & Thresholds by Environment

Each zone tracks 2–3 primary metrics (`VitalMetric`). Deterministic triage (`src/utils/triageEngine.ts`) evaluates each metric against gravity- and environment-specific thresholds:
- **0g Microgravity Transit (`0g_transit`)**: Cephalad fluid shift elevates nominal ONSD (4.5–5.5 mm); lack of skeletal loading demands heavy daily ARED exercise (18–30 kN·reps); unshielded deep space radiation yields 0.4–1.2 mSv/d nominal.
- **ISS Low Earth Orbit (`iss_leo`)**: Microgravity fluid dynamics match 0g transit, but geomagnetic shielding and rapid resupply lower nominal radiation (0.2–0.6 mSv/d) and tighten cabin $\text{CO}_2$ (1.2–3.0 mmHg).
- **Artemis Lunar Base (`lunar_base`, 1/6g ~ 0.16g)**: Partial gravity reduces cephalad venous pooling (nominal ONSD 4.3–5.3 mm, IOP 11–19 mmHg) and partial weight-bearing reduces required ARED load (14–26 kN·reps). Surface radiation yields 0.3–0.9 mSv/d.
- **Mars Surface Base (`mars_base`, 3/8g ~ 0.38g)**: Substantial partial gravity further mitigates SANS risk (nominal ONSD 4.1–5.1 mm, IOP 12–20 mmHg) and preserves musculoskeletal mass (nominal ARED 12–24 kN·reps, BMD delta -0.4–0.3%). Modest atmospheric shielding yields nominal radiation of 0.3–0.8 mSv/d.
- **Earth Surface Pre/Post-Flight (`earth_1g`, 1.00g)**: Full terrestrial gravity restores hydrostatic column (nominal ONSD 4.0–5.0 mm, IOP 12–20 mmHg); atmospheric and geomagnetic shielding eliminates deep-space radiation (0.0–0.05 mSv/d); ambient sea-level inspired $\text{ppCO}_2$ is nominal (0.0–1.0 mmHg); 1g weight-bearing eliminates mandatory daily ARED loads (0–16 kN·reps) and stabilizes monthly bone mineral density delta (-0.2–0.2%). Grounded in NASA LSAH [SRC-006] and Spaceflight Standard Measures [SRC-009].

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

### Zone Metric Catalog & Thresholds Table

| Zone | Metric ID | Label | Unit | `0g_transit` (Nominal / Yellow) | `iss_leo` | `lunar_base` (1/6g) | `mars_base` (3/8g) | `earth_1g` (1.00g) |
|---|---|---|---|---|---|---|---|---|
| `neuro` | `onsd` | Optic Nerve Sheath Diam. | `mm` | `4.5–5.5` (`4.2–5.9`) | `4.5–5.5` (`4.2–5.9`) | `4.3–5.3` (`4.0–5.7`) | `4.1–5.1` (`3.8–5.5`) | `4.0–5.0` (`3.8–5.3`) |
| `neuro` | `iop` | Intraocular Pressure | `mmHg` | `11–18` (`9–21`) | `11–18` (`9–21`) | `11–19` (`9–21`) | `12–20` (`10–22`) | `12–20` (`10–22`) |
| `neuro` | `cabin_co2` | Inspired $\text{ppCO}_2$ | `mmHg` | `1.5–3.5` (`1.0–4.5`) | `1.2–3.0` (`0.8–4.0`) | `1.2–3.2` (`0.8–4.2`) | `1.2–3.0` (`0.8–4.0`) | `0.0–1.0` (`0.0–2.0`) |
| `cardio` | `resting_hr` | Resting Heart Rate | `bpm` | `52–74` (`46–86`) | `52–74` (`46–86`) | `54–76` (`48–88`) | `55–78` (`50–90`) | `55–80` (`50–90`) |
| `cardio` | `hrv_rmssd` | Heart Rate Variability | `ms` | `42–85` (`30–95`) | `42–85` (`30–95`) | `42–85` (`30–95`) | `42–85` (`30–95`) | `42–85` (`30–95`) |
| `cardio` | `spo2` | Arterial $\text{SpO}_2$ | `%` | `96–100` (`93–100`) | `96–100` (`93–100`) | `96–100` (`93–100`) | `96–100` (`93–100`) | `96–100` (`93–100`) |
| `cardio` | `systolic_bp` | Systolic Blood Pressure | `mmHg` | `100–130` (`90–140`) | `100–130` (`90–140`) | `105–135` (`95–145`) | `110–135` (`95–145`) | `100–130` (`90–140`) |
| `musculo` | `bmd_delta` | Femoral BMD Monthly $\Delta$ | `%` | `-0.8–0.2` (`-1.3–0.5`) | `-0.8–0.2` (`-1.3–0.5`) | `-0.6–0.2` (`-1.0–0.5`) | `-0.4–0.3` (`-0.8–0.6`) | `-0.2–0.2` (`-0.5–0.5`) |
| `musculo` | `ared_load` | Daily ARED Resistance Load | `kN·reps` | `18–30` (`12–35`) | `18–30` (`12–35`) | `14–26` (`10–30`) | `12–24` (`8–28`) | `0–16` (`0–24`) |
| `musculo` | `blood_glucose` | Blood Glucose | `mg/dL` | `70–110` (`60–140`) | `70–110` (`60–140`) | `70–110` (`60–140`) | `70–110` (`60–140`) | `70–110` (`60–140`) |
| `immune` | `rad_dose` | 24h Radiation Dose Rate | `mSv/d` | `0.4–1.2` (`0.0–2.5`) | `0.2–0.6` (`0.0–1.2`) | `0.3–0.9` (`0.0–2.0`) | `0.3–0.8` (`0.0–1.8`) | `0.0–0.05` (`0.0–0.1`) |
| `immune` | `wbc_lymph` | Lymphocyte Count | `k/µL` | `1.5–3.5` (`1.2–4.0`) | `1.5–3.5` (`1.2–4.0`) | `1.5–3.5` (`1.2–4.0`) | `1.5–3.5` (`1.2–4.0`) | `1.5–3.5` (`1.2–4.0`) |
| `immune` | `core_temp` | Core Body Temperature | `°C` | `36.5–37.5` (`36.0–38.0`) | `36.5–37.5` (`36.0–38.0`) | `36.5–37.5` (`36.0–38.0`) | `36.5–37.5` (`36.0–38.0`) | `36.5–37.5` (`36.0–38.0`) |
| `behavioral` | `sleep_eff` | Circadian Sleep Efficiency | `%` | `82–96` (`72–100`) | `82–96` (`72–100`) | `82–96` (`72–100`) | `82–96` (`72–100`) | `82–96` (`72–100`) |
| `behavioral` | `pvt_lapses` | Psychomotor Vigilance Lapses | `lapses` | `0–2` (`0–4`) | `0–2` (`0–4`) | `0–2` (`0–4`) | `0–2` (`0–4`) | `0–2` (`0–4`) |
| `behavioral` | `daily_sleep_hours` | Daily Sleep Duration | `hours` | `7.0–9.0` (`6.0–10.0`) | `7.0–9.0` (`6.0–10.0`) | `7.0–9.0` (`6.0–10.0`) | `7.0–9.0` (`6.0–10.0`) | `7.0–9.0` (`6.0–10.0`) |
| `behavioral` | `mood_index` | Behavioral Mood Index | `/10` | `7.0–10.0` (`5.0–10.0`) | `7.0–10.0` (`5.0–10.0`) | `7.0–10.0` (`5.0–10.0`) | `7.0–10.0` (`5.0–10.0`) | `7.0–10.0` (`5.0–10.0`) |

### Passive Wearable Metrics (non-triage) and how each indicator is collected
With the two-device kit (`specs/05-data-platform.md` §4) nothing needs typing:
- **From the watch:** `systolic_bp` (cuff-calibrated every 28 days [SRC-075]), `daily_sleep_hours`, `core_temp`, `mood_index` and `pvt_lapses`. Body temperature is *estimated* from overnight wrist temperature against the personal baseline [SRC-074]; a watch does not measure true core temperature. Mood is one tap a day.
- **From a weekly glucometer photo:** `blood_glucose` [SRC-077], since watches cannot measure glucose [SRC-076].
- **Clinical reference for the team bands** (PR #20): AHA blood pressure categories [SRC-070, SRC-071]; ADA glucose ranges [SRC-072, SRC-073].
- **Minute-level streams with no thresholds of their own:** `heart_rate` (bpm), `resp_rate` (breaths/min), `activity` (g), `sleep_state` (0/1), `wrist_temp` (°C), `diastolic_bp` (mmHg) and `dose_rate` (µGy/h). They feed the daily values of `resting_hr`, `spo2`, `sleep_eff`, `core_temp` and `rad_dose` (spec 05 §5.1) and the AI context.
- **Time:** timestamps are real UTC `timestamptz`, and `missionDay` is derived from the mission start.

### Typical Day-to-Day Variability (`METRIC_TYPICAL_SD`) & Check-In Input Ranges (`METRIC_INPUT_RANGES`)
Both tables live in `src/utils/triageEngine.ts` next to `METRIC_THRESHOLDS`. Neither table affects triage status.
- `METRIC_TYPICAL_SD` is the minimum standard deviation used for personal-baseline drift (§5), so a very flat baseline week does not turn tiny changes into huge σ values.
- `METRIC_INPUT_RANGES` gives hard plausibility limits for manual check-in entry (§6). Values outside `[min, max]` are rejected as typos or sensor errors before they reach triage. Each entry also carries a one-line `how` measurement instruction for non-physician crew.

| Metric ID | Typical SD | Input min | Input max | How to measure (`how`) |
|---|---|---|---|---|
| `onsd` | `0.10` | `3.0` | `8.0` | Ocular ultrasound, transverse plane, 3 mm behind globe; average both eyes. |
| `iop` | `1.0` | `5` | `40` | Rebound tonometer, seated, average of 3 readings per eye. |
| `cabin_co2` | `0.3` | `0` | `15` | Read the nearest cabin CO₂ monitor (CDM) at crew head height. |
| `resting_hr` | `3` | `30` | `180` | On waking, before moving: wearable or 30 s pulse count × 2. |
| `hrv_rmssd` | `6` | `5` | `250` | Overnight RMSSD from your wearable. |
| `spo2` | `0.7` | `70` | `100` | Finger oximeter, warm hand, still for 30 s. |
| `systolic_bp` | `4` | `60` | `240` | Automatic: watch spot readings, seated (watch cuff-calibrated every 28 days). |
| `bmd_delta` | `0.15` | `-5` | `3` | Monthly QCT/DXA-equivalent scan result vs previous scan (%). |
| `ared_load` | `2.5` | `0` | `60` | Total from the ARED/resistance device log for today. |
| `blood_glucose` | `5` | `40` | `400` | Weekly fasting finger-prick, then a photo of the meter screen. |
| `rad_dose` | `0.15` | `0` | `50` | Personal dosimeter: last 24 h reading. |
| `wbc_lymph` | `0.2` | `0.1` | `10` | Point-of-care blood analyzer, finger-prick sample. |
| `core_temp` | `0.15` | `34.0` | `42.0` | Automatic: estimated from overnight watch wrist temperature. |
| `sleep_eff` | `3` | `0` | `100` | Wearable sleep efficiency for last night (%). |
| `pvt_lapses` | `0.8` | `0` | `50` | 3-minute Psychomotor Vigilance Test on the watch. |
| `daily_sleep_hours` | `0.5` | `0` | `24` | Automatic: sleep duration from the watch. |
| `mood_index` | `0.5` | `1` | `10` | One tap on the watch each evening (1 = lowest, 10 = optimal). |

---

## 3. Longitudinal Telemetry Series & Readiness Score

```typescript
export interface TelemetryHistoryPoint {
  missionDay: number; // Day 1 to Day 30 (charts highlight last 14 or full 30 days)
  dateLabel: string;  // e.g., "MD-17" .. "MD-30"
  value: number;
  source?: 'synthetic' | 'check_in'; // 'check_in' when overlaid from a crew CheckInEntry (§6)
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

The AI layer (`src/services/flightSurgeonAi.ts`) uses structured JSON Schema output to generate or refresh guidance while guaranteeing deterministic offline fallback when no API key is configured.

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
  source: 'live_ai' | 'offline_verified_cache';
}

### Crew Symptom & Clinical Q&A Input (`crewSymptoms`)
During spaceflight communication blackouts (e.g. 14–22 min Mars/Deep-Space one-way transit), astronauts can submit free-text clinical symptoms and questions directly to the Autonomous Flight Surgeon:
- **Parameter:** `crewSymptoms?: string` passed into `synthesizeFlightSurgeonGuidance` and `GuidanceRequest`.
- **Deterministic Offline Keyword Fallback (`src/utils/symptomFallback.ts`):** When operating offline or without an active AI key, incoming symptom text is evaluated deterministically against clinical spaceflight keyword dictionaries:
  1. *Neuro-Ocular / SANS*: keywords (`headache`, `vision`, `blur`, `optic`, `eye`, `sans`, `papilledema`, `scotoma`) → triggers SANS protocol, cranial pressure relief steps, and fundoscopy/ultrasound instructions.
  2. *Hypercapnia / Cabin CO₂*: keywords (`co2`, `carbon dioxide`, `hypercapnia`, `scrubber`, `stuffy`, `air hunger`) → triggers CDRA/LiOH scrubber exchange, portable O₂ breathing, and metabolic exertion limits.
  3. *Cardiovascular & Autonomic*: keywords (`palpitation`, `heart`, `chest`, `tachycardia`, `arrhythmia`, `pulse`, `dyspnea`, `orthostatic`) → triggers ECG verification, hydration bolus, and aerobic interval protocols.
  4. *Musculoskeletal & Spine*: keywords (`back`, `spine`, `vertebra`, `bone`, `muscle`, `lumbar`, `elongation`, `stiff`) → triggers ARED axial loading and spinal alignment countermeasures.
  5. *Immune, Dermal & Radiation*: keywords (`rash`, `itch`, `skin`, `erythema`, `radiation`, `storm`, `spe`, `dosimeter`, `lymphocyte`) → triggers water-wall shelter verification, antioxidant packs, and dermal photography.
  6. *Behavioral & Circadian*: keywords (`sleep`, `insomnia`, `fatigue`, `exhausted`, `fog`, `lapse`, `anxiety`, `circadian`) → triggers 480nm depleted lighting and psychomotor vigilance testing (PVT).
  7. *Acute Red Flags*: keywords (`crushing chest pain`, `loss of vision`, `cannot breathe`, `unconscious`, `severe hemorrhage`) → deterministically escalates status to `'red'` and `earthConsultUrgency` to `'immediate_emergency_packet'`.
- **Live AI Enhancement:** When a supported AI provider is available, `crewSymptoms` is grounded into the LLM prompt while preserving deterministic triage boundaries.

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
  source: 'live_vision_ai' | 'offline_verified_cache';
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
  recentCheckIns?: CheckInEntry[]; // Up to the 5 most recent check-ins of the active crew member (§6)
  crewNotes: string;
}
```

---

## 5. Personal-Baseline Drift, Forecast & Metric Links (`src/utils/driftAnalytics.ts`)

Ported from the ARGOS prototype (`ARGOS_The_Thousand_Eyes.html`). All functions are pure and deterministic. **Drift never changes `TriageStatus`.** It is an early-warning layer that shows when a crew member is trending away from *their own* normal while still inside population thresholds.

```typescript
export interface PersonalBaseline { mean: number; sd: number; n: number; }      // n = points used
export type DriftDirection = 'up' | 'down' | 'flat';
export type DriftLevel = 'steady' | 'watch' | 'drifting';                     // |ewmaZ| < 1 | < 2 | ≥ 2
export interface DriftResult { baseline: PersonalBaseline; zScore: number; ewmaZ: number; direction: DriftDirection; level: DriftLevel; }
export interface ForecastPoint { missionDay: number; dateLabel: string; mean: number; lower: number; upper: number; }
export interface MetricLink {
  fromMetricId: MetricId; toMetricId: MetricId;
  lagDays: 0 | 1;           // 1 = "from" today relates to "to" tomorrow
  r: number;                // Pearson correlation in this crew member's own series
  n: number;                // paired points
  expectedSign: 1 | -1;     // direction implied by the mechanism
  mechanism: string;        // short NASA HRP-grounded rationale
}
```

- **Baseline:** mean of mission days 1–7 (the first 7 history points). `sd = max(sample SD, METRIC_TYPICAL_SD[metric])`.
- **zScore:** `(latest − mean) / sd`. **ewmaZ:** exponentially weighted z over the series, `α = 0.3` (`e₀ = z₀`, `eᵢ = 0.3·zᵢ + 0.7·eᵢ₋₁`).
- **direction:** `up` if `ewmaZ ≥ 0.5`, `down` if `≤ −0.5`, otherwise `flat`.
- **Forecast:** ordinary least squares on the last 10 points (needs ≥ 4 points, else `null`). Horizons `+1, +2, +3` days. 90% prediction interval `ŷ ± t(0.95, n−2) · s · √(1 + 1/n + (x−x̄)²/Sxx)`, with residual SD `s` floored at `0.4 · METRIC_TYPICAL_SD`.
- **Metric links ("Why"):** only physiologically plausible **candidate pairs** (`CANDIDATE_METRIC_LINKS`) grounded in the NASA HRP hazards in `SOURCES.md` are tested. This avoids spurious correlations in synthetic data. For each pair, compute Pearson r at lag 0 and lag 1 and keep the stronger one. Show the pair only if `|r| ≥ 0.6`, `n ≥ 7`, **and the sign of r matches the pair's expected direction** (a link that contradicts the known mechanism is not shown). Return the top 5 by `|r|`. Displayed as an association, never as cause.

| From → To | Expected sign | Mechanism (short) |
|---|---|---|
| `cabin_co2` → `onsd` | `+` | CO₂ dilates cerebral vessels, raising intracranial pressure |
| `cabin_co2` → `pvt_lapses` | `+` | Elevated CO₂ impairs alertness |
| `onsd` → `iop` | `+` | Headward fluid shift loads the eye |
| `sleep_eff` → `hrv_rmssd` | `+` | Poor sleep lowers recovery (HRV) |
| `sleep_eff` → `pvt_lapses` | `−` | Sleep loss increases attention lapses |
| `resting_hr` → `hrv_rmssd` | `−` | Stress raises HR and lowers HRV |
| `rad_dose` → `wbc_lymph` | `−` | Radiation suppresses lymphocytes |
| `ared_load` → `bmd_delta` | `+` | Resistance loading protects bone |

---

## 6. Daily Crew Check-In (`CheckInEntry`, `src/utils/checkIns.ts`)

> HUD v2 removed the Check-in tab. The overlay code below stays so stored entries (and a future logging UI, issue #1) keep working.

Ported from the ARGOS prototype's daily check-in. Crew members type real readings, which are overlaid on top of the synthetic 30-day series.

```typescript
export interface CheckInEntry {
  id: string;
  crewId: string;
  missionDay: number;                               // 1 .. latestDay + 1
  timestampIso: string;
  values: Partial<Record<MetricId, number>>;        // only fields the crew filled in
  note?: string;
}
```

- **Validation:** `validateCheckInValue(metricId, value)` rejects non-finite values and values outside `METRIC_INPUT_RANGES`. Empty fields are skipped. An entry needs at least one valid value.
- **Overlay:** `applyCheckIns(zones, entries)` is pure. Entries are applied in `(missionDay, timestampIso)` order. Each value replaces the history point for that mission day, or is appended (`dateLabel: "MD-<day>"`) if the day is beyond the series. The point gets `source: 'check_in'`. `currentValue` becomes the value at the highest mission day. `deltaFromBaseline` and `flightNormLabel` are left unchanged.
- **Downstream:** triage (`evaluateAllZones`), readiness score, drift, forecast and links all run on the overlaid zones, so a check-in updates the whole HUD deterministically.
- **Flight Surgeon guidance follows live status:** offline guidance is keyed by scenario, so a check-in can make it stale. When the live (overlaid) status of the guidance zone differs from `guidance.triageStatus`, ARGUS deterministically re-selects guidance (`resolveLiveGuidance`):
  1. Use the first offline protocol from the 4 scenarios (`nominal`, `sans_alert`, `high_co2`, `solar_storm`, in that order) whose guidance for the same zone has the live status, keeping the active `scenarioId`.
  2. If none matches, keep the cached guidance but set `triageStatus` to the live status, escalate `earthConsultUrgency` (`yellow` → `priority_packet`, `red` → `immediate_emergency_packet`), and prefix the headline with `Check-in out of range — `.
  Live AI guidance (`source: 'live_ai'`) is never replaced.
- **Streak:** `checkInStreak(entries)` = number of consecutive mission days with ≥ 1 entry, ending at the most recent logged day.
- **Persistence:** `localStorage` key `argus_checkins_v1` → `Record<crewId, CheckInEntry[]>`. Deleting a crew member deletes their check-ins.
- **Quick Interactive Vital Logging (`logVitalReading`, `src/components/TelemetryPanel.tsx`):**
  In addition to multi-metric batch check-ins on `CheckInTab`, astronauts can log individual vital readings live via `logVitalReading(zoneId, metricKey, value)`. This action immediately updates the active crew member's latest day (`MD-30`) reading, re-evaluates deterministic Green/Yellow/Red triage (`evaluateMetricStatus` & `evaluateZoneStatus`), recalculates the Crew Readiness Score (`calculateCrewReadinessScore`), updates the 3D Bio-Twin status color, and triggers Flight Surgeon AI guidance synthesis for that zone.

---

## 7. ARGUS Companion Chat
Implemented with the AI backend types in `src/types/aiApi.ts` (`CrewChatMessage`, `ChatRequest`, `ChatStreamEvent`; see `specs/04-ai-backend.md`). Chat history is stored per crew member in `localStorage` (`argus_chat_v1` → `Record<crewId, CrewChatMessage[]>`, last 50 messages).

## 8. Mission Location (`SpaceLocationId`, `src/data/spaceLocations.ts`)

```typescript
export type SpaceLocationId =
  | 'earth_pre' | 'earth_post' | 'leo' | 'gateway'
  | 'lunar_surface' | 'mars_transit' | 'mars_surface' | 'rover';

export interface SpaceLocation {
  id: SpaceLocationId;
  label: string;               // "Mars transit"
  gravityG: number;            // 0, 0.16, 0.38, 1
  gravityLabel: string;        // "≈0 g"
  commDelaySec: [number, number]; // one-way light time range in seconds, [0, 0] on Earth
  radiation: 'shielded' | 'magnetosphere' | 'deep_space' | 'surface';
  clock: 'earth' | 'leo' | 'lunar' | 'mars';
  description: string;
}
```
- Stored per crew member: `localStorage` `argus_locations_v1` → `Record<crewId, SpaceLocationId>`. Default `mars_transit` (matches the `0g_transit` thresholds).
- Sent to the AI backend as optional `locationId` on every request; the server adds the location line to prompts.
- **Thresholds per location:** each `SpaceLocationId` maps to one threshold set in §2 through `LOCATION_ENVIRONMENT` (`src/data/spaceLocations.ts`):
  - `earth_pre` and `earth_post` → `earth_1g`
  - `leo` → `iss_leo`
  - `gateway` and `mars_transit` → `0g_transit`
  - `lunar_surface` → `lunar_base`
  - `mars_surface` and `rover` → `mars_base`

  The location selector in the top bar is the single control; the environment follows it.

## 9. User Accounts (`UserAccount`, server-side)
Accounts live in the database (`users`, `sessions`; `specs/05-data-platform.md` §3.1, §6). The browser never stores password hashes.

```typescript
export type UserRole = 'admin' | 'astronaut' | 'flight_surgeon';

export interface UserAccount {
  id: string;
  username: string;            // unique, case-insensitive, 3–32 chars
  role: UserRole;
  crewId?: string;             // astronaut id; required for 'astronaut'
  createdAtIso: string;
  disabled?: boolean;
}
```
- Passwords: argon2id on the server, at least 10 characters. The first run creates the admin (`POST /api/auth/setup`, or `npm run db:seed`).
- Archiving a crew member keeps their accounts and history; an admin purge deletes both.

## 10. Emergency Protocols (`EmergencyProtocol`, `src/data/emergencyProtocols.ts`)

```typescript
export interface EmergencyProtocol {
  id: 'fire' | 'depress' | 'toxic' | 'medical' | 'radiation' | 'co2';
  title: string;
  icon: string;                // lucide icon name
  trigger: string;             // when to use it, one line
  steps: string[];
}

export interface EmergencyRun {
  protocolId: EmergencyProtocol['id'];
  crewId: string;
  startedAtIso: string;
  completed: Record<number, string>; // step index → ISO time
}
```
Runs are kept in memory for the session and included in the Earth packet notes when the crew taps `Notify Earth`.


---

## 11. Scheduled Mission Routine & Gamification Milestones (`REQ-08`, `REQ-09`)

To keep non-physician astronauts consistently engaged in preventative clinical health checks during multi-year missions, ARGUS provides periodic mission routine prompts and a deterministic gamification milestone system.

### Scheduled Mission Routine (`ScheduledRoutineStatus`)
A mission routine is due whenever the active crew member has not logged any health indicators for the active mission day (`latestDay`):
- **Due State:** Surfaced in `ScheduledRoutineBanner.tsx` across the HUD with the current sol indicator (`MD-<day>`), core indicator checklist (resting HR, blood pressure, sleep, mood), and dual interactive options:
  1. **Quick-Log Routine (1-Click):** Logs nominal baseline readings for the active crew member on the active sol, immediately fulfilling the daily routine, extending the sol streak, and updating biological triage.
  2. **Open Full Check-In:** Navigates directly to `CheckInTab.tsx` for fine-grained multi-metric manual telemetry logging.
- **Completed State:** Displays affirmative confirmation (`MD-<day> Routine Logged`) with streak counter and unlocked readiness milestone progress.

### Readiness Milestones & Badges (`ReadinessMilestone`)

```typescript
export type MilestoneCategory = 'streak' | 'readiness' | 'routine';

export interface ReadinessMilestone {
  id: string;
  title: string;
  description: string;
  category: MilestoneCategory;
  icon: 'flame' | 'shield' | 'award' | 'zap' | 'check' | 'heart';
  unlocked: boolean;
  unlockedAtLabel?: string;
  progress: {
    current: number;
    target: number;
    unit: string;
  };
}
```

#### Deterministic Milestone Catalog:
1. `'first_check'` — **First Sol Check**: Completed 1st scheduled mission routine (target: 1 check-in).
2. `'streak_3'` — **Orbital Rhythm**: 3 consecutive sols with logged health routines (target: 3 sols).
3. `'streak_7'` — **Vigilant Guardian**: 7 consecutive sols of continuous health telemetry (target: 7 sols).
4. `'streak_14'` — **Deep-Space Discipline**: 14 consecutive sols of active telemetry & countermeasure adherence (target: 14 sols).
5. `'peak_readiness'` — **Peak Condition**: Maintained Crew Readiness Score $\ge 95\%$ (target: 95%).
6. `'countermeasure_pro'` — **Countermeasure Specialist**: Completed $\ge 2$ active countermeasure checklist items (target: 2 steps).

