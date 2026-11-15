/**
 * ARGOS — The Thousand Eyes: indicator table, ported 1:1 from ARGOS_The_Thousand_Eyes.html (`IND` + `TIP`).
 * One entry per indicator. Pure data, no UI.
 */

import type { BodySystem, Indicator } from './types';

/** Body systems in ring order (prototype `SY`). */
export const BODY_SYSTEMS: readonly BodySystem[] = ["Cardio", "Respiratory", "Sleep", "Mind", "Muscle", "Bone", "Eye", "Vestibular", "Immune", "Metabolic", "Radiation", "Habitat"];

/** System label colours (prototype `SC`). */
export const SYSTEM_COLORS: Record<BodySystem, string> = {
  "Cardio": "#ff6b81",
  "Respiratory": "#4dd0ff",
  "Sleep": "#9b7bff",
  "Mind": "#c58bff",
  "Muscle": "#ffb020",
  "Bone": "#e6edf3",
  "Eye": "#3ddc97",
  "Vestibular": "#7bffcf",
  "Immune": "#ff9f7b",
  "Metabolic": "#ffd36b",
  "Radiation": "#fff04d",
  "Habitat": "#7d8fa3"
};

export const INDICATORS: readonly Indicator[] = [
  {"key": "rhr", "label": "Resting heart rate", "unit": "bpm", "system": "Cardio", "lo": 25, "hi": 220, "sd": 5, "dir": "b", "redLow": 40, "redHigh": 110, "how": "Sit 5 min, two fingers on the wrist, count 30 s and double it.", "tip": {"above": "Rest 10 min, hydrate, cut caffeine, add easy cardio", "below": "Fine if you feel well; report dizziness or fainting"}},
  {"key": "hrv", "label": "HRV (RMSSD)", "unit": "ms", "system": "Cardio", "lo": 3, "hi": 300, "sd": 12, "dir": "l", "how": "Read from your wearable overnight. Falls with overload and poor recovery.", "tip": {"below": "Protect sleep, lower stress load, easy cardio, no late caffeine"}},
  {"key": "sbp", "label": "Systolic BP", "unit": "mmHg", "system": "Cardio", "lo": 60, "hi": 260, "sd": 8, "dir": "b", "redLow": 90, "redHigh": 160, "how": "Arm cuff, seated 5 min, average two readings.", "tip": {"above": "Rest 5 min, hydrate, less salt and caffeine, re-measure; report if it persists", "below": "Drink 500 ml, stand up slowly, compression garment; report fainting"}},
  {"key": "dbp", "label": "Diastolic BP", "unit": "mmHg", "system": "Cardio", "lo": 30, "hi": 160, "sd": 6, "dir": "b", "redLow": 55, "redHigh": 100, "how": "Same cuff reading as systolic."},
  {"key": "spo2", "label": "SpO₂", "unit": "%", "system": "Respiratory", "lo": 60, "hi": 100, "sd": 1, "dir": "l", "redLow": 92, "how": "Finger oximeter, still, 30 s.", "tip": {"below": "Sit upright, breathe slowly, re-measure; check cabin O₂/CO₂; report under 92%"}},
  {"key": "resp", "label": "Respiratory rate", "unit": "/min", "system": "Respiratory", "lo": 4, "hi": 50, "sd": 2, "dir": "b", "redLow": 8, "redHigh": 24, "how": "Count breaths for 60 s at rest."},
  {"key": "sleep", "label": "Sleep last night", "unit": "h", "system": "Sleep", "lo": 0, "hi": 16, "sd": 0.8, "dir": "l", "redLow": 4, "how": "Wearable or sleep log.", "tip": {"below": "Fixed lights-out, dim blue light 2 h before bed, no caffeine after midday, quieter cabin"}},
  {"key": "slq", "label": "Sleep quality 1–5", "unit": "pts", "system": "Sleep", "lo": 1, "hi": 5, "sd": 0.7, "dir": "l", "how": "Rate how rested you feel (5 = fully)."},
  {"key": "mood", "label": "Mood 1–5", "unit": "pts", "system": "Mind", "lo": 1, "hi": 5, "sd": 0.7, "dir": "l", "how": "5 = excellent.", "tip": {"below": "Call family or crew, get bright light, exercise, talk to ARGOS"}},
  {"key": "stress", "label": "Perceived stress 1–5", "unit": "pts", "system": "Mind", "lo": 1, "hi": 5, "sd": 0.7, "dir": "h", "how": "5 = overwhelming.", "tip": {"above": "Private time, 5 min slow breathing, call home, exercise, share the load with crew"}},
  {"key": "energy", "label": "Energy 1–5", "unit": "pts", "system": "Mind", "lo": 1, "hi": 5, "sd": 0.7, "dir": "l", "how": "5 = full energy.", "tip": {"below": "Sleep, eat to target, hydrate, 20 min easy exercise"}},
  {"key": "cohes", "label": "Team cohesion 1–5", "unit": "pts", "system": "Mind", "lo": 1, "hi": 5, "sd": 0.7, "dir": "l", "how": "How connected you feel to the crew."},
  {"key": "priv", "label": "Privacy 1–5", "unit": "pts", "system": "Mind", "lo": 1, "hi": 5, "sd": 0.7, "dir": "l", "how": "Enough personal space and quiet time?"},
  {"key": "motiv", "label": "Motivation 1–5", "unit": "pts", "system": "Mind", "lo": 1, "hi": 5, "sd": 0.7, "dir": "l", "how": "Drive for today’s tasks."},
  {"key": "grip", "label": "Grip strength", "unit": "kg", "system": "Muscle", "lo": 5, "hi": 100, "sd": 3, "dir": "l", "how": "Hand dynamometer, best of 3, weekly.", "tip": {"below": "Add resistance sessions, protein with meals, re-test weekly"}},
  {"key": "resist", "label": "Resistance exercise", "unit": "min", "system": "Muscle", "lo": 0, "hi": 300, "sd": 20, "dir": "l", "flag": "B", "how": "Minutes of loaded exercise today.", "tip": {"below": "Add a session: aim for about 1.5 h/day total exercise"}},
  {"key": "aero", "label": "Aerobic exercise", "unit": "min", "system": "Muscle", "lo": 0, "hi": 300, "sd": 20, "dir": "l", "flag": "B", "how": "Minutes of cardio today.", "tip": {"below": "Add a session: aim for about 1.5 h/day total exercise"}},
  {"key": "back", "label": "Back/hip pain 0–10", "unit": "pts", "system": "Bone", "lo": 0, "hi": 10, "sd": 1, "dir": "h", "how": "0 = none, 10 = worst.", "tip": {"above": "Loaded resistance work, stretching; report if above 5/10 or spreading"}},
  {"key": "height", "label": "Height", "unit": "cm", "system": "Bone", "lo": 100, "hi": 230, "sd": 0.3, "dir": "h", "how": "Wall or tape measure, weekly, same time of day."},
  {"key": "vis", "label": "Vision blur 0–10", "unit": "pts", "system": "Eye", "lo": 0, "hi": 10, "sd": 1, "dir": "h", "how": "Read a near chart: 0 = sharp.", "tip": {"above": "Re-test the near chart, rest your eyes; report new blur or headache (SANS)"}},
  {"key": "diz", "label": "Dizziness / motion sickness 0–10", "unit": "pts", "system": "Vestibular", "lo": 0, "hi": 10, "sd": 1, "dir": "h", "how": "0 = none.", "tip": {"above": "Move slowly, avoid critical tasks, hydrate, log recovery time"}},
  {"key": "temp", "label": "Body temperature", "unit": "°C", "system": "Immune", "lo": 33, "hi": 42, "sd": 0.3, "dir": "h", "redHigh": 38, "how": "Oral or ear thermometer.", "tip": {"above": "Hydrate, rest, re-measure in 1 h; report 38 °C or more"}},
  {"key": "crp", "label": "CRP (blood, optional)", "unit": "mg/L", "system": "Immune", "lo": 0, "hi": 300, "sd": 1, "dir": "h", "redHigh": 10, "how": "Finger-prick test if available."},
  {"key": "sym", "label": "Immune symptoms 0–10", "unit": "pts", "system": "Immune", "lo": 0, "hi": 10, "sd": 1, "dir": "h", "how": "Cold sores, rash, allergy, infection signs.", "tip": {"above": "Log symptoms, disinfect surfaces, limit close contact"}},
  {"key": "wt", "label": "Body mass", "unit": "kg", "system": "Metabolic", "lo": 30, "hi": 250, "sd": 0.6, "dir": "b", "how": "Scale or mass device, weekly.", "tip": {"above": "Check calories against exercise", "below": "Eat to target, resistance exercise to protect muscle"}},
  {"key": "kcal", "label": "Calories eaten", "unit": "kcal", "system": "Metabolic", "lo": 0, "hi": 7000, "sd": 300, "dir": "l", "flag": "B", "how": "Food log total.", "tip": {"below": "Eat to your calorie target, protein with each meal"}},
  {"key": "fluid", "label": "Fluid intake", "unit": "L", "system": "Metabolic", "lo": 0, "hi": 8, "sd": 0.4, "dir": "l", "flag": "B", "how": "Total drinks today.", "tip": {"below": "Drink 500 ml now and spread the rest over the day"}},
  {"key": "urine", "label": "Urine colour 1–8", "unit": "pts", "system": "Metabolic", "lo": 1, "hi": 8, "sd": 1, "dir": "h", "redHigh": 6, "how": "1 = pale straw … 8 = dark amber.", "tip": {"above": "Drink until pale straw colour, aim for 2–3 L/day"}},
  {"key": "dose", "label": "Radiation dose today", "unit": "mSv", "system": "Radiation", "lo": 0, "hi": 50, "sd": 0.1, "dir": "h", "flag": "X", "how": "Personal dosimeter reading.", "tip": {"above": "Check the dosimeter; go to the shielded area in a solar event"}},
  {"key": "co2", "label": "Cabin CO₂", "unit": "ppm", "system": "Habitat", "lo": 300, "hi": 20000, "sd": 300, "dir": "h", "flag": "X", "how": "Cabin monitor.", "tip": {"above": "Check scrubbers and ventilation; report if headache"}},
  {"key": "noise", "label": "Cabin noise", "unit": "dB", "system": "Habitat", "lo": 20, "hi": 140, "sd": 3, "dir": "h", "flag": "X", "how": "Sound meter.", "tip": {"above": "Ear protection, find the source"}},
];

// ── Sensor ring (specs/02 §2.4b) ─────────────────────────────────────────
// Indicators from new wearable sensors: microneedles, electronic skin, sweat patches, wearable ultrasound,
// breath and skin-VOC sensors, Raman/NIR. Trend only: each is compared with the person's own baseline,
// has no red-flag limits and is left out of the deviation index and readiness.
// `lo`/`hi`/`sd` and cadences are ARGUS working assumptions for baseline maths (specs/02 §2.4b), not
// clinical reference ranges. Sources are cited per indicator in `sensor.sources`.

const SWEAT = 'Sweat levels do not necessarily match blood levels. Trend against your own baseline only.';
const RESEARCH = 'Research sensor: not a diagnosis.';
const SCORE = 'Shape-change score: 0 = matches your own pre-flight template, 10 = very different.';

// Source: SRC-028, SRC-110, SRC-111 (glu) · SRC-110, SRC-111 (lac) · SRC-110 (na, k) · SRC-112 (cl, ph, swr)
// Source: SRC-113 (cort) · SRC-114 (ua) · SRC-115, SRC-116 (urea) · SRC-116 (nh4, ph) · SRC-117 (drug)
// Source: SRC-119 (co, sv, ef) · SRC-118 (cbp, apw, vd) · SRC-020, SRC-022 (ecg) · SRC-120 (svoc) · SRC-121 (bvoc)
// Source: SRC-122 (ace, iso) · SRC-123 (eda) · SRC-124 (strn) · SRC-125 (rmn)
export const SENSOR_INDICATORS: readonly Indicator[] = [
  // Biochemistry: microneedles and electronic skin
  { key: 'glu', label: 'Glucose (interstitial)', unit: 'mg/dL', system: 'Metabolic', lo: 20, hi: 500, sd: 15, dir: 'b',
    how: 'Continuous glucose sensor or microneedle patch on the upper arm; reads on its own.',
    tip: { above: 'Check what and when you ate; light exercise helps', below: 'Eat fast carbohydrate and re-check in 15 min' },
    sensor: { sample: 'Interstitial fluid', device: 'Microneedle patch / CGM', cadence: 'every 5 min', readiness: 'cleared', sources: ['SRC-028', 'SRC-110', 'SRC-111'],
      caveat: 'Interstitial glucose lags blood by several minutes. Thresholds live in the HUD triage, not here.' } },
  { key: 'lac', label: 'Lactate', unit: 'mmol/L', system: 'Muscle', lo: 0, hi: 30, sd: 1, dir: 'h',
    how: 'Microneedle or sweat patch during and after exercise.',
    tip: { above: 'Ease the exercise load and recover before the next session' },
    sensor: { sample: 'Interstitial fluid', device: 'Microneedle patch / electronic skin', cadence: 'every 1 min while worn', readiness: 'research', sources: ['SRC-110', 'SRC-111'], caveat: RESEARCH } },
  { key: 'na', label: 'Sodium (sweat)', unit: 'mmol/L', system: 'Metabolic', lo: 5, hi: 150, sd: 8, dir: 'b',
    how: 'Electronic-skin sweat sensor during exercise.',
    tip: { above: 'Replace salt and fluid lost during exercise', below: 'Check fluid intake; avoid drinking far more than you sweat' },
    sensor: { sample: 'Sweat', device: 'Electronic skin', cadence: 'every 1 min while sweating', readiness: 'research', sources: ['SRC-110'], caveat: SWEAT } },
  { key: 'k', label: 'Potassium (sweat)', unit: 'mmol/L', system: 'Metabolic', lo: 1, hi: 30, sd: 1, dir: 'b',
    how: 'Electronic-skin sweat sensor during exercise.',
    sensor: { sample: 'Sweat', device: 'Electronic skin', cadence: 'every 1 min while sweating', readiness: 'research', sources: ['SRC-110'], caveat: SWEAT } },
  { key: 'cl', label: 'Chloride (sweat)', unit: 'mmol/L', system: 'Metabolic', lo: 5, hi: 150, sd: 8, dir: 'b',
    how: 'Colour-changing sweat patch; photograph it with the tablet.',
    sensor: { sample: 'Sweat', device: 'Sweat patch (colorimetric)', cadence: 'per exercise session', readiness: 'research', sources: ['SRC-112'], caveat: SWEAT } },
  { key: 'cort', label: 'Cortisol (sweat)', unit: 'ng/mL', system: 'Mind', lo: 0, hi: 500, sd: 15, dir: 'h',
    how: 'Cortisol sweat patch, same time of day (cortisol peaks after waking).',
    tip: { above: 'Protect sleep, 5 min slow breathing, share the load with crew' },
    sensor: { sample: 'Sweat', device: 'Biochemical cortisol sensor', cadence: 'daily, same time', readiness: 'research', sources: ['SRC-113'], caveat: SWEAT } },
  { key: 'ua', label: 'Uric acid (sweat)', unit: 'µmol/L', system: 'Metabolic', lo: 0, hi: 300, sd: 10, dir: 'h',
    how: 'Laser-engraved sweat sensor / electronic skin.',
    tip: { above: 'Hydrate; check protein-heavy meals' },
    sensor: { sample: 'Sweat', device: 'Electronic skin', cadence: 'per exercise session', readiness: 'research', sources: ['SRC-114'], caveat: SWEAT } },
  { key: 'urea', label: 'Urea (sweat)', unit: 'mmol/L', system: 'Metabolic', lo: 0, hi: 100, sd: 3, dir: 'h',
    how: 'SERS (Raman) sweat patch or electronic skin.',
    sensor: { sample: 'Sweat', device: 'SERS patch / electronic skin', cadence: 'per exercise session', readiness: 'research', sources: ['SRC-115', 'SRC-116'], caveat: SWEAT } },
  { key: 'nh4', label: 'Ammonium (sweat)', unit: 'mmol/L', system: 'Metabolic', lo: 0, hi: 20, sd: 0.5, dir: 'h',
    how: 'Electronic-skin sweat sensor during prolonged exercise.',
    sensor: { sample: 'Sweat', device: 'Electronic skin', cadence: 'every 1 min while sweating', readiness: 'research', sources: ['SRC-116'], caveat: SWEAT } },
  { key: 'ph', label: 'Local pH (sweat)', unit: 'pH', system: 'Metabolic', lo: 3, hi: 9, sd: 0.3, dir: 'b',
    how: 'Sweat patch or electronic skin.',
    sensor: { sample: 'Sweat', device: 'Sweat patch / electronic skin', cadence: 'per exercise session', readiness: 'research', sources: ['SRC-112', 'SRC-116'], caveat: SWEAT } },
  { key: 'drug', label: 'Drug level (vs target)', unit: '% target', system: 'Metabolic', lo: 0, hi: 300, sd: 15, dir: 'b',
    how: 'Microneedle drug sensor while taking a monitored medicine; 100% = the prescribed target level.',
    tip: { above: 'Do not take the next dose early; tell the flight surgeon', below: 'Check the last dose time; tell the flight surgeon' },
    sensor: { sample: 'Interstitial fluid', device: 'Microneedle drug sensor', cadence: 'every 5 min while dosing', readiness: 'research', sources: ['SRC-117'],
      caveat: 'Research sensor. Never change a dose from this reading alone.' } },

  // Heart and vessels: wearable ultrasound and Bio-Monitor
  { key: 'co', label: 'Cardiac output', unit: 'L/min', system: 'Cardio', lo: 1, hi: 30, sd: 0.4, dir: 'b',
    how: 'Wearable cardiac ultrasound patch on the chest, at rest.',
    sensor: { sample: 'Ultrasound', device: 'Wearable cardiac ultrasound', cadence: 'daily, at rest', readiness: 'research', sources: ['SRC-119'], caveat: RESEARCH } },
  { key: 'sv', label: 'Stroke volume', unit: 'mL', system: 'Cardio', lo: 20, hi: 200, sd: 6, dir: 'b',
    how: 'Wearable cardiac ultrasound patch on the chest, at rest.',
    tip: { below: 'Drink 500 ml and re-check; report dizziness on standing' },
    sensor: { sample: 'Ultrasound', device: 'Wearable cardiac ultrasound', cadence: 'daily, at rest', readiness: 'research', sources: ['SRC-119'], caveat: RESEARCH } },
  { key: 'ef', label: 'Ejection fraction', unit: '%', system: 'Cardio', lo: 10, hi: 85, sd: 3, dir: 'l',
    how: 'Wearable cardiac ultrasound patch on the chest, at rest.',
    tip: { below: 'Re-check at rest; report to the flight surgeon if it stays low' },
    sensor: { sample: 'Ultrasound', device: 'Wearable cardiac ultrasound', cadence: 'daily, at rest', readiness: 'research', sources: ['SRC-119'], caveat: RESEARCH } },
  { key: 'cbp', label: 'Central systolic BP', unit: 'mmHg', system: 'Cardio', lo: 60, hi: 250, sd: 8, dir: 'b',
    how: 'Ultrasound patch over the neck artery, seated 5 min.',
    sensor: { sample: 'Ultrasound', device: 'Ultrasound patch (USoP)', cadence: 'daily, seated', readiness: 'research', sources: ['SRC-118'], caveat: RESEARCH } },
  { key: 'apw', label: 'Arterial pulse waveform', unit: 'score', system: 'Cardio', lo: 0, hi: 10, sd: 1, dir: 'h',
    how: `Ultrasound patch over the neck artery. ${SCORE}`,
    sensor: { sample: 'Ultrasound', device: 'Ultrasound patch (USoP)', cadence: 'daily, seated', readiness: 'research', sources: ['SRC-118'], caveat: RESEARCH } },
  { key: 'vd', label: 'Jugular vein diameter', unit: 'mm', system: 'Cardio', lo: 2, hi: 25, sd: 1, dir: 'b',
    how: 'Ultrasound patch on the neck, lying still. Tracks the head-ward fluid shift in weightlessness.',
    sensor: { sample: 'Ultrasound', device: 'Ultrasound patch', cadence: 'daily, same posture', readiness: 'research', sources: ['SRC-118'], caveat: RESEARCH } },
  { key: 'ecg', label: 'ECG waveform', unit: 'score', system: 'Cardio', lo: 0, hi: 10, sd: 1, dir: 'h',
    how: `Bio-Monitor style ECG electrodes, 5 min at rest. ${SCORE}`,
    tip: { above: 'Rest and repeat; report palpitations, chest pain or fainting at once' },
    sensor: { sample: 'ECG electrodes', device: 'Bio-Monitor', cadence: 'continuous; scored daily', readiness: 'flight-proven', sources: ['SRC-020', 'SRC-022'],
      caveat: 'The score flags change, not a rhythm diagnosis. Symptoms always go to the flight surgeon.' } },

  // Chemical signatures: A-Patch and breath
  { key: 'svoc', label: 'Skin VOC pattern', unit: 'score', system: 'Immune', lo: 0, hi: 10, sd: 1, dir: 'h',
    how: `A-Patch on the skin collects volatile compounds. ${SCORE}`,
    sensor: { sample: 'Skin headspace', device: 'A-Patch', cadence: 'every 1 h while worn', readiness: 'research', sources: ['SRC-120'], caveat: RESEARCH } },
  { key: 'bvoc', label: 'Breath VOC pattern', unit: 'score', system: 'Respiratory', lo: 0, hi: 10, sd: 1, dir: 'h',
    how: `Breathe into the electronic nose for 30 s, before eating. ${SCORE}`,
    sensor: { sample: 'Breath', device: 'Electronic nose', cadence: 'daily, fasting', readiness: 'research', sources: ['SRC-121'], caveat: RESEARCH } },
  { key: 'ace', label: 'Breath acetone', unit: 'ppb', system: 'Metabolic', lo: 50, hi: 10000, sd: 150, dir: 'h',
    how: 'Breath analyser, morning, before eating. Rises when the body burns fat (fasting, low carbohydrate).',
    tip: { above: 'Eat to your calorie target, include carbohydrate' },
    sensor: { sample: 'Breath', device: 'Breath analyser', cadence: 'daily, fasting', readiness: 'research', sources: ['SRC-122'], caveat: RESEARCH } },
  { key: 'iso', label: 'Breath isoprene', unit: 'ppb', system: 'Respiratory', lo: 10, hi: 1000, sd: 30, dir: 'b',
    how: 'Breath analyser, at rest (exercise changes it within minutes).',
    sensor: { sample: 'Breath', device: 'Breath analyser', cadence: 'daily, at rest', readiness: 'research', sources: ['SRC-122'], caveat: RESEARCH } },

  // Skin, sweat and spectroscopy
  { key: 'eda', label: 'Skin conductance', unit: 'µS', system: 'Mind', lo: 0.05, hi: 60, sd: 1.5, dir: 'h',
    how: 'Electronic skin or wrist electrodes, seated 5 min.',
    tip: { above: '5 min slow breathing, a short break, talk to crew or ARGUS' },
    sensor: { sample: 'Skin', device: 'Electronic skin', cadence: 'continuous; daily resting level', readiness: 'research', sources: ['SRC-123'],
      caveat: 'Also changes with cabin temperature and humidity.' } },
  { key: 'swr', label: 'Sweat rate', unit: 'mg/cm²/min', system: 'Metabolic', lo: 0, hi: 5, sd: 0.1, dir: 'h',
    how: 'Microfluidic sweat patch on the forearm during exercise.',
    tip: { above: 'Drink to replace what you sweat; check cabin temperature' },
    sensor: { sample: 'Sweat', device: 'Sweat patch (microfluidic)', cadence: 'per exercise session', readiness: 'research', sources: ['SRC-112'], caveat: RESEARCH } },
  { key: 'strn', label: 'Skin strain / pressure', unit: 'kPa', system: 'Muscle', lo: 0, hi: 100, sd: 2, dir: 'h',
    how: 'Electronic-skin pressure sensor at a pressure point (suit, restraint or sleeping-bag contact).',
    tip: { above: 'Relieve the pressure point; check suit and restraint fit' },
    sensor: { sample: 'Skin', device: 'Electronic skin', cadence: 'continuous; daily peak', readiness: 'research', sources: ['SRC-124'], caveat: RESEARCH } },
  { key: 'rmn', label: 'Tissue spectral signature', unit: 'score', system: 'Immune', lo: 0, hi: 10, sd: 1, dir: 'h',
    how: `Raman / NIR probe on the same skin spot each week. ${SCORE}`,
    sensor: { sample: 'Optical', device: 'Raman / NIR spectroscopy', cadence: 'weekly, same spot', readiness: 'research', sources: ['SRC-125'], caveat: RESEARCH } },
];

/** Every indicator: the prototype ring plus the sensor ring. */
export const ALL_INDICATORS: readonly Indicator[] = [...INDICATORS, ...SENSOR_INDICATORS];

/** Lookup by key (prototype `IM`). */
export const INDICATOR_BY_KEY: Readonly<Record<string, Indicator>> = Object.fromEntries(
  ALL_INDICATORS.map((i) => [i.key, i])
);

/** Indicators sorted by their body system's position in the ring (prototype `ORD`). */
export const RING_ORDER: readonly Indicator[] = [...INDICATORS].sort(
  (a, b) => BODY_SYSTEMS.indexOf(a.system) - BODY_SYSTEMS.indexOf(b.system)
);

/** Sensor-ring indicators in the same body-system order (inner ring). */
export const SENSOR_RING_ORDER: readonly Indicator[] = [...SENSOR_INDICATORS].sort(
  (a, b) => BODY_SYSTEMS.indexOf(a.system) - BODY_SYSTEMS.indexOf(b.system)
);
