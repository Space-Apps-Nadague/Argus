/**
 * ARGUS — On-device vision for the Photobooth (specs/02-ui-dashboard.md §2.7)
 * MediaPipe Tasks (Apache-2.0) gesture recogniser, running in the browser: a closed fist starts
 * the 3-second timer. No frame leaves the device. WASM is copied to /vision/wasm and the 8 MB
 * model is downloaded to public/models/vision by scripts/copy-vision-assets.mjs (if it is missing,
 * the online copy is used). Everything loads only when the tab is opened.
 */

import type { GestureRecognizer } from '@mediapipe/tasks-vision';

const BASE: string = import.meta.env.BASE_URL ?? '/';
/** Set VITE_VISION_REMOTE=true to load the WASM and model from the public CDNs instead (single-file preview). */
const REMOTE = import.meta.env.VITE_VISION_REMOTE === 'true';
export const VISION_VERSION = '1.2.3';

export const WASM_URL = REMOTE
  ? `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`
  : `${BASE}vision/wasm`;

const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';
const LOCAL_MODEL = `${BASE}models/vision/gesture_recognizer.task`;

export interface VisionModels {
  gestures: GestureRecognizer;
}

let loading: Promise<VisionModels> | null = null;

/** Loads the gesture model once: local copy first, then the online one; GPU, then CPU. */
export function loadVision(): Promise<VisionModels> {
  if (!loading) {
    loading = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      const sources = REMOTE ? [REMOTE_MODEL] : [LOCAL_MODEL, REMOTE_MODEL];
      let lastError: unknown;
      for (const modelAssetPath of sources) {
        for (const delegate of ['GPU', 'CPU'] as const) {
          try {
            const gestures = await vision.GestureRecognizer.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate },
              runningMode: 'VIDEO',
              numHands: 2,
            });
            return { gestures };
          } catch (err) {
            lastError = err;
          }
        }
      }
      throw lastError;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** True when a hand in the current frame is a closed fist. */
export function detectFist(m: VisionModels, video: HTMLVideoElement, now: number): boolean {
  const g = m.gestures.recognizeForVideo(video, now);
  return g.gestures.some((hand) => hand[0]?.categoryName === 'Closed_Fist' && hand[0].score > 0.6);
}
