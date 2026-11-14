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

/** Lookup by key (prototype `IM`). */
export const INDICATOR_BY_KEY: Readonly<Record<string, Indicator>> = Object.fromEntries(
  INDICATORS.map((i) => [i.key, i])
);

/** Indicators sorted by their body system's position in the ring (prototype `ORD`). */
export const RING_ORDER: readonly Indicator[] = [...INDICATORS].sort(
  (a, b) => BODY_SYSTEMS.indexOf(a.system) - BODY_SYSTEMS.indexOf(b.system)
);
