/**
 * Deterministic countermeasure library (offline fallback for /api/ai/recommendations),
 * grounded in standard ISS/HRP countermeasures. The LLM personalizes and re-orders these.
 */

import type {
  CountermeasureCategory,
  CountermeasureRecommendation,
  MetricTrend,
  RecommendationPriority,
} from '../../src/types/aiApi';

type Template = Omit<CountermeasureRecommendation, 'id' | 'priority' | 'targetMetricIds'>;

export const COUNTERMEASURE_LIBRARY: Record<string, Template> = {
  onsd: {
    category: 'medical_check',
    title: 'Reduce headward fluid shift',
    plainInstruction:
      'Do a 20-minute lower-body negative pressure or thigh-cuff session, avoid head-down postures, and repeat the eye ultrasound tomorrow.',
    rationale: 'Pulling fluid toward the legs lowers pressure behind the eyes.',
    durationMinutes: 30,
  },
  iop: {
    category: 'medical_check',
    title: 'Recheck eye pressure',
    plainInstruction: 'Measure eye pressure again after 10 minutes of quiet rest and note any blurry vision or headache.',
    rationale: 'A rested repeat reading confirms whether eye pressure is truly elevated.',
    durationMinutes: 15,
  },
  cabin_co2: {
    category: 'environment',
    title: 'Lower local CO₂',
    plainInstruction:
      'Check the CO₂ scrubber status, turn on a portable fan where you sleep and work, and move to a better-ventilated module if you feel a headache.',
    rationale: 'CO₂ pockets form without convection in microgravity; airflow clears them.',
    durationMinutes: 10,
  },
  resting_hr: {
    category: 'exercise',
    title: 'Aerobic recovery session',
    plainInstruction: 'Do 30 minutes of easy cycling (CEVIS) at a conversational pace and drink 500 ml of water.',
    rationale: 'Moderate aerobic work maintains heart fitness and lowers resting heart rate over time.',
    durationMinutes: 35,
  },
  hrv_rmssd: {
    category: 'behavioral',
    title: 'Paced breathing',
    plainInstruction: 'Breathe slowly — in for 4 seconds, out for 6 — for 10 minutes before sleep.',
    rationale: 'Slow breathing increases heart-rate variability and calms the stress response.',
    durationMinutes: 10,
  },
  spo2: {
    category: 'medical_check',
    title: 'Confirm oxygen level',
    plainInstruction: 'Warm your hands, re-measure SpO₂ at rest, and report any shortness of breath right away.',
    rationale: 'Cold fingers give false low readings; a confirmed low value needs medical review.',
    durationMinutes: 5,
  },
  bmd_delta: {
    category: 'exercise',
    title: 'Resistance training (ARED)',
    plainInstruction: 'Complete today’s ARED session with squats and heel raises at your prescribed load.',
    rationale: 'Loading the skeleton is the main defense against bone loss in microgravity.',
    durationMinutes: 60,
  },
  ared_load: {
    category: 'exercise',
    title: 'Restore ARED load',
    plainInstruction: 'Work back up toward your prescribed ARED load over the next 3 sessions.',
    rationale: 'Load below prescription speeds up bone and muscle loss.',
    durationMinutes: 60,
  },
  rad_dose: {
    category: 'radiation',
    title: 'Use the radiation shelter',
    plainInstruction:
      'Spend sleep and rest periods in the shielded crew quarters, and follow solar-storm shelter procedures if an alert is active.',
    rationale: 'Extra shielding cuts dose during high-radiation periods.',
    durationMinutes: 480,
  },
  wbc_lymph: {
    category: 'nutrition',
    title: 'Support immune recovery',
    plainInstruction: 'Eat full meals with protein, take your vitamin D, and practice strict hand hygiene for 72 hours.',
    rationale: 'Nutrition and infection prevention matter while lymphocytes are low.',
    durationMinutes: 5,
  },
  sleep_eff: {
    category: 'sleep',
    title: 'Protect sleep',
    plainInstruction:
      'Use the sleep-shift lighting, keep 8.5 hours for sleep, avoid caffeine after midday, and wear the eye mask and earplugs.',
    rationale: 'Regular light and sleep timing improves sleep efficiency.',
    durationMinutes: 510,
  },
  pvt_lapses: {
    category: 'behavioral',
    title: 'Fatigue check before critical tasks',
    plainInstruction: 'Repeat the reaction-time test before any critical task and swap duties with a crewmate if it is still slow.',
    rationale: 'Reaction-time lapses predict errors during demanding work.',
    durationMinutes: 5,
  },
};

export const CATEGORIES: CountermeasureCategory[] = [
  'exercise',
  'sleep',
  'nutrition',
  'radiation',
  'environment',
  'behavioral',
  'medical_check',
];

function priorityFor(trend: MetricTrend): RecommendationPriority {
  if (trend.status === 'red' || trend.daysToRed === 0) return 'now';
  if (trend.status === 'yellow' || (trend.daysToRed !== null && trend.daysToRed <= 7)) return 'today';
  return 'this_week';
}

const PRIORITY_RANK: Record<RecommendationPriority, number> = { now: 0, today: 1, this_week: 2 };

/** One library countermeasure per flagged metric, most urgent first. Always includes daily maintenance. */
export function buildOfflinePlan(flagged: MetricTrend[]): CountermeasureRecommendation[] {
  const recs: CountermeasureRecommendation[] = flagged
    .filter((t) => COUNTERMEASURE_LIBRARY[t.metricId])
    .map((t) => ({
      id: `cm-${t.metricId}`,
      ...COUNTERMEASURE_LIBRARY[t.metricId],
      targetMetricIds: [t.metricId],
      priority: priorityFor(t),
    }))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  if (!recs.some((r) => r.category === 'exercise')) {
    recs.push({
      id: 'cm-maintenance-exercise',
      ...COUNTERMEASURE_LIBRARY.bmd_delta,
      title: 'Daily exercise maintenance',
      targetMetricIds: ['bmd_delta', 'resting_hr'],
      priority: 'today',
    });
  }
  return recs;
}
