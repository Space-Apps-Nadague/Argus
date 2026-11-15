/**
 * ARGUS — Camera capture for the cognition health check (specs/02-ui-dashboard.md §2.8).
 * Runs MediaPipe Face Landmarker (Apache-2.0) in the browser at ~15 frames/s while a game is played
 * and turns each frame into a few numbers (faceVitals.ts). No image is stored or sent anywhere.
 * The model is copied to public/models/vision by scripts/copy-vision-assets.mjs (online fallback).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { WASM_URL } from '../photobooth/vision';
import { summarizeFace, type FaceFrame, type FaceVitalsSummary } from './faceVitals';

const BASE: string = import.meta.env.BASE_URL ?? '/';
const REMOTE = import.meta.env.VITE_VISION_REMOTE === 'true';
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const LOCAL_MODEL = `${BASE}models/vision/face_landmarker.task`;
const FRAME_MS = 66; // ~15 frames/s

// Face mesh landmark indices (MediaPipe 478-point mesh).
const EYE_R = { outer: 33, inner: 133, iris: 468 };
const EYE_L = { outer: 263, inner: 362, iris: 473 };
const CHEEK_R = 234;
const CHEEK_L = 454;
const NOSE = 1;
const SKIN = [151, 50, 280]; // forehead, right cheek, left cheek

let loading: Promise<FaceLandmarker> | null = null;

function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!loading) {
    loading = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      let lastError: unknown;
      for (const modelAssetPath of REMOTE ? [REMOTE_MODEL] : [LOCAL_MODEL, REMOTE_MODEL]) {
        for (const delegate of ['GPU', 'CPU'] as const) {
          try {
            return await vision.FaceLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate },
              runningMode: 'VIDEO',
              numFaces: 1,
              outputFaceBlendshapes: true,
            });
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

const px = (p: NormalizedLandmark, w: number, h: number) => ({ x: p.x * w, y: p.y * h });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Iris centre relative to the eye's midpoint, in eye widths (image space, so both eyes move together). */
function irisOffset(lm: NormalizedLandmark[], eye: typeof EYE_R, w: number, h: number) {
  const o = px(lm[eye.outer], w, h);
  const i = px(lm[eye.inner], w, h);
  const c = px(lm[eye.iris], w, h);
  const width = dist(o, i);
  if (!width) return null;
  return { x: (c.x - (o.x + i.x) / 2) / width, y: (c.y - (o.y + i.y) / 2) / width };
}

/** Mean RGB of small patches around forehead and cheeks. */
function skinColour(ctx: CanvasRenderingContext2D, lm: NormalizedLandmark[]): [number, number, number] | null {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const idx of SKIN) {
    const cx = Math.round(lm[idx].x * W);
    const cy = Math.round(lm[idx].y * H);
    if (cx < 3 || cy < 3 || cx > W - 4 || cy > H - 4) continue;
    const d = ctx.getImageData(cx - 3, cy - 3, 7, 7).data;
    for (let k = 0; k < d.length; k += 4) {
      r += d[k];
      g += d[k + 1];
      b += d[k + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

export function frameFrom(lm: NormalizedLandmark[] | undefined, blink: number | null, rgb: FaceFrame['rgb'], w: number, h: number, t: number): FaceFrame {
  if (!lm || lm.length < 474) return { t, blink: null, gaze: null, rgb: null, widthRatio: null };
  const a = irisOffset(lm, EYE_R, w, h);
  const b = irisOffset(lm, EYE_L, w, h);
  const gaze = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  const nose = px(lm[NOSE], w, h);
  const cr = px(lm[CHEEK_R], w, h);
  const cl = px(lm[CHEEK_L], w, h);
  const dl = dist(nose, cr);
  const dr = dist(nose, cl);
  const frontal = Math.abs(dl - dr) / (dl + dr) < 0.08;
  const eyes = dist(px(lm[EYE_R.outer], w, h), px(lm[EYE_L.outer], w, h));
  return { t, blink, gaze, rgb, widthRatio: frontal && eyes ? dist(cr, cl) / eyes : null };
}

export type FaceCaptureState = 'off' | 'starting' | 'on' | 'error';

/**
 * While `enabled`, keeps the camera and model running; frames are recorded only between
 * `record()` and `finish()`. `finish()` returns the summary of the recorded frames.
 */
export function useFaceCapture(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<FaceCaptureState>('off');
  const [faceSeen, setFaceSeen] = useState(false);
  const frames = useRef<FaceFrame[]>([]);
  const recording = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setState('off');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let lastTs = 0;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    setState('starting');
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      if (cancelled) return;
      const v = videoRef.current;
      if (!v) throw new Error('no video element');
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const model = await loadFaceLandmarker();
      if (cancelled) return;
      setState('on');
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const now = performance.now();
        if (now - lastTs < FRAME_MS || v.readyState < 2) return;
        lastTs = now;
        try {
          const res = model.detectForVideo(v, now);
          const lm = res.faceLandmarks?.[0];
          const shapes = res.faceBlendshapes?.[0]?.categories;
          const score = (name: string) => shapes?.find((c) => c.categoryName === name)?.score;
          const bl = score('eyeBlinkLeft');
          const br = score('eyeBlinkRight');
          const blink = lm && bl !== undefined && br !== undefined ? (bl + br) / 2 : lm ? 0 : null;
          let rgb: FaceFrame['rgb'] = null;
          if (lm && recording.current) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            rgb = skinColour(ctx, lm);
          }
          setFaceSeen((prev) => (prev === Boolean(lm) ? prev : Boolean(lm)));
          if (recording.current) frames.current.push(frameFrom(lm, blink, rgb, v.videoWidth || 640, v.videoHeight || 480, now));
        } catch {
          /* skip this frame */
        }
      };
      raf = requestAnimationFrame(loop);
    })().catch(() => {
      if (!cancelled) setState('error');
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  const record = useCallback(() => {
    frames.current = [];
    recording.current = true;
  }, []);

  const finish = useCallback((): FaceVitalsSummary | null => {
    recording.current = false;
    const s = summarizeFace(frames.current);
    frames.current = [];
    return s;
  }, []);

  return { videoRef, state, faceSeen, record, finish };
}
