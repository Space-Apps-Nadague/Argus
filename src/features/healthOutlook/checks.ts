/**
 * ARGUS — Health outlook: physical checks that confirm or rule out a hypothesis (specs/02 §2.3).
 * Each check compares against the person's own pre-flight values or the lab's reference range; no new
 * clinical thresholds are introduced here.
 * Source: SRC-009 (Spaceflight Standard Measures: inflight blood, urine and saliva sampling, cognition,
 * physical tests), SRC-007 (NASA-STD-3001 Vol 1: crew health and medical capability),
 * SRC-092, SRC-093 (crew medical officer performs exams with onboard supplies, guided by ground flight surgeons).
 */

export type CheckKind = 'blood' | 'urine' | 'saliva' | 'imaging' | 'physical' | 'environment' | 'log';

export interface HealthCheck {
  id: string;
  name: string;
  kind: CheckKind;
  /** Plain instructions for the astronaut or crew medical officer. */
  how: string;
  /** Result that supports the hypothesis. */
  supportsIf: string;
  /** Result that argues against it. */
  refutesIf: string;
  /** Needs the crew medical officer or a second crew member. */
  needsCmo?: boolean;
}

export const CHECK_KIND_LABEL: Record<CheckKind, string> = {
  blood: 'Blood test',
  urine: 'Urine test',
  saliva: 'Saliva test',
  imaging: 'Imaging',
  physical: 'Physical test',
  environment: 'Environment check',
  log: 'Log review',
};

const PRE = 'your pre-flight values';

export const CHECKS: readonly HealthCheck[] = [
  // Blood
  { id: 'cbc', name: 'Complete blood count with differential', kind: 'blood', needsCmo: true,
    how: 'Finger-prick or venous draw by the crew medical officer; analyse on board or freeze for downlink.',
    supportsIf: 'White cells or lymphocytes outside the lab reference range, or clearly changed from ' + PRE + '.',
    refutesIf: 'All counts within the reference range and close to ' + PRE + '.' },
  { id: 'crp', name: 'C-reactive protein (CRP)', kind: 'blood',
    how: 'Finger-prick CRP test strip.',
    supportsIf: 'CRP above the test’s reference range.',
    refutesIf: 'CRP within the reference range.' },
  { id: 'blood_chem', name: 'Blood chemistry (glucose, electrolytes, kidney markers)', kind: 'blood', needsCmo: true,
    how: 'Venous draw, fasting, run on the onboard blood analyser if available.',
    supportsIf: 'Values outside the analyser’s reference range or clearly changed from ' + PRE + '.',
    refutesIf: 'Values within the reference range and close to ' + PRE + '.' },
  { id: 'bone_markers', name: 'Bone turnover markers (blood and urine)', kind: 'blood', needsCmo: true,
    how: 'Blood and urine samples, frozen for downlink to the ground lab.',
    supportsIf: 'Bone breakdown markers higher than ' + PRE + '.',
    refutesIf: 'Markers close to ' + PRE + '.' },
  { id: 'fingerstick_glucose', name: 'Finger-prick glucose (fasting)', kind: 'blood',
    how: 'Glucometer in the morning before eating; repeat on 2 days.',
    supportsIf: 'Fasting glucose above the meter’s normal range on both days.',
    refutesIf: 'Fasting glucose within the normal range.' },
  // Urine and saliva
  { id: 'urinalysis', name: 'Urine dipstick (specific gravity, blood, pH)', kind: 'urine',
    how: 'First urine of the day on a dipstick; photograph the strip.',
    supportsIf: 'High specific gravity (concentrated), or blood in the urine.',
    refutesIf: 'Normal specific gravity and no blood.' },
  { id: 'urine_volume', name: '24-hour urine volume', kind: 'urine',
    how: 'Log every void for 24 h with the urine volume device.',
    supportsIf: 'Total volume lower than ' + PRE + '.',
    refutesIf: 'Total volume at or above ' + PRE + '.' },
  { id: 'ketones', name: 'Urine ketones', kind: 'urine',
    how: 'Ketone dipstick on the first urine of the day.',
    supportsIf: 'Ketones present.',
    refutesIf: 'No ketones.' },
  { id: 'saliva_cortisol', name: 'Saliva cortisol (morning and evening)', kind: 'saliva',
    how: 'Saliva swab on waking and before sleep; freeze for downlink.',
    supportsIf: 'Higher than ' + PRE + ', or a flattened morning-to-evening drop.',
    refutesIf: 'Close to ' + PRE + ' with a normal daily drop.' },
  // Imaging
  { id: 'eye_imaging', name: 'Fundoscopy / optical coherence tomography (OCT)', kind: 'imaging', needsCmo: true,
    how: 'Retinal images of both eyes by the crew medical officer; downlink to the flight surgeon.',
    supportsIf: 'Optic disc swelling or choroidal folds not seen before flight.',
    refutesIf: 'Images unchanged from before flight.' },
  { id: 'onsd_us', name: 'Optic nerve sheath ultrasound', kind: 'imaging', needsCmo: true,
    how: 'Ultrasound behind each eye, ground-guided.',
    supportsIf: 'Sheath diameter larger than ' + PRE + '.',
    refutesIf: 'Diameter close to ' + PRE + '.' },
  { id: 'renal_us', name: 'Kidney ultrasound', kind: 'imaging', needsCmo: true,
    how: 'Ultrasound of both kidneys, ground-guided.',
    supportsIf: 'A stone or a swollen kidney (hydronephrosis).',
    refutesIf: 'No stone and normal kidneys.' },
  { id: 'echo', name: 'Heart ultrasound (echocardiogram)', kind: 'imaging', needsCmo: true,
    how: 'Ultrasound of the heart at rest, ground-guided.',
    supportsIf: 'Stroke volume or pumping lower than ' + PRE + '.',
    refutesIf: 'Heart size and pumping close to ' + PRE + '.' },
  // Physical tests
  { id: 'ecg12', name: '12-lead ECG at rest', kind: 'physical',
    how: '12-lead ECG lying still for 5 min; downlink the trace.',
    supportsIf: 'New rhythm or shape changes compared with ' + PRE + '.',
    refutesIf: 'Trace unchanged from ' + PRE + '.' },
  { id: 'stand_test', name: 'Stand test (orthostatic check)', kind: 'physical',
    how: 'On a planet or under load: lie 5 min, then stand 5 min, measuring heart rate and blood pressure each minute.',
    supportsIf: 'Dizziness, or a large heart-rate rise or blood-pressure drop on standing compared with ' + PRE + '.',
    refutesIf: 'No symptoms and a response close to ' + PRE + '.' },
  { id: 'vision_chart', name: 'Near and far vision chart', kind: 'physical',
    how: 'Read the near and far charts with each eye, same light and distance as before flight.',
    supportsIf: 'Worse reading than ' + PRE + ', especially near vision.',
    refutesIf: 'Same reading as ' + PRE + '.' },
  { id: 'tonometry', name: 'Eye pressure (tonometry)', kind: 'physical', needsCmo: true,
    how: 'Rebound tonometer on both eyes, seated.',
    supportsIf: 'Pressure higher than ' + PRE + '.',
    refutesIf: 'Pressure close to ' + PRE + '.' },
  { id: 'grip_retest', name: 'Grip dynamometer retest', kind: 'physical',
    how: 'Best of 3 squeezes per hand, same posture as before flight.',
    supportsIf: 'Grip lower than ' + PRE + ' on both hands.',
    refutesIf: 'Grip close to ' + PRE + '.' },
  { id: 'body_mass', name: 'Body mass', kind: 'physical',
    how: 'Body mass measurement device, morning, after voiding, before eating.',
    supportsIf: 'Mass falling week over week.',
    refutesIf: 'Mass stable.' },
  { id: 'temp_repeat', name: 'Repeat temperature', kind: 'physical',
    how: 'Oral or ear temperature now and again in 1 hour, at rest.',
    supportsIf: 'Temperature raised on both readings.',
    refutesIf: 'Normal temperature on both readings.' },
  { id: 'spo2_repeat', name: 'Repeat oxygen saturation at rest', kind: 'physical',
    how: 'Finger oximeter after 5 min seated, warm hand, 30 s steady reading.',
    supportsIf: 'Saturation still lower than ' + PRE + '.',
    refutesIf: 'Saturation back to ' + PRE + '.' },
  { id: 'pvt', name: 'Reaction-time test (PVT)', kind: 'physical',
    how: 'Run the 3-minute reaction-time test at the usual time of day.',
    supportsIf: 'More lapses or slower reactions than ' + PRE + '.',
    refutesIf: 'Lapses and speed close to ' + PRE + '.' },
  // Environment
  { id: 'co2_check', name: 'Cabin CO₂ with a portable monitor', kind: 'environment',
    how: 'Portable CO₂ monitor at your sleep station and work area.',
    supportsIf: 'Local CO₂ higher than the cabin average, or the scrubber reports a fault.',
    refutesIf: 'Local CO₂ at the cabin average and scrubbers nominal.' },
  { id: 'o2_check', name: 'Cabin oxygen check', kind: 'environment',
    how: 'Read cabin O₂ partial pressure from the habitat display.',
    supportsIf: 'O₂ partial pressure low.',
    refutesIf: 'O₂ partial pressure nominal.' },
  { id: 'dosimeter', name: 'Dosimeter and space-weather review', kind: 'environment',
    how: 'Compare your personal dosimeter with the area monitors and space-weather alerts.',
    supportsIf: 'Your dose agrees with a real increase (e.g. a solar particle event).',
    refutesIf: 'Area monitors show no increase (possible dosimeter fault).' },
  // Logs
  { id: 'sleep_log', name: 'Sleep and light-schedule review', kind: 'log',
    how: 'Review a week of sleep times, light exposure, caffeine and workload with the flight surgeon.',
    supportsIf: 'Short or broken sleep most nights.',
    refutesIf: 'Regular, sufficient sleep.' },
  { id: 'food_log', name: 'Food and fluid log review', kind: 'log',
    how: 'Log everything eaten and drunk for 3 days.',
    supportsIf: 'Intake below your calorie or fluid target.',
    refutesIf: 'Intake at target.' },
  { id: 'exercise_log', name: 'Exercise device log review', kind: 'log',
    how: 'Review resistance and treadmill/cycle sessions and loads for the past 2 weeks.',
    supportsIf: 'Fewer or lighter sessions than prescribed.',
    refutesIf: 'Sessions and loads as prescribed.' },
  { id: 'symptom_log', name: 'Symptom log', kind: 'log',
    how: 'Note headache, nausea, dizziness, vision change and their timing for 24 h.',
    supportsIf: 'Symptoms that match the condition.',
    refutesIf: 'No matching symptoms.' },
  { id: 'psych_conf', name: 'Private conference with the flight surgeon or psychologist', kind: 'log',
    how: 'Book a private conference at the next comm window.',
    supportsIf: 'The conversation confirms ongoing strain.',
    refutesIf: 'No ongoing strain found.' },
];

export const CHECK_BY_ID: Readonly<Record<string, HealthCheck>> = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
