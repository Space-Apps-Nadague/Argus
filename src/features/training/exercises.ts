/**
 * ARGUS — Training exercise library (specs/02-ui-dashboard.md §2.6 Training)
 * Plain-language instructions for non-physician crew. Each exercise has an animated 3-D figure
 * (mannequin.ts) and, where generated, an AI illustration of the start and end positions.
 */

import pushupsImg from './media/pushups.webp';
import crunchesImg from './media/crunches.webp';
import squatsImg from './media/squats.webp';

export type ExerciseId = 'squats' | 'pushups' | 'lunges' | 'plank' | 'crunches';

export interface Exercise {
  id: ExerciseId;
  name: string;
  dose: string;
  targets: string;
  /** Why it matters in spaceflight. */
  why: string;
  steps: string[];
  mistakes: string[];
  /** How to do it without gravity. */
  microgravity: string;
  /** AI-generated two-panel illustration (start → end position), if available. */
  image?: string;
}

export const EXERCISES: Record<ExerciseId, Exercise> = {
  squats: {
    id: 'squats',
    name: 'Squats',
    dose: '3 sets × 12–15 reps',
    targets: 'Thighs, glutes, hip and spine bone loading',
    why: 'Loading the hips and spine is the main way to slow the 1–1.5 % monthly bone loss in microgravity.',
    steps: [
      'Stand with feet shoulder-width apart, toes slightly out.',
      'Push your hips back and bend your knees. Keep your chest up and reach your arms forward.',
      'Go down until your thighs are parallel to the floor. Heels stay flat, knees follow the toes.',
      'Drive up through your heels to standing. Breathe out on the way up.',
    ],
    mistakes: ['Heels lifting off the floor', 'Knees caving inward', 'Rounding the lower back'],
    microgravity: 'In flight, do them on the ARED with the bar on your shoulders for load.',
    image: squatsImg,
  },
  pushups: {
    id: 'pushups',
    name: 'Push-ups',
    dose: '3 sets × 10–15 reps',
    targets: 'Chest, shoulders, triceps, core',
    why: 'Upper-body muscles and wrist bones lose load in microgravity; push-ups keep them strong.',
    steps: [
      'Hands on the floor slightly wider than your shoulders, directly under them.',
      'Make a straight line from head to heels. Brace your stomach and squeeze your glutes.',
      'Lower your chest toward the floor for 2 seconds, elbows about 45° from your body.',
      'Stop just above the floor, then press back up in 1 second without locking your elbows.',
    ],
    mistakes: ['Hips sagging or piking up', 'Elbows flared straight out', 'Half repetitions'],
    microgravity: 'In flight, use the ARED bench press or a bungee harness that pulls you to the floor.',
    image: pushupsImg,
  },
  lunges: {
    id: 'lunges',
    name: 'Reverse lunges',
    dose: '3 sets × 10 reps per leg',
    targets: 'Thighs, glutes, balance',
    why: 'Single-leg work rebuilds leg strength and balance, which drop after time in microgravity. Stepping back is easier on the knees than stepping forward.',
    steps: [
      'Stand tall with your hands on your hips.',
      'Take a big step back with one leg and land on the ball of that foot.',
      'Lower until both knees are bent about 90°. The back knee stops just above the floor, the front knee stays over the ankle.',
      'Push through the front heel and bring the back leg forward to standing. Switch legs.',
    ],
    mistakes: ['Front knee drifting inward or past the toes', 'Leaning the torso forward', 'Too short a step'],
    microgravity: 'Best during post-flight rehabilitation on Earth or on the Moon or Mars; in 0 g use the ARED.',
  },
  plank: {
    id: 'plank',
    name: 'Forearm plank',
    dose: '3 holds × 30–45 s',
    targets: 'Deep core and back muscles',
    why: 'Spinal muscles weaken and back pain is common in spaceflight; the plank trains the muscles that protect the spine.',
    steps: [
      'Forearms on the floor, elbows directly under your shoulders.',
      'Stretch your legs back and rest on your toes.',
      'Keep a straight line from head to heels. Look at the floor.',
      'Brace your stomach, breathe normally and hold.',
    ],
    mistakes: ['Hips sagging toward the floor', 'Hips raised too high', 'Holding your breath'],
    microgravity: 'In flight, wear the bungee harness so your body has something to push against.',
  },
  crunches: {
    id: 'crunches',
    name: 'Crunches',
    dose: '3 sets × 15 reps',
    targets: 'Abdominal muscles',
    why: 'A strong trunk supports the spine, which lengthens and loses support in microgravity.',
    steps: [
      'Lie on your back, knees bent 90°, feet flat on the floor.',
      'Rest your fingertips behind your ears. Do not pull on your head.',
      'Breathe out and curl your shoulders about 30° off the floor. Your lower back stays down.',
      'Pause for 1 second, then lower slowly for 2 seconds.',
    ],
    mistakes: ['Pulling the neck with your hands', 'Sitting all the way up', 'Holding your breath'],
    microgravity: 'In flight, hook your feet under a foot restraint so you do not float away.',
    image: crunchesImg,
  },
};

export const EXERCISE_ORDER: ExerciseId[] = ['squats', 'pushups', 'lunges', 'plank', 'crunches'];
