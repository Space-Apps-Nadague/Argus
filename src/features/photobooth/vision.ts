/**
 * ARGUS — On-device vision for the Photobooth (specs/02-ui-dashboard.md §2.7)
 * MediaPipe Tasks (Apache-2.0), all running in the browser; no frame leaves the device:
 *  - selfie segmenter → cuts the person out for space backgrounds,
 *  - gesture recogniser → a closed fist starts the 3-second timer.
 * WASM is copied to /vision/wasm by scripts/copy-vision-assets.mjs. The segmenter model
 * is committed in public/models/vision; the 8 MB gesture model is downloaded there by the same
 * script (if it is missing, the online copy is used). Everything loads only when the tab is opened.
 */

import type { GestureRecognizer, ImageSegmenter } from '@mediapipe/tasks-vision';

const BASE: string = import.meta.env.BASE_URL ?? '/';
/** Set VITE_VISION_REMOTE=true to load the WASM and models from the public CDNs instead (single-file preview). */
const REMOTE = import.meta.env.VITE_VISION_REMOTE === 'true';
export const VISION_VERSION = '1.2.3';

export const WASM_URL = REMOTE
  ? `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`
  : `${BASE}vision/wasm`;

const REMOTE_MODELS: Record<string, string> = {
  'selfie_segmenter.tflite': 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  'gesture_recognizer.task': 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task',
};

export const modelUrl = (name: keyof typeof REMOTE_MODELS | string) =>
  REMOTE ? REMOTE_MODELS[name] : `${BASE}models/vision/${name}`;

export interface VisionModels {
  segmenter: ImageSegmenter;
  gestures: GestureRecognizer;
}

let loading: Promise<VisionModels> | null = null;

async function create<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

/** Loads the two models once. */
export function loadVision(): Promise<VisionModels> {
  if (!loading) {
    loading = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      const [segmenter, gestures] = await Promise.all([
        create((delegate) =>
          vision.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl('selfie_segmenter.tflite'), delegate },
            runningMode: 'VIDEO',
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          })
        ),
        create((delegate) =>
          vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl('gesture_recognizer.task'), delegate },
            runningMode: 'VIDEO',
            numHands: 2,
          })
        ).catch(() =>
          // Local copy not downloaded yet: use the online model.
          vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: REMOTE_MODELS['gesture_recognizer.task'] },
            runningMode: 'VIDEO',
            numHands: 2,
          })
        ),
      ]);
      return { segmenter, gestures };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Person mask (0–1 per pixel) copied out of MediaPipe, plus its size. */
export interface PersonMask {
  data: Float32Array;
  width: number;
  height: number;
}

/** One analysis pass on the current frame. Each part can be skipped to keep the frame rate up. */
export function analyseFrame(
  m: VisionModels,
  video: HTMLVideoElement,
  now: number,
  parts: { mask: boolean; gesture: boolean }
): { mask?: PersonMask; fist?: boolean } {
  const out: { mask?: PersonMask; fist?: boolean } = {};
  if (parts.mask) {
    m.segmenter.segmentForVideo(video, now, (result) => {
      const mask = result.confidenceMasks?.[0];
      if (mask) out.mask = { data: new Float32Array(mask.getAsFloat32Array()), width: mask.width, height: mask.height };
    });
  }
  if (parts.gesture) {
    const g = m.gestures.recognizeForVideo(video, now);
    out.fist = g.gestures.some((hand) => hand[0]?.categoryName === 'Closed_Fist' && hand[0].score > 0.6);
  }
  return out;
}
