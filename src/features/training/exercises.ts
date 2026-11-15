/**
 * ARGUS — Training exercise library (specs/02-ui-dashboard.md §2.6 Training)
 * Plain-language instructions for non-physician crew, each shown by an animated 3-D astronaut
 * (mannequin.ts). Two sets, because body weight is useless without gravity:
 *  - microgravity (ISS, Mars transit): the ISS countermeasure devices — ARED (resistance),
 *    T2 treadmill with a bungee harness, CEVIS cycle ergometer;
 *  - gravity (Moon, Mars, Earth): body-weight exercises, plus the cycle ergometer for aerobic work.
 * Device facts (ARED up to 600 lb, treadmill harness, CEVIS): Source: SRC-089. Bone loss rate: Source: SRC-090.
 */

import type { GravityEnvironment } from '../../types/argus';

export type ExerciseId =
  | 'aredSquat'
  | 'aredDeadlift'
  | 'aredHeelRaise'
  | 'treadmill'
  | 'cycle'
  | 'squats'
  | 'pushups'
  | 'lunges'
  | 'plank'
  | 'crunches';

/** How hard to train today, from the crew member's health (recommend.ts). */
export type TrainingIntensity = 'full' | 'reduced' | 'light';

export interface Exercise {
  id: ExerciseId;
  name: string;
  /** Dose per intensity: full (all green), reduced (a zone in caution), light (recovery day). */
  dose: Record<TrainingIntensity, string>;
  targets: string;
  /** Why it matters in spaceflight. */
  why: string;
  steps: string[];
  mistakes: string[];
  /** Practical note for this setting (microgravity device tips, or weighted vest on Moon/Mars). */
  note: string;
  /** Equipment needed, if any. */
  equipment?: string;
}

export const EXERCISES: Record<ExerciseId, Exercise> = {
  aredSquat: {
    id: 'aredSquat',
    name: 'ARED squat',
    dose: { full: '3 sets × 8–10 reps at your prescribed load', reduced: '2 sets × 8 reps at about 70 % of your prescribed load', light: '1–2 sets × 8 reps at about 50 % load, slow and controlled' },
    targets: 'Thighs, glutes, hip and spine bone loading',
    equipment: 'ARED (Advanced Resistive Exercise Device)',
    why: 'Without gravity your own weight loads nothing. The ARED vacuum cylinders pull the bar down with up to 272 kg, replacing body weight, and are the main defence against 1–1.5 % monthly hip and spine bone loss.',
    steps: [
      'Set the load on the ARED and stand on the platform with feet shoulder-width apart.',
      'Get under the padded bar so it rests across your upper back; hold the handles.',
      'Brace your stomach and squat until your thighs are parallel to the platform. Heels stay down.',
      'Drive up through your heels to standing. Breathe out on the way up.',
    ],
    mistakes: ['Heels lifting off the platform', 'Knees caving inward', 'Rounding the lower back under load'],
    note: 'Your feet are in the platform foot loops; the cylinders, not gravity, keep you on the platform.',
  },
  aredDeadlift: {
    id: 'aredDeadlift',
    name: 'ARED deadlift',
    dose: { full: '3 sets × 8 reps at your prescribed load', reduced: '2 sets × 6–8 reps at about 70 % of your prescribed load', light: 'Skip today: rest the spine' },
    targets: 'Back, glutes, hamstrings, spine bone loading',
    equipment: 'ARED',
    why: 'Spinal muscles shrink and the spine lengthens in microgravity; back pain is common. Deadlifts load the spine and the muscles that protect it.',
    steps: [
      'Stand on the platform, feet hip-width apart, bar over the middle of your feet.',
      'Push your hips back, keep your back flat and grip the bar just outside your knees.',
      'Stand up by driving your hips forward. Keep the bar close to your legs.',
      'Lower the same way: hips back first, flat back, slowly.',
    ],
    mistakes: ['Rounding the back', 'Bar drifting away from the legs', 'Jerking the bar off the bottom'],
    note: 'Start light after a long rest day; the ARED load is the same at the top and bottom of the lift.',
  },
  aredHeelRaise: {
    id: 'aredHeelRaise',
    name: 'ARED heel raise',
    dose: { full: '3 sets × 15 reps', reduced: '2 sets × 12 reps', light: '1–2 sets × 10 reps, slow' },
    targets: 'Calves, ankle and heel bone',
    equipment: 'ARED',
    why: 'Calf muscles lose the most mass of any muscle in spaceflight; heel raises under load keep them and the heel bone strong.',
    steps: [
      'Bar across your upper back, balls of your feet on the platform, heels free.',
      'Rise onto your toes as high as you can in about 1 second.',
      'Hold the top for 1 second.',
      'Lower slowly for 2 seconds until your heels are just below the toes.',
    ],
    mistakes: ['Bouncing at the bottom', 'Bending the knees', 'Rolling onto the outside of the feet'],
    note: 'Keep the load moderate and the movement slow; the calves fatigue fast.',
  },
  treadmill: {
    id: 'treadmill',
    name: 'Treadmill run with harness',
    dose: { full: '20–30 min at your prescribed speed', reduced: '15–20 min at an easy run, bungees at 60 %', light: 'Skip today: use the cycle ergometer instead' },
    targets: 'Heart and lungs, leg bones (impact)',
    equipment: 'T2 treadmill + bungee harness',
    why: 'Running gives the leg and hip bones impact loading and keeps the heart and leg muscles fit. The harness and bungees pull you onto the belt, because without them you would float off.',
    steps: [
      'Put on the harness over your shoulders and waist.',
      'Clip the bungee cords to both sides of the treadmill. Start at about 60 % of your body weight and build to 70–80 %.',
      'Start walking, then run at the prescribed speed. Land on the middle of your foot.',
      'Finish with 3–5 minutes of walking, then unclip.',
    ],
    mistakes: ['Loading the bungees too lightly (no bone benefit)', 'Overstriding and landing on the heel', 'Skipping the cool-down'],
    note: 'Harness pressure on the hips and shoulders is normal; adjust the pads if it becomes painful.',
  },
  cycle: {
    id: 'cycle',
    name: 'Cycle ergometer',
    dose: { full: '30 min in your heart-rate zone', reduced: '20 min, bottom of your heart-rate zone', light: '15 min easy pace, stop if you feel dizzy or short of breath' },
    targets: 'Heart and lungs (aerobic fitness)',
    equipment: 'Cycle ergometer (CEVIS on the ISS)',
    why: 'Aerobic fitness and heart size drop in microgravity. Cycling trains the heart with no impact, so it is the safe aerobic choice on days when the legs, blood pressure, eyes or sleep call for a gentler session. It works in any gravity.',
    steps: [
      'Clip your shoes into the pedals. In microgravity there is no seat: hold the handlebar and use the waist strap. With gravity, sit on the seat.',
      'Set the resistance and warm up for 5 minutes at an easy pace.',
      'Pedal smooth circles and keep your heart rate in the prescribed zone.',
      'Cool down for 5 minutes at an easy pace.',
    ],
    mistakes: ['Pushing only down instead of pedalling round', 'Starting hard without a warm-up', 'Not watching the heart-rate zone'],
    note: 'Breathe steadily; this is the exercise the plan swaps in when heavy lifts or running are not advised today.',
  },
  squats: {
    id: 'squats',
    name: 'Squats',
    dose: { full: '3 sets × 12–15 reps', reduced: '2 sets × 10–12 reps', light: '1–2 sets × 8 reps, half depth' },
    targets: 'Thighs, glutes, hip and spine bone loading',
    why: 'Loading the hips and spine is the main way to slow the 1–1.5 % monthly bone loss in microgravity.',
    steps: [
      'Stand with feet shoulder-width apart, toes slightly out.',
      'Push your hips back and bend your knees. Keep your chest up and reach your arms forward.',
      'Go down until your thighs are parallel to the floor. Heels stay flat, knees follow the toes.',
      'Drive up through your heels to standing. Breathe out on the way up.',
    ],
    mistakes: ['Heels lifting off the floor', 'Knees caving inward', 'Rounding the lower back'],
    note: 'On the Moon or Mars, wear the weighted vest so the squat still loads your hips and spine.',
  },
  pushups: {
    id: 'pushups',
    name: 'Push-ups',
    dose: { full: '3 sets × 10–15 reps', reduced: '2 sets × 8–10 reps', light: 'Skip today: do the plank instead' },
    targets: 'Chest, shoulders, triceps, core',
    why: 'Upper-body muscles and wrist bones lose load in microgravity; push-ups keep them strong.',
    steps: [
      'Hands on the floor slightly wider than your shoulders, directly under them.',
      'Make a straight line from head to heels. Brace your stomach and squeeze your glutes.',
      'Lower your chest toward the floor for 2 seconds, elbows about 45° from your body.',
      'Stop just above the floor, then press back up in 1 second without locking your elbows.',
    ],
    mistakes: ['Hips sagging or piking up', 'Elbows flared straight out', 'Half repetitions'],
    note: 'On the Moon or Mars, wear the weighted vest: at 1/6 g a push-up is very light.',
  },
  lunges: {
    id: 'lunges',
    name: 'Reverse lunges',
    dose: { full: '3 sets × 10 reps per leg', reduced: '2 sets × 8 reps per leg', light: 'Skip today: do squats instead' },
    targets: 'Thighs, glutes, balance',
    why: 'Single-leg work rebuilds leg strength and balance, which drop after time in microgravity. Stepping back is easier on the knees than stepping forward.',
    steps: [
      'Stand tall with your hands on your hips.',
      'Take a big step back with one leg and land on the ball of that foot.',
      'Lower until both knees are bent about 90°. The back knee stops just above the floor, the front knee stays over the ankle.',
      'Push through the front heel and bring the back leg forward to standing. Switch legs.',
    ],
    mistakes: ['Front knee drifting inward or past the toes', 'Leaning the torso forward', 'Too short a step'],
    note: 'Good for balance after landing and on the Moon or Mars, where the weighted vest adds load.',
  },
  plank: {
    id: 'plank',
    name: 'Forearm plank',
    dose: { full: '3 holds × 30–45 s', reduced: '2 holds × 20–30 s', light: '2 holds × 15–20 s' },
    targets: 'Deep core and back muscles',
    why: 'Spinal muscles weaken and back pain is common in spaceflight; the plank trains the muscles that protect the spine.',
    steps: [
      'Forearms on the floor, elbows directly under your shoulders.',
      'Stretch your legs back and rest on your toes.',
      'Keep a straight line from head to heels. Look at the floor.',
      'Brace your stomach, breathe normally and hold.',
    ],
    mistakes: ['Hips sagging toward the floor', 'Hips raised too high', 'Holding your breath'],
    note: 'On the Moon or Mars, add the weighted vest to make the hold harder.',
  },
  crunches: {
    id: 'crunches',
    name: 'Crunches',
    dose: { full: '3 sets × 15 reps', reduced: '2 sets × 12 reps', light: '1–2 sets × 10 reps, slow' },
    targets: 'Abdominal muscles',
    why: 'A strong trunk supports the spine, which lengthens and loses support in microgravity.',
    steps: [
      'Lie on your back, knees bent 90°, feet flat on the floor.',
      'Rest your fingertips behind your ears. Do not pull on your head.',
      'Breathe out and curl your shoulders about 30° off the floor. Your lower back stays down.',
      'Pause for 1 second, then lower slowly for 2 seconds.',
    ],
    mistakes: ['Pulling the neck with your hands', 'Sitting all the way up', 'Holding your breath'],
    note: 'Keep the movement small and slow: the curl does the work, not sitting all the way up.',
  },
};

/** Exercises for microgravity (body weight loads nothing) and for gravity (Moon, Mars, Earth). */
export const MICROGRAVITY_EXERCISES: ExerciseId[] = ['aredSquat', 'aredDeadlift', 'aredHeelRaise', 'treadmill', 'cycle'];
export const GRAVITY_EXERCISES: ExerciseId[] = ['squats', 'pushups', 'lunges', 'plank', 'crunches', 'cycle'];

export function isMicrogravity(env: GravityEnvironment): boolean {
  return env === 'iss_leo' || env === '0g_transit';
}

export function exercisesFor(env: GravityEnvironment): ExerciseId[] {
  return isMicrogravity(env) ? MICROGRAVITY_EXERCISES : GRAVITY_EXERCISES;
}

/** One line shown above the library explaining why these exercises. */
export function settingNote(env: GravityEnvironment): string {
  if (isMicrogravity(env)) {
    return 'You are in microgravity: push-ups and squats with body weight load nothing, so training uses the ARED for resistance, the treadmill with a bungee harness and the cycle ergometer.';
  }
  if (env === 'lunar_base') return 'On the Moon you weigh about 1/6 of your Earth weight: wear the weighted vest for body-weight exercises.';
  if (env === 'mars_base') return 'On Mars you weigh about 3/8 of your Earth weight: wear the weighted vest for body-weight exercises.';
  return 'On Earth: body-weight exercises, used for pre-flight conditioning and post-flight rehabilitation.';
}
