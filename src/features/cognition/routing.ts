/**
 * ARGUS — Cognitive-decline care routing (specs/01-data-schema.md §12.4).
 * Deterministic: decides whether the crew handles a decline on board or the Flight Surgeon on Earth is alerted.
 * On the ISS the Crew Medical Officer (CMO) is usually not a physician and acts as an extender of the
 * ground flight surgeons; screening and countermeasures are within CMO scope, diagnosis is not.
 * Source: SRC-092 (CMO preparedness: CMO as healthcare extender to ground flight surgeons)
 * Source: SRC-093 (CMO treats with onboard supplies following ground flight-surgeon advice)
 */
import type { TriageStatus } from '../../types/argus';
import { GAME_BY_ID } from './catalog';
import type { CareDecision, CognitionEvaluation, CognitionGameId } from './types';

export interface RoutingInput {
  gameId: CognitionGameId;
  evaluation: CognitionEvaluation;
  /** Statuses of the astronaut's previous evaluated sessions, newest first. */
  recentStatuses: Array<TriageStatus | 'calibrating'>;
  /** Current status of the neuro and behavioral Bio-Twin zones. */
  neuroZone: TriageStatus;
  behavioralZone: TriageStatus;
}

/** Steps a non-physician CMO can do on board to look for common, treatable causes. */
const ONBOARD_SCREEN = [
  'Check sleep: hours last night and any missed sleep this week',
  'Measure SpO₂ and check cabin ppCO₂ on the habitat display',
  'Drink water and eat if the last meal was over 5 hours ago',
  'Review recent medication, especially sleep aids or antihistamines',
  'Rest 20 minutes, then retest the same game',
];

const EARTH_STEPS = [
  'Stop safety-critical tasks (EVA, docking, robotics) until cleared',
  'Do the on-board checks below and record the values',
  'Stay with a crewmate until the Flight Surgeon replies',
];

const NEURO_RED_STEPS = [
  'Check for headache, vision change, slurred speech or one-sided weakness',
  'If any are present, open Emergency → Crew medical emergency now',
];

export function decideCare(input: RoutingInput): CareDecision {
  const { evaluation, recentStatuses, neuroZone, behavioralZone, gameId } = input;
  const def = GAME_BY_ID[gameId];
  const status = evaluation.status;

  if (status === 'green' || status === 'calibrating') {
    return {
      route: 'none',
      severity: 'green',
      headline: status === 'calibrating' ? 'Building your baseline' : 'Within your normal range',
      reasons: [],
      onboardSteps: [],
      notifyEarth: false,
      openMedicalProtocol: false,
    };
  }

  const reasons = [`${def.domain} (${def.nasaTest}) is well below your recent baseline.`];
  const previousDecline = recentStatuses[0] === 'yellow' || recentStatuses[0] === 'red';
  if (previousDecline) reasons.push('Your previous game also showed a decline.');
  const neuroRed = neuroZone === 'red';
  const neuroFlag = neuroZone !== 'green' || behavioralZone !== 'green';
  if (neuroFlag) reasons.push('Neuro or behavioral vital signs are also outside nominal.');

  const escalate = status === 'red' || previousDecline || neuroRed;

  if (!escalate) {
    return {
      route: 'onboard',
      severity: 'yellow',
      headline: 'Treat on board',
      reasons: [...reasons, 'A single moderate dip is usually fatigue, CO₂, hydration or medication: all checkable on board.'],
      onboardSteps: ONBOARD_SCREEN,
      notifyEarth: false,
      openMedicalProtocol: false,
    };
  }

  return {
    route: 'earth',
    severity: 'red',
    headline: 'Flight Surgeon alerted',
    reasons: [...reasons, 'This needs a physician’s assessment beyond Crew Medical Officer scope.'],
    onboardSteps: [...(neuroRed ? NEURO_RED_STEPS : []), ...EARTH_STEPS, ...ONBOARD_SCREEN.slice(0, 4)],
    notifyEarth: true,
    openMedicalProtocol: neuroRed,
  };
}

/** Packet note sent to the Flight Surgeon. */
export function earthPacketNote(input: RoutingInput, decision: CareDecision): string {
  const def = GAME_BY_ID[input.gameId];
  const z = input.evaluation.declineZ;
  return [
    `COGNITION ALERT: ${def.nasaTest} (${def.domain}).`,
    `Decline ${z === null ? 'n/a' : z.toFixed(1)}σ vs personal baseline (median ${input.evaluation.baselineMedian?.toFixed(2)} ${def.primaryMetricUnit}, n=${input.evaluation.baselineN}).`,
    ...decision.reasons,
    'Crew instructed to pause safety-critical tasks and run on-board checks.',
  ].join(' ');
}
