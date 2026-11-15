/**
 * ARGUS — Extended telemetry panel and extra scenarios (mock-data expansion).
 *
 * 1. Adds 12 more daily parameters (see EXTRA_METRICS) to each of the four original scenarios.
 * 2. Derives three more scenarios (dehydration, sleep loss, deconditioning) from the nominal template by
 *    re-tuning the metrics each story affects; every other metric keeps its nominal series.
 *
 * Every scenario therefore carries the same 31 parameters, so the simulator, the database roll-up and the HUD
 * all see a complete panel whichever scenario a crew member is on.
 */

import type { BodyZoneId, ScenarioDefinition, ScenarioId, VitalSignReading } from '../types/argus';
import { formatFlightNormBadge } from '../utils/triageEngine';
import { build30DaySeries } from './seriesBuilder';

type BaseScenarioId = 'nominal' | 'unexplained_fatigue' | 'sans_alert' | 'high_co2' | 'solar_storm';
type NewScenarioId = Exclude<ScenarioId, BaseScenarioId>;

/** [start, end] of the 30-day series. Late-mission steepening is applied by build30DaySeries when |Δ| > 0.5. */
type Track = [start: number, end: number];

interface ExtraMetric {
  metricId: string;
  zone: BodyZoneId;
  label: string;
  unit: string;
  precision: number;
  wave: number;
  plainDescription: string;
  /** Series per scenario; any scenario not listed uses `nominal`. */
  tracks: { nominal: Track } & Partial<Record<ScenarioId, Track>>;
}

export const EXTRA_METRICS: ExtraMetric[] = [
  {
    metricId: 'headache_severity', zone: 'neuro', label: 'Headache Severity', unit: '/10', precision: 1, wave: 0.2,
    plainDescription: 'Evening watch tap-survey (0 = none, 10 = worst). Persistent headache is an early marker of raised intracranial pressure and high CO₂.',
    tracks: { nominal: [0.6, 0.8], unexplained_fatigue: [0.8, 2.6], sans_alert: [1.0, 5.2], high_co2: [1.0, 6.4], solar_storm: [0.8, 2.4], dehydration: [0.8, 3.4], sleep_loss: [1.0, 3.8], deconditioning: [0.8, 1.2] },
  },
  {
    metricId: 'hyperopic_shift', zone: 'neuro', label: 'Near-Vision Hyperopic Shift', unit: 'D', precision: 2, wave: 0.02,
    plainDescription: 'Change in near-vision prescription versus pre-flight. Globe flattening from SANS shifts focus toward farsightedness.',
    tracks: { nominal: [0.05, 0.15], unexplained_fatigue: [0.05, 0.6], sans_alert: [0.1, 1.05], high_co2: [0.05, 0.3], solar_storm: [0.05, 0.2], sleep_loss: [0.05, 0.2] },
  },
  {
    metricId: 'diastolic_bp', zone: 'cardio', label: 'Diastolic Blood Pressure', unit: 'mmHg', precision: 0, wave: 1,
    plainDescription: 'Pressure in the arteries between beats, from the watch spot readings. Pairs with systolic pressure to judge vascular tone and volume status.',
    tracks: { nominal: [77, 76], unexplained_fatigue: [77, 80], sans_alert: [78, 82], high_co2: [78, 88], solar_storm: [77, 80], dehydration: [76, 58], sleep_loss: [77, 84], deconditioning: [77, 79] },
  },
  {
    metricId: 'sleep_resp_rate', zone: 'cardio', label: 'Sleeping Respiration Rate', unit: 'br/min', precision: 1, wave: 0.3,
    plainDescription: 'Average breathing rate overnight from the watch. Rises with CO₂ load, fever, dehydration and sleep fragmentation.',
    tracks: { nominal: [14.5, 14.2], unexplained_fatigue: [14.5, 16], sans_alert: [14.5, 15.5], high_co2: [14.5, 20.5], solar_storm: [14.6, 17], dehydration: [14.5, 19.5], sleep_loss: [14.5, 17.5], deconditioning: [14.5, 14.8] },
  },
  {
    metricId: 'vo2_max', zone: 'cardio', label: 'Aerobic Capacity (VO₂max)', unit: 'mL/kg/min', precision: 1, wave: 0.5,
    plainDescription: 'Estimated from the cycle ergometer sub-maximal test. Falls with cardiovascular deconditioning and low plasma volume.',
    tracks: { nominal: [46, 45], unexplained_fatigue: [46, 42], sans_alert: [46, 41], high_co2: [46, 39], solar_storm: [46, 41], dehydration: [46, 36], sleep_loss: [46, 40], deconditioning: [46, 31] },
  },
  {
    metricId: 'hemoglobin', zone: 'cardio', label: 'Hemoglobin', unit: 'g/dL', precision: 1, wave: 0.1,
    plainDescription: 'Oxygen-carrying protein from the blood analyzer. Spaceflight "anemia" lowers it; dehydration concentrates it.',
    tracks: { nominal: [14.6, 14.1], unexplained_fatigue: [14.6, 13.6], sans_alert: [14.6, 13.4], high_co2: [14.6, 13.6], solar_storm: [14.6, 12.8], dehydration: [14.6, 17.5], sleep_loss: [14.6, 14.3], deconditioning: [14.6, 13.0] },
  },
  {
    metricId: 'urine_sg', zone: 'cardio', label: 'Urine Specific Gravity', unit: 'SG', precision: 3, wave: 0.001,
    plainDescription: 'Concentration of the first-void urine sample. High values mean low hydration and raise renal-stone risk.',
    tracks: { nominal: [1.014, 1.015], unexplained_fatigue: [1.014, 1.018], sans_alert: [1.014, 1.018], high_co2: [1.014, 1.017], solar_storm: [1.014, 1.019], dehydration: [1.014, 1.032], sleep_loss: [1.014, 1.017] },
  },
  {
    metricId: 'grip_strength', zone: 'musculo', label: 'Grip Strength', unit: 'kg', precision: 1, wave: 0.8,
    plainDescription: 'Best of three hand-dynamometer squeezes. A cheap, sensitive proxy for whole-body muscle strength.',
    tracks: { nominal: [46, 44.5], unexplained_fatigue: [46, 43], sans_alert: [46, 42], high_co2: [46, 41], solar_storm: [46, 40], dehydration: [46, 38], sleep_loss: [46, 39], deconditioning: [46, 26] },
  },
  {
    metricId: 'body_mass_delta', zone: 'metabolic', label: 'Body Mass Change', unit: '%', precision: 1, wave: 0.15,
    plainDescription: 'Body mass versus pre-flight from the calibrated mass device. Fast drops signal fluid loss or under-eating, slow drops lean-mass loss.',
    tracks: { nominal: [0, -1.4], unexplained_fatigue: [0, -2.0], sans_alert: [0, -2.2], high_co2: [0, -2.0], solar_storm: [0, -2.6], dehydration: [0, -5.6], sleep_loss: [0, -1.8], deconditioning: [0, -4.2] },
  },
  {
    metricId: 'crp', zone: 'immune', label: 'C-Reactive Protein', unit: 'mg/L', precision: 1, wave: 0.2,
    plainDescription: 'High-sensitivity inflammation marker from the blood analyzer. Climbs with infection, radiation exposure and chronic sleep loss.',
    tracks: { nominal: [1.1, 1.4], unexplained_fatigue: [1.1, 2.6], sans_alert: [1.1, 2.6], high_co2: [1.1, 2.8], solar_storm: [1.1, 12.5], dehydration: [1.1, 2.4], sleep_loss: [1.1, 4.6], deconditioning: [1.1, 2.0] },
  },
  {
    metricId: 'cortisol', zone: 'behavioral', label: 'Morning Cortisol', unit: 'µg/dL', precision: 1, wave: 0.6,
    plainDescription: 'Salivary stress hormone, measured on waking. Sustained elevation reflects physiological stress and poor recovery.',
    tracks: { nominal: [12, 12.8], unexplained_fatigue: [12, 17], sans_alert: [12, 14.6], high_co2: [12, 17.4], solar_storm: [12, 21], dehydration: [12, 16.5], sleep_loss: [12, 24.8], deconditioning: [12, 15] },
  },
  {
    metricId: 'reaction_time', zone: 'behavioral', label: 'Mean Reaction Time', unit: 'ms', precision: 0, wave: 5,
    plainDescription: 'Mean response time on the 3-minute watch Psychomotor Vigilance Test. Slows with fatigue, high CO₂ and stress.',
    tracks: { nominal: [255, 262], unexplained_fatigue: [255, 312], sans_alert: [255, 290], high_co2: [255, 335], solar_storm: [255, 318], dehydration: [255, 310], sleep_loss: [255, 395], deconditioning: [255, 275] },
  },
];

const sign = (v: number) => (v >= 0 ? '+' : '');
const roundTo = (v: number, p: number) => Math.round(v * 10 ** p) / 10 ** p;

function extraReading(def: ExtraMetric, scenarioId: ScenarioId): VitalSignReading {
  const [start, end] = def.tracks[scenarioId] ?? def.tracks.nominal;
  const history = build30DaySeries(start, end, def.precision, def.wave);
  const diff = roundTo(end - start, def.precision);
  return {
    metricId: def.metricId as VitalSignReading['metricId'],
    label: def.label,
    unit: def.unit,
    currentValue: end,
    deltaFromBaseline: `${sign(diff)}${diff} ${def.unit} vs Day 1`,
    flightNormLabel: formatFlightNormBadge(def.metricId, def.unit),
    plainDescription: def.plainDescription,
    history,
  };
}

/** [start, end, precision] overrides of EXISTING metrics for the three derived scenarios. */
type Override = [start: number, end: number, precision: number];

interface DerivedScenario {
  label: string;
  shortTag: string;
  description: string;
  recommendedFocusZone: BodyZoneId;
  overrides: Record<string, Override>;
}

const DERIVED: Record<NewScenarioId, DerivedScenario> = {
  dehydration: {
    label: 'Dehydration & Fluid-Balance Deficit',
    shortTag: 'DEHYDRATION',
    description:
      'Water intake falls well below the NASA-STD-3001 baseline: plasma volume contracts, heart rate climbs, blood pressure sags and urine concentrates.',
    recommendedFocusZone: 'cardio',
    overrides: {
      hydration_intake: [2.8, 1.5, 1],
      resting_hr: [62, 88, 0],
      hrv_rmssd: [56, 33, 0],
      systolic_bp: [119, 92, 0],
      caloric_intake: [2650, 2050, 0],
      core_temp: [36.9, 37.4, 2],
      mood_index: [8.1, 6.4, 1],
    },
  },
  sleep_loss: {
    label: 'Circadian Disruption & Sleep Debt',
    shortTag: 'SLEEP LOSS',
    description:
      'Shifted work schedule and noise fragment sleep: efficiency and duration collapse, vigilance lapses climb and stress hormones rise.',
    recommendedFocusZone: 'behavioral',
    overrides: {
      sleep_eff: [88, 64, 0],
      daily_sleep_hours: [7.4, 4.6, 1],
      pvt_lapses: [1, 8, 0],
      mood_index: [8.0, 4.6, 1],
      hrv_rmssd: [56, 36, 0],
      resting_hr: [62, 75, 0],
      blood_glucose: [90, 118, 0],
      systolic_bp: [119, 127, 0],
    },
  },
  deconditioning: {
    label: 'Musculoskeletal Deconditioning',
    shortTag: 'DECONDITIONING',
    description:
      'Resistive exercise is skipped for weeks: bone density and muscle strength fall, aerobic capacity drops and energy intake lags.',
    recommendedFocusZone: 'musculo',
    overrides: {
      ared_load: [24, 9, 1],
      bmd_delta: [-0.3, -1.6, 2],
      caloric_intake: [2650, 2050, 0],
      resting_hr: [61, 70, 0],
      hrv_rmssd: [58, 47, 0],
      blood_glucose: [90, 112, 0],
      mood_index: [8.0, 6.6, 1],
    },
  },
};

function retune(reading: VitalSignReading, [start, end, precision]: Override, waveFor: number): VitalSignReading {
  const diff = roundTo(end - start, precision);
  return {
    ...reading,
    currentValue: end,
    deltaFromBaseline: `${sign(diff)}${diff} ${reading.unit} vs Day 1`,
    history: build30DaySeries(start, end, precision, waveFor),
  };
}

/** Day-to-day wobble for overridden series, proportional to the size of the metric. */
const waveFor = (r: VitalSignReading, [start, end]: Override) => Math.max(Math.abs(end - start), Math.abs(start) * 0.2) * 0.04;

function withExtras(zones: ScenarioDefinition['zones'], scenarioId: ScenarioId): ScenarioDefinition['zones'] {
  const out = { ...zones };
  for (const def of EXTRA_METRICS) out[def.zone] = [...out[def.zone], extraReading(def, scenarioId)];
  return out;
}

export function extendScenarios(base: Record<BaseScenarioId, ScenarioDefinition>): Record<ScenarioId, ScenarioDefinition> {
  const result = {} as Record<ScenarioId, ScenarioDefinition>;
  for (const id of Object.keys(base) as BaseScenarioId[]) {
    result[id] = { ...base[id], zones: withExtras(base[id].zones, id) };
  }
  for (const id of Object.keys(DERIVED) as NewScenarioId[]) {
    const spec = DERIVED[id];
    const zones = {} as ScenarioDefinition['zones'];
    for (const zone of Object.keys(base.nominal.zones) as BodyZoneId[]) {
      zones[zone] = base.nominal.zones[zone].map((r) => {
        const o = spec.overrides[r.metricId];
        return o ? retune(r, o, waveFor(r, o)) : r;
      });
    }
    result[id] = {
      id,
      label: spec.label,
      shortTag: spec.shortTag,
      description: spec.description,
      recommendedFocusZone: spec.recommendedFocusZone,
      zones: withExtras(zones, id),
    };
  }
  return result;
}
