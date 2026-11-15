/**
 * ARGUS — Cognition game catalog (specs/01-data-schema.md §12.1).
 * Each game implements one test of NASA's Cognition battery, at a fixed hard level for 3 minutes.
 * Source: SRC-089 (Cognition battery: 10 tests, domains, typical durations)
 * Emotion Recognition is supplied by a separate team system and is not part of this rotation.
 */
import type { CognitionGameDef, CognitionGameId } from './types';

export const COGNITION_GAMES: CognitionGameDef[] = [
  {
    id: 'pvt',
    title: 'Reflex',
    nasaTest: 'Psychomotor Vigilance (PVT-B)',
    domain: 'Vigilant attention',
    howTo: 'Tap the instant the counter starts. Not before.',
    seconds: 180, // Source: SRC-090 (PVT-B is 3 min)
    primaryMetricLabel: 'Response speed',
    primaryMetricUnit: '1/s',
    direction: 'higher',
    madFloor: 0.08,
  },
  {
    id: 'motor_praxis',
    title: 'Target Lock',
    nasaTest: 'Motor Praxis',
    domain: 'Sensory-motor speed',
    howTo: 'Hit each target before it vanishes (1.1 s). They keep shrinking.',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Hit speed',
    primaryMetricUnit: 'hits/s',
    direction: 'higher',
    madFloor: 0.05,
  },
  {
    id: 'fractal_2back',
    title: 'Echo',
    nasaTest: 'Fractal N-Back (3-back)',
    domain: 'Working memory',
    howTo: 'Hit MATCH when the shape is the same as THREE shapes ago.',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Hits minus false alarms',
    primaryMetricUnit: '',
    direction: 'higher',
    madFloor: 0.04,
  },
  {
    id: 'volt',
    title: 'Cargo Memory',
    nasaTest: 'Visual Object Learning',
    domain: 'Spatial learning and memory',
    howTo: 'Memorise 12 objects, then pick out the exact ones you saw. Some new ones differ by one detail.',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Accuracy',
    primaryMetricUnit: '%',
    direction: 'higher',
    madFloor: 4,
  },
  {
    id: 'dsst',
    title: 'Code Breaker',
    nasaTest: 'Digit Symbol Substitution',
    domain: 'Complex scanning and visual tracking',
    howTo: 'Use the key to match each symbol to its digit. Go fast: the key changes every minute.',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Correct per minute',
    primaryMetricUnit: '/min',
    direction: 'higher',
    madFloor: 2,
  },
  {
    id: 'bart',
    title: 'Pressure Run',
    nasaTest: 'Balloon Analog Risk',
    domain: 'Risk decision making',
    howTo: 'Pump to earn credits. Bank before it bursts (anywhere from 1 to 64 pumps).',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Risk propensity',
    primaryMetricUnit: 'pumps',
    direction: 'both',
    madFloor: 1.5,
  },
  {
    id: 'line_orientation',
    title: 'Docking Align',
    nasaTest: 'Line Orientation',
    domain: 'Spatial orientation',
    howTo: 'Rotate the moving line until it is parallel to the fixed one. 10 s per pair.',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Mean angle error',
    primaryMetricUnit: '°',
    direction: 'lower',
    madFloor: 1.5,
  },
  {
    id: 'abstract_matching',
    title: 'Pattern Sort',
    nasaTest: 'Abstract Matching',
    domain: 'Abstraction, concept formation',
    howTo: 'Send the object to the group it fits best. 4 s each, and watch for decoys.',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Accuracy',
    primaryMetricUnit: '%',
    direction: 'higher',
    madFloor: 4,
  },
  {
    id: 'matrix_reasoning',
    title: 'Grid Logic',
    nasaTest: 'Matrix Reasoning',
    domain: 'Abstract reasoning',
    howTo: 'Find the piece that completes the grid. Three rules, 15 s each.',
    seconds: 180, // ARGUS hard level: every game is 3 minutes (spec §12.1)
    primaryMetricLabel: 'Accuracy',
    primaryMetricUnit: '%',
    direction: 'higher',
    madFloor: 5,
  },
];

export const GAME_BY_ID: Record<CognitionGameId, CognitionGameDef> = Object.fromEntries(
  COGNITION_GAMES.map((g) => [g.id, g])
) as Record<CognitionGameId, CognitionGameDef>;

export const GAME_IDS: CognitionGameId[] = COGNITION_GAMES.map((g) => g.id);
