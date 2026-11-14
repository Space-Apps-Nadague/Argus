/**
 * Deterministic diagnostic candidates mapped to NASA HRP risks.
 * Used as the offline fallback AND as grounding for the LLM's ranking, so the model
 * re-ranks and explains known patterns instead of inventing conditions from nothing.
 */

import type { DiagnosticHypothesis, EarthConsultUrgency, Likelihood, MetricTrend } from '../../src/types/aiApi';
import type { BodyZoneId, TriageStatus } from '../../src/types/argus';

interface MetricSignal {
  metricId: string;
  /** Which direction is concerning for this condition. */
  concerning: 'up' | 'down';
  /** Supporting signals add evidence but can't trigger the rule on their own. */
  supporting?: boolean;
}

interface DiagnosticRule {
  id: string;
  condition: string;
  hrpRisk: string;
  signals: MetricSignal[];
  /** Environmental causes that explain downstream metrics get a small ranking boost. */
  rootCause?: boolean;
  rationale: string;
  suggestedConfirmation: string;
}

export const DIAGNOSTIC_RULES: DiagnosticRule[] = [
  {
    id: 'sans',
    condition: 'Spaceflight-Associated Neuro-ocular Syndrome (SANS)',
    hrpRisk: 'Risk of Spaceflight Associated Neuro-ocular Syndrome',
    signals: [
      { metricId: 'onsd', concerning: 'up' },
      { metricId: 'iop', concerning: 'up', supporting: true },
    ],
    rationale: 'Headward fluid shift in microgravity widens the optic nerve sheath and raises eye pressure.',
    suggestedConfirmation: 'Repeat optic nerve sheath ultrasound and fundoscopy; check for vision changes or headache.',
  },
  {
    id: 'hypercapnia',
    condition: 'Elevated cabin CO₂ exposure (hypercapnia symptoms)',
    hrpRisk: 'Risk of Adverse Health & Performance Effects from Vehicle/Habitat Environment (CO₂)',
    signals: [
      { metricId: 'cabin_co2', concerning: 'up' },
      { metricId: 'pvt_lapses', concerning: 'up', supporting: true },
      { metricId: 'iop', concerning: 'up', supporting: true },
    ],
    rootCause: true,
    rationale: 'High CO₂ causes headaches, slowed thinking and can worsen headward pressure effects.',
    suggestedConfirmation: 'Verify the CO₂ scrubber (CDRA) status and local CO₂ sensors; log headache and reaction-time tests.',
  },
  {
    id: 'cardio_decon',
    condition: 'Cardiovascular deconditioning / autonomic stress',
    hrpRisk: 'Risk of Cardiovascular Adaptations Contributing to Adverse Mission Performance',
    signals: [
      { metricId: 'resting_hr', concerning: 'up' },
      { metricId: 'hrv_rmssd', concerning: 'down' },
    ],
    rationale: 'Rising resting heart rate with falling heart-rate variability suggests strain or deconditioning.',
    suggestedConfirmation: 'Repeat resting ECG and orthostatic check; review sleep, hydration and exercise logs.',
  },
  {
    id: 'hypoxemia',
    condition: 'Low blood oxygen (hypoxemia)',
    hrpRisk: 'Risk of Adverse Health Outcomes from Habitat Atmosphere',
    signals: [{ metricId: 'spo2', concerning: 'down' }],
    rationale: 'Oxygen saturation below norms can reflect atmosphere issues or a respiratory problem.',
    suggestedConfirmation: 'Re-measure SpO₂ at rest on a warm finger; check cabin O₂ partial pressure.',
  },
  {
    id: 'bone_loss',
    condition: 'Accelerated bone mineral loss',
    hrpRisk: 'Risk of Early Onset Osteoporosis Due to Spaceflight',
    signals: [
      { metricId: 'bmd_delta', concerning: 'down' },
      { metricId: 'ared_load', concerning: 'down', supporting: true },
    ],
    rationale: 'Without loading, bones lose mineral faster; reduced resistance exercise accelerates it.',
    suggestedConfirmation: 'Review ARED session logs and load; schedule the next bone density scan.',
  },
  {
    id: 'radiation',
    condition: 'Radiation exposure with immune suppression',
    hrpRisk: 'Risk of Acute Radiation Syndromes & Immune Dysregulation',
    signals: [
      { metricId: 'rad_dose', concerning: 'up' },
      { metricId: 'wbc_lymph', concerning: 'down', supporting: true },
    ],
    rootCause: true,
    rationale: 'Higher daily dose with falling lymphocytes is a classic radiation-effect pattern.',
    suggestedConfirmation: 'Check personal dosimeter and space-weather alerts; repeat blood count in 24 h.',
  },
  {
    id: 'sleep_fatigue',
    condition: 'Sleep loss & fatigue (behavioral health)',
    hrpRisk: 'Risk of Performance Decrements Due to Sleep Loss & Adverse Cognitive or Behavioral Conditions',
    signals: [
      { metricId: 'sleep_eff', concerning: 'down' },
      { metricId: 'pvt_lapses', concerning: 'up', supporting: true },
    ],
    rationale: 'Poor sleep efficiency and more reaction-time lapses point to fatigue and cognitive strain.',
    suggestedConfirmation: 'Review sleep logs, light schedule and workload; repeat the PVT reaction-time test.',
  },
];

const STATUS_POINTS: Record<TriageStatus, number> = { green: 0, yellow: 1, red: 2 };

/**
 * Evidence from one metric: triage status (0–2) + drift magnitude when moving in the
 * concerning direction (|EWMA z| / 4, capped at 2) + 0.5 if projected to hit red within 14 days.
 */
export function signalScore(trend: MetricTrend, signal: MetricSignal): number {
  const movingConcerning =
    signal.concerning === 'up' ? trend.ewmaZ > 0 || trend.slopePerDay > 0 : trend.ewmaZ < 0 || trend.slopePerDay < 0;
  let score = STATUS_POINTS[trend.status];
  if (movingConcerning && trend.level !== 'steady') score += Math.min(Math.abs(trend.ewmaZ) / 4, 2);
  if (movingConcerning && trend.daysToRed !== null && trend.daysToRed > 0 && trend.daysToRed <= 14) score += 0.5;
  return score;
}

export function likelihoodFromScore(score: number): Likelihood {
  if (score >= 4.5) return 'high';
  if (score >= 2.5) return 'moderate';
  return 'low';
}

/**
 * Rule-based hypotheses, strongest first. Score = strongest primary signal
 * + half the mean of supporting signals + 0.5 for environmental root causes.
 * A rule needs primary evidence of at least 0.5 to be reported.
 */
export function evaluateDiagnosticRules(trends: MetricTrend[]): DiagnosticHypothesis[] {
  const byId = new Map(trends.map((t) => [t.metricId, t]));
  const out: Array<DiagnosticHypothesis & { score: number }> = [];

  for (const rule of DIAGNOSTIC_RULES) {
    let primary = 0;
    const supportingScores: number[] = [];
    const supporting: string[] = [];
    for (const signal of rule.signals) {
      const trend = byId.get(signal.metricId);
      if (!trend) continue;
      const s = signalScore(trend, signal);
      if (signal.supporting) supportingScores.push(s);
      else primary = Math.max(primary, s);
      if (s > 0) supporting.push(signal.metricId);
    }
    if (primary < 0.5) continue;
    const supportMean = supportingScores.length
      ? supportingScores.reduce((a, b) => a + b, 0) / supportingScores.length
      : 0;
    const score = primary + 0.5 * supportMean + (rule.rootCause ? 0.5 : 0);
    out.push({
      id: rule.id,
      condition: rule.condition,
      hrpRisk: rule.hrpRisk,
      likelihood: likelihoodFromScore(score),
      confidence: Math.min(0.9, Math.round((0.2 + score * 0.11) * 100) / 100),
      supportingMetricIds: supporting,
      rationale: rule.rationale,
      suggestedConfirmation: rule.suggestedConfirmation,
      score,
    });
  }

  return out.sort((a, b) => b.score - a.score).map(({ score: _score, ...h }) => h);
}

const URGENCY_RANK: Record<EarthConsultUrgency, number> = {
  routine_downlink: 0,
  priority_packet: 1,
  immediate_emergency_packet: 2,
};

/** Deterministic urgency floor from zone statuses: any red → emergency, any yellow → priority. */
export function urgencyFloor(zoneStatuses: Record<BodyZoneId, TriageStatus>): EarthConsultUrgency {
  const statuses = Object.values(zoneStatuses);
  if (statuses.includes('red')) return 'immediate_emergency_packet';
  if (statuses.includes('yellow')) return 'priority_packet';
  return 'routine_downlink';
}

/** The LLM may raise urgency but never lower it below the deterministic floor. */
export function maxUrgency(a: EarthConsultUrgency, b: EarthConsultUrgency): EarthConsultUrgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

export const DIAGNOSTIC_DISCLAIMER =
  'Decision support only — not a diagnosis. Zone colors come from fixed thresholds; confirm any concern with the Flight Surgeon.';
