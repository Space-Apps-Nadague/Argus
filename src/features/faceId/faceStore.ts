/**
 * ARGUS — Face ID enrollment store & matching (specs/02-ui-dashboard.md §6 "Face ID")
 *
 * Pure helpers, no camera or model code, so they are unit-tested.
 * The face template (a 128-number descriptor) never leaves this device: it is kept in
 * localStorage next to a device sign-in token (server mode) or the local user id (offline demo).
 */

export const FACE_ID_STORAGE_KEY = 'argus_face_id_v1';
/** Euclidean distance below which two descriptors are the same person (face-api.js recommends 0.6; we are stricter). */
export const FACE_MATCH_THRESHOLD = 0.45;
/** Blink = eyes drop below this share of the person's own open-eye ratio, then reopen. */
export const BLINK_CLOSED_RATIO = 0.75;
export const BLINK_REOPEN_RATIO = 0.88;
/** Head turn = nose moves this share of the eye distance sideways (left-right range). */
export const HEAD_TURN_RANGE = 0.22;

export interface FaceEnrollment {
  userId: string;
  username: string;
  descriptor: number[];
  /** Server mode: device sign-in token issued at enrollment (only its hash is stored on the server). */
  token?: string;
  createdAtIso: string;
}

export interface Point {
  x: number;
  y: number;
}

export function faceDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Mean of several captures: a steadier template than a single frame. */
export function averageDescriptors(descriptors: ArrayLike<number>[]): number[] {
  if (!descriptors.length) return [];
  const n = descriptors[0].length;
  const out = new Array<number>(n).fill(0);
  for (const d of descriptors) for (let i = 0; i < n; i++) out[i] += d[i] / descriptors.length;
  return out;
}

/** Closest enrolled face under the threshold, or null. */
export function matchFace(
  descriptor: ArrayLike<number>,
  enrollments: FaceEnrollment[],
  threshold = FACE_MATCH_THRESHOLD
): { enrollment: FaceEnrollment; distance: number } | null {
  let best: { enrollment: FaceEnrollment; distance: number } | null = null;
  for (const enrollment of enrollments) {
    const distance = faceDistance(descriptor, enrollment.descriptor);
    if (distance < threshold && (!best || distance < best.distance)) best = { enrollment, distance };
  }
  return best;
}

/** Eye aspect ratio from the 6 landmarks of one eye (Soukupová & Čech 2016). */
export function eyeAspectRatio(eye: Point[]): number {
  if (eye.length !== 6) return 1;
  const d = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const horizontal = d(eye[0], eye[3]);
  if (horizontal === 0) return 1;
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * horizontal);
}

/**
 * Blink liveness: the eyes close and reopen relative to this person's own open-eye ratio
 * (the highest recent value), so it works for any eye shape and camera distance.
 * A printed photo or a still image on a screen cannot do this.
 */
export function detectBlink(earSeries: number[]): boolean {
  let open = 0;
  let closed = false;
  for (const ear of earSeries) {
    if (!closed) {
      open = Math.max(open, ear);
      if (open >= 0.15 && ear < open * BLINK_CLOSED_RATIO) closed = true;
    } else if (ear > open * BLINK_REOPEN_RATIO) {
      return true;
    }
  }
  return false;
}

/** Head-turn liveness: the nose moved sideways relative to the eyes (yaw proxy series). */
export function detectHeadTurn(yawSeries: number[]): boolean {
  if (yawSeries.length < 2) return false;
  return Math.max(...yawSeries) - Math.min(...yawSeries) >= HEAD_TURN_RANGE;
}

/** Nose offset from the eye midpoint, in eye distances: about 0 facing the camera, ± when the head turns. */
export function headYaw(leftEyeOuter: Point, rightEyeOuter: Point, noseTip: Point): number {
  const iod = Math.hypot(rightEyeOuter.x - leftEyeOuter.x, rightEyeOuter.y - leftEyeOuter.y);
  if (iod === 0) return 0;
  return (noseTip.x - (leftEyeOuter.x + rightEyeOuter.x) / 2) / iod;
}

export function loadEnrollments(): FaceEnrollment[] {
  try {
    const raw = localStorage.getItem(FACE_ID_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (e): e is FaceEnrollment =>
            Boolean(e) && typeof e.userId === 'string' && Array.isArray(e.descriptor) && e.descriptor.length === 128
        )
      : [];
  } catch {
    return [];
  }
}

export function saveEnrollments(list: FaceEnrollment[]): void {
  try {
    localStorage.setItem(FACE_ID_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: Face ID will not persist */
  }
}

/** One enrollment per user on this device: a new scan replaces the old one. */
export function upsertEnrollment(list: FaceEnrollment[], next: FaceEnrollment): FaceEnrollment[] {
  return [...list.filter((e) => e.userId !== next.userId), next];
}
