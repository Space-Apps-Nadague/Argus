/**
 * ARGUS — Which exercises today, from the crew member's metrics (specs/02-ui-dashboard.md §2.6 Training)
 * Deterministic rules on the latest readings, using the same gravity-specific thresholds as triage.
 * Each out-of-range metric changes the plan in up to four ways:
 *  - ADDS exercises that answer it (e.g. low bone density → bone loading);
 *  - SKIPS exercises that are risky with it (e.g. high blood pressure → no heavy lifts or plank);
 *  - CAPS the intensity (full → reduced → light);
 *  - adds a NOTE to follow first (e.g. eat or drink before training).
 * Exercises come from the set that works where the crew member is (microgravity vs gravity).
 * Every rule cites its source (SOURCES.md).
 */

import type { BodyZoneId, GravityEnvironment, TriageStatus, VitalSignReading } from '../../types/argus';
import { evaluateMetricStatus, getMetricThreshold } from '../../utils/triageEngine';
import { exercisesFor, isMicrogravity, type ExerciseId, type TrainingIntensity } from './exercises';

export interface TrainingReason {
  metricId: string;
  text: string;
  status: TriageStatus;
}

export interface TrainingPlan {
  /** 'required': metrics call for training today. 'optional': all good, maintenance only. 'unsafe': do not exercise now. */
  state: 'required' | 'optional' | 'unsafe';
  reasons: TrainingReason[];
  exercises: ExerciseId[];
  /** How hard to train today (ignored when state is 'unsafe'). */
  intensity: TrainingIntensity;
  /** Why the intensity is lowered; empty for 'full'. */
  intensityReasons: string[];
  /** Exercises to skip today (they stay in the library for reference), with the reason for each. */
  skip: ExerciseId[];
  skipReasons: Partial<Record<ExerciseId, string>>;
  /** Things to do before or during training (eat first, drink first, breathe out on every lift). */
  notes: string[];
}

const ZONE_NAME: Record<BodyZoneId, string> = {
  neuro: 'Neuro-ocular',
  cardio: 'Cardiovascular',
  musculo: 'Musculoskeletal',
  metabolic: 'Metabolic',
  immune: 'Immune',
  behavioral: 'Behavioral',
};

const RANK: Record<TrainingIntensity, number> = { full: 0, reduced: 1, light: 2 };
const lower = (a: TrainingIntensity, b: TrainingIntensity): TrainingIntensity => (RANK[b] > RANK[a] ? b : a);

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function latest(zones: Record<BodyZoneId, VitalSignReading[]>, metricId: string): VitalSignReading | undefined {
  for (const list of Object.values(zones)) {
    const r = list.find((m) => m.metricId === metricId);
    if (r) return r;
  }
  return undefined;
}

type Setting = 'micro' | 'gravity';
type Picks = Partial<Record<Setting, ExerciseId[]>>;

/** One metric rule: when it fires and what it does to the plan. */
interface MetricRule {
  id: string;
  /** Rules in the same group fire once (e.g. resting HR and HRV both mean a deconditioning heart). */
  group?: string;
  metricIds: string[];
  /** Which side of the nominal range triggers it. */
  side: 'low' | 'high';
  /** Only in this setting (default both). */
  only?: Setting;
  add?: Picks;
  skip?: ExerciseId[];
  skipWhy?: string;
  cap?: TrainingIntensity;
  note?: string;
  text: (r: VitalSignReading) => string;
}

const HEAVY_LIFTS: ExerciseId[] = ['aredDeadlift', 'aredSquat', 'plank'];

export const METRIC_RULES: MetricRule[] = [
  {
    // Source: SRC-090 (Lang 2004: ISS crews lose 0.9 %/month spine, 1.4–1.5 %/month hip); SRC-089 (ARED loads the skeleton)
    id: 'bone',
    metricIds: ['bmd_delta'],
    side: 'low',
    add: { micro: ['aredSquat', 'aredDeadlift', 'aredHeelRaise', 'treadmill'], gravity: ['squats', 'lunges', 'pushups'] },
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: bone density is dropping. Load the hips and spine.`,
  },
  {
    // Source: SRC-089 (ARED is the primary resistive countermeasure on the ISS)
    id: 'load',
    metricIds: ['ared_load'],
    side: 'low',
    add: { micro: ['aredSquat', 'aredDeadlift', 'aredHeelRaise'], gravity: ['squats', 'pushups', 'plank'] },
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}, below today's target. Add resistance work.`,
  },
  {
    // Source: SRC-089 (CEVIS and treadmill are the ISS aerobic countermeasures)
    id: 'heart',
    group: 'heart',
    metricIds: ['resting_hr'],
    side: 'high',
    add: { micro: ['cycle', 'treadmill'], gravity: ['cycle'] },
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: the heart is deconditioning. Add aerobic training.`,
  },
  {
    id: 'heart-hrv',
    group: 'heart',
    metricIds: ['hrv_rmssd'],
    side: 'low',
    add: { micro: ['cycle', 'treadmill'], gravity: ['cycle'] },
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: the heart is deconditioning. Add aerobic training.`,
  },
  {
    // Source: SRC-091 (MacDougall 1985: heavy lifts with breath-holding drove blood pressure to 320/250 mmHg)
    id: 'bp',
    metricIds: ['systolic_bp'],
    side: 'high',
    add: { micro: ['cycle'], gravity: ['cycle'] },
    skip: HEAVY_LIFTS,
    skipWhy: 'Blood pressure is high: heavy lifts and long holds push it much higher.',
    cap: 'reduced',
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: steady cycling instead of heavy lifting today.`,
  },
  {
    // Source: SRC-092 (Vaghefi 2021: resistance exercise spikes eye pressure, up to +26 mmHg);
    //         SRC-093 (Scott 2019: moderate exercise lowered eye pressure in a spaceflight analogue)
    id: 'eyes',
    metricIds: ['iop', 'onsd'],
    side: 'high',
    add: { micro: ['cycle'], gravity: ['cycle'] },
    skip: ['aredDeadlift', 'plank'],
    skipWhy: 'Eye pressure is high: maximal lifts and breath-holding holds raise it further.',
    cap: 'reduced',
    note: 'Breathe out on every lift; never hold your breath (it raises eye pressure).',
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit} (eye / optic nerve). Keep moving with moderate, steady exercise.`,
  },
  {
    // Source: SRC-094 (ADA 2016: under ~90 mg/dL take carbohydrate before exercise; exercise lowers high glucose)
    id: 'glucose-high',
    metricIds: ['blood_glucose'],
    side: 'high',
    add: { micro: ['cycle', 'treadmill'], gravity: ['cycle'] },
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: aerobic exercise helps bring it down.`,
  },
  {
    // Source: SRC-095 (ACSM 2007: dehydration over 2 % of body weight degrades performance)
    id: 'hydration',
    metricIds: ['hydration_intake'],
    side: 'low',
    skip: ['treadmill'],
    skipWhy: 'Fluid intake is low: skip the long, sweaty run today.',
    cap: 'reduced',
    note: 'Drink 400–600 mL of water before you start, and keep sipping.',
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: drink before training and keep it shorter.`,
  },
  {
    // Source: SRC-096 (IOC RED-S 2018: low energy availability raises injury risk and lowers performance)
    id: 'calories',
    metricIds: ['caloric_intake'],
    side: 'low',
    skip: ['treadmill'],
    skipWhy: 'Energy intake is low: skip the long endurance session.',
    cap: 'reduced',
    note: 'Eat a meal or snack before training.',
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: under-fuelled, so lighter work today.`,
  },
  {
    // Source: SRC-097 (Milewski 2014: under 8 h sleep → 1.7× injury risk)
    id: 'sleep',
    group: 'sleep',
    metricIds: ['sleep_eff', 'daily_sleep_hours'],
    side: 'low',
    add: { micro: ['cycle', 'aredHeelRaise'], gravity: ['cycle', 'plank'] },
    skip: ['aredDeadlift', 'aredSquat', 'lunges'],
    skipWhy: 'Poor sleep raises injury risk: skip heavy and balance-demanding lifts.',
    cap: 'reduced',
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: tired muscles and slower reactions, so controlled exercises only.`,
  },
  {
    id: 'alertness',
    group: 'sleep',
    metricIds: ['pvt_lapses'],
    side: 'high',
    add: { micro: ['cycle', 'aredHeelRaise'], gravity: ['cycle', 'plank'] },
    skip: ['aredDeadlift', 'aredSquat', 'lunges'],
    skipWhy: 'Alertness is low: skip heavy and balance-demanding lifts.',
    cap: 'reduced',
    text: (r) => `${r.label} is ${fmt(r.currentValue)}: reaction time is slow, so controlled exercises only.`,
  },
  {
    // Source: SRC-098 (Schuch 2016: exercise has a large antidepressant effect, largest for moderate aerobic work)
    id: 'mood',
    metricIds: ['mood_index'],
    side: 'low',
    add: { micro: ['cycle', 'treadmill'], gravity: ['cycle'] },
    text: (r) => `${r.label} is ${fmt(r.currentValue)}: moderate aerobic exercise lifts mood.`,
  },
  {
    // Source: SRC-099 (Nieman & Wentz 2019: moderate exercise supports immunity, heavy exertion suppresses it)
    id: 'immune',
    metricIds: ['wbc_lymph'],
    side: 'low',
    skip: ['treadmill'],
    skipWhy: 'Immune cells are low: avoid long, exhausting sessions.',
    cap: 'reduced',
    note: 'Keep each session under 45 minutes and moderate.',
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: moderate exercise only.`,
  },
  {
    // Source: SRC-100 (NASA OCHMO CO₂ brief: crew headaches rise with cabin CO₂; exercise itself raises local CO₂)
    id: 'co2',
    metricIds: ['cabin_co2'],
    side: 'high',
    skip: ['treadmill'],
    skipWhy: 'Cabin CO₂ is high: hard aerobic work adds more CO₂ and headaches.',
    cap: 'reduced',
    note: 'Exercise near a ventilation outlet if you can.',
    text: (r) => `${r.label} is ${fmt(r.currentValue)} ${r.unit}: keep the effort moderate.`,
  },
];

/** On a light (recovery) day, spine-heavy or impact exercises are swapped for gentler ones on the same area. */
export const LIGHT_DAY_SWAP: Partial<Record<ExerciseId, ExerciseId>> = {
  aredDeadlift: 'aredHeelRaise',
  treadmill: 'cycle',
  lunges: 'squats',
  pushups: 'plank',
};

/** Zone-based intensity. Light: a red zone, cardio caution, raised temperature or borderline SpO₂. Reduced: any zone in caution. */
export function trainingIntensity(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  zoneStatuses: Record<BodyZoneId, TriageStatus>
): { intensity: TrainingIntensity; reasons: string[] } {
  const light: string[] = [];
  const reduced: string[] = [];
  (Object.keys(zoneStatuses) as BodyZoneId[]).forEach((z) => {
    const st = zoneStatuses[z];
    if (st === 'red') light.push(`${ZONE_NAME[z]} zone is in alert.`);
    else if (st === 'yellow' && z === 'cardio') light.push('Cardiovascular zone is in caution: keep the heart rate low.');
    else if (st === 'yellow') reduced.push(`${ZONE_NAME[z]} zone is in caution.`);
  });
  const temp = latest(zones, 'core_temp');
  if (temp && temp.currentValue >= 37.5 && temp.currentValue < 38) light.push(`Body temperature is raised (${fmt(temp.currentValue)} ${temp.unit}).`);
  const spo2 = latest(zones, 'spo2');
  if (spo2 && spo2.currentValue >= 93 && spo2.currentValue < 95) light.push(`Blood oxygen is borderline (${fmt(spo2.currentValue)} ${spo2.unit}).`);
  if (light.length) return { intensity: 'light', reasons: light };
  if (reduced.length) return { intensity: 'reduced', reasons: reduced };
  return { intensity: 'full', reasons: [] };
}

const EMPTY = { exercises: [], intensity: 'light' as TrainingIntensity, intensityReasons: [], skip: [], skipReasons: {}, notes: [] };

export function recommendTraining(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  zoneStatuses: Record<BodyZoneId, TriageStatus>,
  environment: GravityEnvironment
): TrainingPlan {
  // Safety first: no training with a heart alert, fever, low oxygen or low blood sugar.
  const unsafe: TrainingReason[] = [];
  if (zoneStatuses.cardio === 'red') {
    unsafe.push({ metricId: 'cardio', text: 'Cardiovascular zone is in alert.', status: 'red' });
  }
  const temp = latest(zones, 'core_temp');
  if (temp && temp.currentValue >= 38) {
    unsafe.push({ metricId: 'core_temp', text: `Body temperature is ${fmt(temp.currentValue)} ${temp.unit} (fever).`, status: 'red' });
  }
  const spo2 = latest(zones, 'spo2');
  if (spo2 && spo2.currentValue < 93) {
    unsafe.push({ metricId: 'spo2', text: `Blood oxygen is ${fmt(spo2.currentValue)} ${spo2.unit}.`, status: 'red' });
  }
  // Source: SRC-094 (ADA 2016) — below 70 mg/dL is hypoglycaemia: treat it before any exercise.
  const glucose = latest(zones, 'blood_glucose');
  if (glucose && glucose.currentValue < 70) {
    unsafe.push({ metricId: 'blood_glucose', text: `Blood glucose is ${fmt(glucose.currentValue)} ${glucose.unit} (low). Eat 15–30 g of fast carbohydrate and recheck.`, status: 'red' });
  }
  if (unsafe.length) return { state: 'unsafe', reasons: unsafe, ...EMPTY };

  const setting: Setting = isMicrogravity(environment) ? 'micro' : 'gravity';
  const library = new Set(exercisesFor(environment));
  const reasons: TrainingReason[] = [];
  const picks = new Set<ExerciseId>();
  const skipReasons: Partial<Record<ExerciseId, string>> = {};
  const notes: string[] = [];
  let { intensity, reasons: intensityReasons } = trainingIntensity(zones, zoneStatuses);
  intensityReasons = [...intensityReasons];

  const fired = (rule: MetricRule): VitalSignReading | null => {
    for (const metricId of rule.metricIds) {
      const r = latest(zones, metricId);
      if (!r) continue;
      const status = evaluateMetricStatus(metricId, r.currentValue, environment);
      const range = getMetricThreshold(metricId, environment);
      const off = rule.side === 'low' ? r.currentValue < range.nominalMin : r.currentValue > range.nominalMax;
      if (status !== 'green' && off) return r;
    }
    return null;
  };

  const firedGroups = new Set<string>();
  for (const rule of METRIC_RULES) {
    if (rule.only && rule.only !== setting) continue;
    if (rule.group && firedGroups.has(rule.group)) continue;
    const r = fired(rule);
    if (!r) continue;
    if (rule.group) firedGroups.add(rule.group);
    reasons.push({ metricId: r.metricId, status: evaluateMetricStatus(r.metricId, r.currentValue, environment), text: rule.text(r) });
    rule.add?.[setting]?.forEach((e) => picks.add(e));
    rule.skip?.forEach((e) => {
      if (library.has(e) && !skipReasons[e]) skipReasons[e] = rule.skipWhy ?? 'Not advised today.';
    });
    if (rule.cap && RANK[rule.cap] > RANK[intensity]) {
      intensity = rule.cap;
      intensityReasons.push(`${r.label} is out of range.`);
    }
    if (rule.note && !notes.includes(rule.note)) notes.push(rule.note);
  }

  // Source: SRC-094 — glucose under 90 mg/dL: take carbohydrate before exercise (not a block).
  if (glucose && glucose.currentValue < 90) notes.unshift('Blood glucose is on the low side: eat 15–30 g of carbohydrate before you start.');

  if (zoneStatuses.musculo !== 'green') {
    reasons.push({ metricId: 'musculo', status: zoneStatuses.musculo, text: 'Musculoskeletal zone is out of range. Strengthen the muscles that protect the spine.' });
    (setting === 'micro' ? (['aredDeadlift', 'aredSquat'] as ExerciseId[]) : (['plank', 'crunches', 'squats'] as ExerciseId[])).forEach((e) => picks.add(e));
  }

  // Light day: swap spine-heavy or impact work for gentler exercises on the same area.
  if (intensity === 'light') {
    (Object.keys(LIGHT_DAY_SWAP) as ExerciseId[]).forEach((e) => {
      if (library.has(e) && !skipReasons[e]) skipReasons[e] = 'Light recovery day: swapped for a gentler exercise.';
    });
  }

  // Final list: replace anything skipped with its gentler swap, keep only what exists here.
  const exercises: ExerciseId[] = [];
  picks.forEach((e) => {
    let x: ExerciseId | undefined = e;
    if (skipReasons[x]) x = LIGHT_DAY_SWAP[x];
    if (x && library.has(x) && !skipReasons[x] && !exercises.includes(x)) exercises.push(x);
  });
  const skip = (Object.keys(skipReasons) as ExerciseId[]).filter((e) => library.has(e));

  const base = { intensity, intensityReasons, skip, skipReasons, notes };
  if (!reasons.length) return { state: 'optional', reasons: [], exercises: [], ...base };
  return { state: 'required', reasons, exercises, ...base };
}
