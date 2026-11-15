/**
 * ARGUS — Health outlook: spaceflight conditions as patterns over The Thousand Eyes indicators (specs/02 §2.3).
 * Each maps to a NASA HRP risk or Exploration Medical Condition List entry.
 * Source: SRC-002 (NASA HRP Risks of Human Spaceflight), SRC-004 (Exploration Medical Condition List),
 * SRC-010 (HRP evidence reports), SRC-104 (HRP behavioural-health risk).
 */

export interface ConditionSignal {
  /** Thousand Eyes indicator key (`src/features/thousandEyes/indicators.ts`). */
  key: string;
  /** Direction that counts as evidence. */
  worse: 'up' | 'down';
  /** Supporting signals add evidence but cannot raise a condition on their own. */
  role: 'primary' | 'supporting';
}

export interface Condition {
  id: string;
  label: string;
  /** NASA HRP risk / ExMC entry it belongs to. */
  hrpRisk: string;
  /** One plain sentence for non-physician crew. */
  plain: string;
  signals: ConditionSignal[];
  /** Check ids from `checks.ts`, most decisive first. */
  checks: string[];
  sources: string[];
}

const P = (key: string, worse: 'up' | 'down'): ConditionSignal => ({ key, worse, role: 'primary' });
const S = (key: string, worse: 'up' | 'down'): ConditionSignal => ({ key, worse, role: 'supporting' });

export const CONDITIONS: readonly Condition[] = [
  { id: 'sans', label: 'Eye and optic-nerve changes (SANS)', hrpRisk: 'Risk of Spaceflight Associated Neuro-ocular Syndrome',
    plain: 'Fluid shifts toward the head in weightlessness can swell the optic nerve and blur near vision.',
    signals: [P('vis', 'up'), S('vd', 'up'), S('co2', 'up')],
    checks: ['eye_imaging', 'onsd_us', 'vision_chart', 'tonometry'], sources: ['SRC-002', 'SRC-010'] },
  { id: 'hypercapnia', label: 'High cabin CO₂ effects', hrpRisk: 'Risk of Adverse Health Outcomes due to the Spacecraft Environment (CO₂)',
    plain: 'CO₂ builds up in still air and causes headache, faster breathing and slower thinking.',
    signals: [P('co2', 'up'), S('resp', 'up'), S('diz', 'up'), S('stress', 'up')],
    checks: ['co2_check', 'symptom_log', 'pvt'], sources: ['SRC-002'] },
  { id: 'cardio', label: 'Heart and blood-pressure deconditioning', hrpRisk: 'Risk of Cardiovascular Adaptations Contributing to Adverse Mission Performance',
    plain: 'Without gravity the heart works less and blood volume drops, so standing up later can cause dizziness.',
    signals: [P('rhr', 'up'), P('hrv', 'down'), S('sv', 'down'), S('co', 'down'), S('sbp', 'down'), S('diz', 'up'), S('ecg', 'up')],
    checks: ['ecg12', 'echo', 'stand_test'], sources: ['SRC-002'] },
  { id: 'renal', label: 'Kidney stone risk / dehydration', hrpRisk: 'Risk of Renal Stone Formation',
    plain: 'Bone calcium released in space and too little fluid make concentrated urine, which can form stones.',
    signals: [P('urine', 'up'), P('fluid', 'down'), S('ua', 'up'), S('urea', 'up'), S('swr', 'up'), S('back', 'up')],
    checks: ['urinalysis', 'urine_volume', 'renal_us', 'blood_chem'], sources: ['SRC-002', 'SRC-004'] },
  { id: 'bone', label: 'Bone loss', hrpRisk: 'Risk of Early Onset Osteoporosis Due to Spaceflight',
    plain: 'Bones that carry no weight lose mineral; less resistance exercise speeds it up.',
    signals: [P('back', 'up'), S('resist', 'down'), S('grip', 'down')],
    checks: ['bone_markers', 'exercise_log'], sources: ['SRC-002'] },
  { id: 'muscle', label: 'Muscle loss', hrpRisk: 'Risk of Impaired Performance Due to Reduced Muscle Mass, Strength and Endurance',
    plain: 'Unloaded muscles shrink within weeks unless exercise keeps them working.',
    signals: [P('grip', 'down'), S('wt', 'down'), S('resist', 'down'), S('aero', 'down'), S('energy', 'down')],
    checks: ['grip_retest', 'body_mass', 'exercise_log'], sources: ['SRC-002'] },
  { id: 'infection', label: 'Infection / immune changes', hrpRisk: 'Risk of Adverse Health Event Due to Altered Immune Response',
    plain: 'Spaceflight weakens immune defences, so infections and reactivated viruses (e.g. cold sores) are more likely.',
    signals: [P('temp', 'up'), P('crp', 'up'), P('sym', 'up'), S('rhr', 'up'), S('svoc', 'up'), S('bvoc', 'up')],
    checks: ['temp_repeat', 'crp', 'cbc', 'symptom_log'], sources: ['SRC-002', 'SRC-004'] },
  { id: 'radiation', label: 'Radiation exposure effects', hrpRisk: 'Risk of Acute Radiation Syndromes and Space Radiation Health Effects',
    plain: 'A higher daily dose, for example during a solar event, can lower blood counts.',
    signals: [P('dose', 'up'), S('sym', 'up'), S('energy', 'down')],
    checks: ['dosimeter', 'cbc'], sources: ['SRC-002'] },
  { id: 'sleep', label: 'Sleep loss and fatigue', hrpRisk: 'Risk of Performance Decrements Due to Sleep Loss and Circadian Desynchronization',
    plain: 'Short or broken sleep slows reactions and raises the chance of errors.',
    signals: [P('sleep', 'down'), P('slq', 'down'), S('energy', 'down'), S('hrv', 'down')],
    checks: ['pvt', 'sleep_log'], sources: ['SRC-002'] },
  { id: 'behavioral', label: 'Behavioural health strain', hrpRisk: 'Risk of Adverse Cognitive or Behavioral Conditions and Psychiatric Disorders',
    plain: 'Isolation, confinement and workload can wear down mood, motivation and team cohesion.',
    signals: [P('mood', 'down'), P('stress', 'up'), S('motiv', 'down'), S('cohes', 'down'), S('priv', 'down'), S('cort', 'up'), S('eda', 'up')],
    checks: ['psych_conf', 'saliva_cortisol', 'sleep_log'], sources: ['SRC-104'] },
  { id: 'energy', label: 'Energy deficit (eating too little)', hrpRisk: 'Risk of Performance Decrement and Crew Illness Due to Inadequate Food and Nutrition',
    plain: 'Eating less than you burn costs muscle and bone and lowers energy.',
    signals: [P('kcal', 'down'), P('wt', 'down'), S('ace', 'up'), S('energy', 'down')],
    checks: ['food_log', 'body_mass', 'ketones'], sources: ['SRC-002'] },
  { id: 'glucose', label: 'Blood-sugar regulation changes', hrpRisk: 'Risk of Performance Decrement and Crew Illness Due to Inadequate Food and Nutrition (metabolic)',
    plain: 'Inactivity and stress in flight can make the body handle sugar less well.',
    signals: [P('glu', 'up'), S('cort', 'up'), S('aero', 'down')],
    checks: ['fingerstick_glucose', 'blood_chem', 'food_log'], sources: ['SRC-002'] },
  { id: 'hypoxemia', label: 'Low blood oxygen', hrpRisk: 'Risk of Adverse Health Outcomes due to the Spacecraft Environment (atmosphere)',
    plain: 'Low oxygen in the cabin air or a lung problem lowers blood oxygen.',
    signals: [P('spo2', 'down'), S('resp', 'up'), S('rhr', 'up')],
    checks: ['spo2_repeat', 'o2_check', 'co2_check'], sources: ['SRC-002'] },
  { id: 'motion', label: 'Space motion sickness', hrpRisk: 'Exploration Medical Condition: space adaptation syndrome',
    plain: 'The balance organs get mixed signals after a gravity change, causing nausea and dizziness.',
    signals: [P('diz', 'up'), S('energy', 'down'), S('kcal', 'down')],
    checks: ['symptom_log', 'body_mass'], sources: ['SRC-004'] },
];

export const CONDITION_BY_ID: Readonly<Record<string, Condition>> = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));
