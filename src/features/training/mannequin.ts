/**
 * ARGUS — Training mannequin kinematics (specs/02-ui-dashboard.md §2.6 Training)
 *
 * A side-view (sagittal plane) skeleton: every joint rotates about the left-right axis, so the
 * figure is computed in 2-D (y up, z forward) and drawn in 3-D with left/right offsets.
 * Angles are in degrees; positive turns a segment forward (+z).
 * Pure functions, unit-tested: feet stay planted, hands stay on the floor.
 */

export const SEG = {
  torso: 0.55,
  shoulderDrop: 0.06,
  neckToHead: 0.14,
  upperArm: 0.3,
  forearm: 0.28,
  thigh: 0.45,
  shin: 0.45,
  foot: 0.18,
} as const;

/** Height of the ankle joint and of hand/toe contact points above the floor. */
export const ANKLE_HEIGHT = 0.08;
export const CONTACT_HEIGHT = 0.03;

export interface Pose {
  /** Body pitch (whole figure). Ignored for `floor` anchoring, where it is solved. */
  pitch?: number;
  spine: number;
  neck: number;
  /** Shoulder & elbow: relative to the torso, or absolute (world) when `armsWorld`. */
  shoulderL: number;
  elbowL: number;
  shoulderR: number;
  elbowR: number;
  hipL: number;
  kneeL: number;
  ankleL: number;
  hipR: number;
  kneeR: number;
  ankleR: number;
}

export type Anchor =
  /** Left ankle planted on the floor at z = 0 (squat, lunge). */
  | 'feet'
  /** Left toe planted at z = 0; the heel lifts (heel raise). */
  | 'toes'
  /** Pelvis at z = 0, lowest foot touching the treadmill belt (running). */
  | 'lowestFoot'
  /** Pelvis held at a fixed point; feet on rotating pedals (cycle ergometer). */
  | 'cycle'
  /** Lying on the back, pelvis on the floor (crunch). */
  | 'back'
  /** Toes and hands (or forearms) on the floor; body pitch is solved (push-up, plank). */
  | 'floor';

export interface Rig {
  anchor: Anchor;
  /** Arm angles are absolute: 0 = straight down, -90 = forward. */
  armsWorld?: boolean;
  /** Which arm point touches the floor for `floor` anchoring. */
  contact?: 'hand' | 'elbow';
  /** Hands fixed on the floor at this z (push-up): elbows are solved with 2-link IK. */
  handTargetZ?: number;
  /** Cycle ergometer geometry (anchor `cycle`). */
  cycle?: { pelvis: P2; crank: P2; radius: number; handlebar: P2 };
}

export interface P2 {
  y: number;
  z: number;
}

export interface Skeleton {
  pelvis: P2;
  neck: P2;
  head: P2;
  shoulder: P2;
  elbowL: P2;
  handL: P2;
  elbowR: P2;
  handR: P2;
  kneeL: P2;
  ankleL: P2;
  toeL: P2;
  kneeR: P2;
  ankleR: P2;
  toeR: P2;
}

const rad = (d: number) => (d * Math.PI) / 180;
const up = (a: number, len: number): P2 => ({ y: Math.cos(rad(a)) * len, z: Math.sin(rad(a)) * len });
const down = (a: number, len: number): P2 => ({ y: -Math.cos(rad(a)) * len, z: -Math.sin(rad(a)) * len });
const fwd = (a: number, len: number): P2 => ({ y: -Math.sin(rad(a)) * len, z: Math.cos(rad(a)) * len });
const add = (p: P2, q: P2): P2 => ({ y: p.y + q.y, z: p.z + q.z });

/** Forward kinematics with the pelvis at the origin. */
export function forwardKinematics(pose: Pose, pitch: number, armsWorld = false): Skeleton {
  const pelvis = { y: 0, z: 0 };
  const torsoA = pitch + pose.spine;
  const neck = add(pelvis, up(torsoA, SEG.torso));
  const head = add(neck, up(torsoA + pose.neck, SEG.neckToHead));
  const shoulder = add(pelvis, up(torsoA, SEG.torso - SEG.shoulderDrop));
  const arm = (s: number, e: number) => {
    const upperA = armsWorld ? s : torsoA + s;
    const foreA = armsWorld ? e : upperA + e;
    const elbow = add(shoulder, down(upperA, SEG.upperArm));
    return { elbow, hand: add(elbow, down(foreA, SEG.forearm)) };
  };
  const leg = (h: number, k: number, a: number) => {
    const thighA = pitch + h;
    const shinA = thighA + k;
    const knee = add(pelvis, down(thighA, SEG.thigh));
    const ankle = add(knee, down(shinA, SEG.shin));
    return { knee, ankle, toe: add(ankle, fwd(shinA + a, SEG.foot)) };
  };
  const L = arm(pose.shoulderL, pose.elbowL);
  const R = arm(pose.shoulderR, pose.elbowR);
  const LL = leg(pose.hipL, pose.kneeL, pose.ankleL);
  const RL = leg(pose.hipR, pose.kneeR, pose.ankleR);
  return {
    pelvis,
    neck,
    head,
    shoulder,
    elbowL: L.elbow,
    handL: L.hand,
    elbowR: R.elbow,
    handR: R.hand,
    kneeL: LL.knee,
    ankleL: LL.ankle,
    toeL: LL.toe,
    kneeR: RL.knee,
    ankleR: RL.ankle,
    toeR: RL.toe,
  };
}

function translate(s: Skeleton, d: P2): Skeleton {
  const out = {} as Skeleton;
  for (const k of Object.keys(s) as (keyof Skeleton)[]) out[k] = add(s[k], d);
  return out;
}

/** Body pitch that puts the arm contact point level with the toes (bisection, then a scan fallback). */
export function solveFloorPitch(pose: Pose, rig: Rig): number {
  const gap = (b: number) => {
    const s = forwardKinematics(pose, b, rig.armsWorld);
    const contact = rig.contact === 'elbow' ? s.elbowL : s.handL;
    const offset = rig.contact === 'elbow' ? 0.05 - CONTACT_HEIGHT : 0;
    return contact.y - offset - s.toeL.y;
  };
  let lo = 20;
  let hi = 115;
  if (gap(lo) * gap(hi) > 0) {
    let best = lo;
    for (let b = lo; b <= hi; b += 0.5) if (Math.abs(gap(b)) < Math.abs(gap(best))) best = b;
    return best;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gap(lo) * gap(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Elbow of a 2-link arm reaching from shoulder to hand; bends toward the feet (smaller z). */
export function solveElbow(shoulder: P2, hand: P2): P2 {
  const a = SEG.upperArm;
  const b = SEG.forearm;
  const dy = hand.y - shoulder.y;
  const dz = hand.z - shoulder.z;
  const d = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, Math.hypot(dy, dz)));
  const base = Math.atan2(dz, dy);
  const alpha = Math.acos((a * a + d * d - b * b) / (2 * a * d));
  const c1 = { y: shoulder.y + a * Math.cos(base + alpha), z: shoulder.z + a * Math.sin(base + alpha) };
  const c2 = { y: shoulder.y + a * Math.cos(base - alpha), z: shoulder.z + a * Math.sin(base - alpha) };
  return c1.z < c2.z ? c1 : c2;
}

/** Knee of a 2-link leg reaching from hip to ankle; bends forward (larger z). */
export function solveKnee(hip: P2, ankle: P2): P2 {
  const a = SEG.thigh;
  const b = SEG.shin;
  const dy = ankle.y - hip.y;
  const dz = ankle.z - hip.z;
  const d = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, Math.hypot(dy, dz)));
  const base = Math.atan2(dz, dy);
  const alpha = Math.acos((a * a + d * d - b * b) / (2 * a * d));
  const c1 = { y: hip.y + a * Math.cos(base + alpha), z: hip.z + a * Math.sin(base + alpha) };
  const c2 = { y: hip.y + a * Math.cos(base - alpha), z: hip.z + a * Math.sin(base - alpha) };
  return c1.z > c2.z ? c1 : c2;
}

/** Pedal positions for a crank angle (radians, 0 = top). Left and right are opposite. */
export function pedalPoints(crank: P2, radius: number, angle: number): { left: P2; right: P2 } {
  const at = (a: number) => ({ y: crank.y + radius * Math.cos(a), z: crank.z + radius * Math.sin(a) });
  return { left: at(angle), right: at(angle + Math.PI) };
}

/** Cycle ergometer: upper body from the pose, legs solved onto the pedals, hands on the handlebar. */
export function placeCycling(pose: Pose, rig: Rig, angle: number): Skeleton {
  const c = rig.cycle!;
  const raw = forwardKinematics(pose, pose.pitch ?? 0, false);
  const s = translate(raw, { y: c.pelvis.y - raw.pelvis.y, z: c.pelvis.z - raw.pelvis.z });
  const { left, right } = pedalPoints(c.crank, c.radius, angle);
  const lift = { y: 0.04, z: -0.03 }; // ankle sits just above and behind the pedal axle
  const ankleL = add(left, lift);
  const ankleR = add(right, lift);
  const toe = (a: P2) => add(a, { y: -0.03, z: SEG.foot });
  const elbow = solveElbow(s.shoulder, c.handlebar);
  return {
    ...s,
    kneeL: solveKnee(s.pelvis, ankleL),
    ankleL,
    toeL: toe(ankleL),
    kneeR: solveKnee(s.pelvis, ankleR),
    ankleR,
    toeR: toe(ankleR),
    elbowL: elbow,
    handL: c.handlebar,
    elbowR: elbow,
    handR: c.handlebar,
  };
}

/** World-space skeleton: anchored so feet, back or hands rest on the floor (y = 0). */
export function placeSkeleton(pose: Pose, rig: Rig): Skeleton {
  if (rig.anchor === 'floor') {
    const b = pose.pitch ?? solveFloorPitch(pose, rig);
    const raw = forwardKinematics(pose, b, rig.armsWorld);
    const s = translate(raw, { y: CONTACT_HEIGHT - raw.toeL.y, z: -raw.toeL.z });
    if (rig.handTargetZ !== undefined) {
      const hand = { y: CONTACT_HEIGHT, z: rig.handTargetZ };
      const elbow = solveElbow(s.shoulder, hand);
      return { ...s, elbowL: elbow, handL: hand, elbowR: elbow, handR: hand };
    }
    return s;
  }
  if (rig.anchor === 'cycle') return placeCycling(pose, rig, 0);
  const s = forwardKinematics(pose, pose.pitch ?? 0, rig.armsWorld);
  if (rig.anchor === 'back') return translate(s, { y: 0.12, z: 0 });
  if (rig.anchor === 'toes') return translate(s, { y: CONTACT_HEIGHT - s.toeL.y, z: SEG.foot - s.toeL.z });
  if (rig.anchor === 'lowestFoot') return translate(s, { y: ANKLE_HEIGHT - Math.min(s.ankleL.y, s.ankleR.y), z: 0 });
  return translate(s, { y: ANKLE_HEIGHT - s.ankleL.y, z: -s.ankleL.z });
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const k of Object.keys(a) as (keyof Pose)[]) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? av;
    out[k] = av + (bv - av) * t;
  }
  return out;
}

/** Smooth 0 → 1 → 0 cycle: hold briefly at both ends like a real repetition. */
export function repetitionPhase(timeS: number, periodS: number): number {
  const x = (timeS % periodS) / periodS;
  const tri = x < 0.5 ? x * 2 : 2 - x * 2;
  const held = Math.min(1, Math.max(0, (tri - 0.1) / 0.8));
  return held * held * (3 - 2 * held);
}

const STAND: Pose = { pitch: 0, spine: 0, neck: 0, shoulderL: 5, elbowL: -10, shoulderR: 5, elbowR: -10, hipL: 0, kneeL: 0, ankleL: 0, hipR: 0, kneeR: 0, ankleR: 0 };

export type Equipment =
  /** ARED: platform, a bar and the two load cables pulling it toward the platform. */
  | { kind: 'ared'; barAt: 'shoulders' | 'hands' }
  /** T2 treadmill belt plus the bungee harness holding the runner down. */
  | { kind: 'treadmill' }
  /** CEVIS cycle ergometer: crank, pedals and handlebar. */
  | { kind: 'cycle' };

export interface ExerciseMotion {
  rig: Rig;
  from: Pose;
  to: Pose;
  /** Seconds per repetition (or per pedal turn). */
  period: number;
  /** `rotate`: continuous crank rotation (cycling). Default: back-and-forth repetition. */
  kind?: 'oscillate' | 'rotate';
  equipment?: Equipment;
}

/** The figure at a moment in time (seconds): the single entry point for drawing and tests. */
export function skeletonAt(motion: ExerciseMotion, timeS: number): Skeleton {
  if (motion.kind === 'rotate') {
    const angle = ((timeS % motion.period) / motion.period) * Math.PI * 2;
    return placeCycling(motion.from, motion.rig, angle);
  }
  return placeSkeleton(lerpPose(motion.from, motion.to, repetitionPhase(timeS, motion.period)), motion.rig);
}

/** Where the ARED bar is for a skeleton (z), so the bar and its load cables can be drawn. */
export function aredBar(s: Skeleton, barAt: 'shoulders' | 'hands'): P2 {
  return barAt === 'hands' ? s.handL : add(s.shoulder, { y: 0.02, z: -0.08 });
}

/** Push-up: top pose with straight vertical arms; the hands then stay where they are and the elbows bend. */
const PUSHUP_TOP: Pose = { spine: 0, neck: -10, shoulderL: 0, elbowL: 0, shoulderR: 0, elbowR: 0, hipL: 0, kneeL: 0, ankleL: 10, hipR: 0, kneeR: 0, ankleR: 10 };
const PUSHUP_RIG: Rig = { anchor: 'floor', armsWorld: true, contact: 'hand' };
const PUSHUP_TOP_PITCH = solveFloorPitch(PUSHUP_TOP, PUSHUP_RIG);
const PUSHUP_MOTION: ExerciseMotion = {
  rig: { ...PUSHUP_RIG, handTargetZ: placeSkeleton({ ...PUSHUP_TOP, pitch: PUSHUP_TOP_PITCH }, PUSHUP_RIG).handL.z },
  period: 3,
  from: { ...PUSHUP_TOP, pitch: PUSHUP_TOP_PITCH },
  to: { ...PUSHUP_TOP, pitch: 86, ankleL: 4, ankleR: 4 },
};

export const EXERCISE_MOTIONS: Record<string, ExerciseMotion> = {
  squats: {
    rig: { anchor: 'feet' },
    period: 3.2,
    from: { ...STAND, shoulderL: -10, shoulderR: -10 },
    to: { pitch: 0, spine: 40, neck: -30, shoulderL: -130, elbowL: 0, shoulderR: -130, elbowR: 0, hipL: -90, kneeL: 110, ankleL: -20, hipR: -90, kneeR: 110, ankleR: -20 },
  },
  lunges: {
    rig: { anchor: 'feet' },
    period: 3.6,
    from: { ...STAND, shoulderL: 15, elbowL: -70, shoulderR: 15, elbowR: -70 },
    to: { pitch: 0, spine: 0, neck: 0, shoulderL: 15, elbowL: -70, shoulderR: 15, elbowR: -70, hipL: -90, kneeL: 90, ankleL: 0, hipR: 25, kneeR: 75, ankleR: -10 },
  },
  pushups: PUSHUP_MOTION,
  plank: {
    rig: { anchor: 'floor', armsWorld: true, contact: 'elbow' },
    period: 4,
    from: { spine: 0, neck: -10, shoulderL: 0, elbowL: -90, shoulderR: 0, elbowR: -90, hipL: 0, kneeL: 0, ankleL: 5, hipR: 0, kneeR: 0, ankleR: 5 },
    to: { spine: 2, neck: -12, shoulderL: 0, elbowL: -90, shoulderR: 0, elbowR: -90, hipL: -2, kneeL: 0, ankleL: 5, hipR: -2, kneeR: 0, ankleR: 5 },
  },
  aredSquat: {
    rig: { anchor: 'feet' },
    period: 3.4,
    equipment: { kind: 'ared', barAt: 'shoulders' },
    from: { ...STAND, shoulderL: 40, elbowL: -170, shoulderR: 40, elbowR: -170 },
    to: { pitch: 0, spine: 28, neck: -20, shoulderL: 40, elbowL: -170, shoulderR: 40, elbowR: -170, hipL: -90, kneeL: 110, ankleL: -20, hipR: -90, kneeR: 110, ankleR: -20 },
  },
  aredDeadlift: {
    rig: { anchor: 'feet', armsWorld: true },
    period: 3.6,
    equipment: { kind: 'ared', barAt: 'hands' },
    from: { ...STAND, shoulderL: 0, elbowL: 0, shoulderR: 0, elbowR: 0 },
    to: { pitch: 0, spine: 75, neck: -45, shoulderL: 0, elbowL: 0, shoulderR: 0, elbowR: 0, hipL: -25, kneeL: 35, ankleL: -10, hipR: -25, kneeR: 35, ankleR: -10 },
  },
  aredHeelRaise: {
    rig: { anchor: 'toes' },
    period: 2.4,
    equipment: { kind: 'ared', barAt: 'shoulders' },
    from: { ...STAND, shoulderL: 40, elbowL: -170, shoulderR: 40, elbowR: -170 },
    to: { ...STAND, shoulderL: 40, elbowL: -170, shoulderR: 40, elbowR: -170, ankleL: 32, ankleR: 32 },
  },
  treadmill: {
    rig: { anchor: 'lowestFoot' },
    period: 0.8,
    equipment: { kind: 'treadmill' },
    from: { pitch: 0, spine: 8, neck: -8, shoulderL: 30, elbowL: -90, shoulderR: -40, elbowR: -90, hipL: -35, kneeL: 20, ankleL: 0, hipR: 25, kneeR: 55, ankleR: 15 },
    to: { pitch: 0, spine: 8, neck: -8, shoulderL: -40, elbowL: -90, shoulderR: 30, elbowR: -90, hipL: 25, kneeL: 55, ankleL: 15, hipR: -35, kneeR: 20, ankleR: 0 },
  },
  cycle: {
    rig: { anchor: 'cycle', cycle: { pelvis: { y: 0.95, z: 0 }, crank: { y: 0.3, z: 0.38 }, radius: 0.17, handlebar: { y: 1.08, z: 0.58 } } },
    period: 1.1,
    kind: 'rotate',
    equipment: { kind: 'cycle' },
    from: { ...STAND, spine: 18, neck: -12 },
    to: { ...STAND, spine: 18, neck: -12 },
  },
  crunches: {
    rig: { anchor: 'back' },
    period: 3,
    from: { pitch: -90, spine: 0, neck: 10, shoulderL: -10, elbowL: -130, shoulderR: -10, elbowR: -130, hipL: -45, kneeL: 90, ankleL: 45, hipR: -45, kneeR: 90, ankleR: 45 },
    to: { pitch: -90, spine: 30, neck: 15, shoulderL: -10, elbowL: -130, shoulderR: -10, elbowR: -130, hipL: -45, kneeL: 90, ankleL: 45, hipR: -45, kneeR: 90, ankleR: 45 },
  },
};
