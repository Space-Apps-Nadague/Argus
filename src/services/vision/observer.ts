/**
 * On-device camera observer (specs/04-ai-backend.md §4.3).
 *
 * Every ~200 ms it reads the crew member's face with face-api (TensorFlow.js, in the
 * browser): 68 landmarks for eyes, mouth and head pose, the expression classifier for
 * emotion [SRC-102], and the forehead's green brightness for a pulse estimate [SRC-103].
 * Samples stay in memory for one minute; only the rolled-up `VisualObservation` and,
 * per the comm tier, a downscaled JPEG frame are ever sent to the assistant.
 */

import { eyeAspectRatio, headYaw } from '../../features/faceId/faceStore';
import { FACE_MODEL_URL } from '../../features/faceId/faceEngine';
import type { EmotionLabel, VisualObservation } from '../../types/assistant';
import { type FaceSample, summarize } from './signals';

type FaceApi = typeof import('@vladmandic/face-api');
interface Point {
  x: number;
  y: number;
}

let loading: Promise<FaceApi> | null = null;

/** Loads face-api with the detector, 68-landmark and expression models (~1.5 MB more than Face ID). */
export function loadObserverModels(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      const tf = faceapi.tf as unknown as { getBackend(): string; setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      if (tf.getBackend() !== 'webgl') {
        const webgl = await tf.setBackend('webgl').catch(() => false);
        if (!webgl) await tf.setBackend('cpu');
      }
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.isLoaded ? null : faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceLandmark68Net.isLoaded ? null : faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceExpressionNet.isLoaded ? null : faceapi.nets.faceExpressionNet.loadFromUri(FACE_MODEL_URL),
      ]);
      return faceapi;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts: Point[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/** Geometry from the 68 landmarks (iBUG layout). Exported for tests. */
export function geometryFromLandmarks(pts: Point[], frame: { width: number; height: number }) {
  const leftEye = pts.slice(36, 42);
  const rightEye = pts.slice(42, 48);
  const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2;
  const mouthWidth = dist(pts[60], pts[64]);
  const mar = mouthWidth > 0 ? dist(pts[62], pts[66]) / mouthWidth : 0;
  const lc = centre(leftEye);
  const rc = centre(rightEye);
  const rollDeg = (Math.atan2(rc.y - lc.y, rc.x - lc.x) * 180) / Math.PI;
  const yaw = headYaw(pts[36], pts[45], pts[30]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // Forehead: above the inner brows, a third of the brow-to-chin height.
  const browY = Math.min(pts[19].y, pts[24].y);
  const faceH = maxY - browY;
  const forehead = {
    x: pts[20].x,
    y: Math.max(0, browY - faceH * 0.3),
    width: Math.max(4, pts[23].x - pts[20].x),
    height: Math.max(4, faceH * 0.22),
  };
  return {
    ear,
    mar,
    rollDeg,
    yaw,
    cx: (Math.min(...xs) + Math.max(...xs)) / 2 / frame.width,
    cy: (minY + maxY) / 2 / frame.height,
    size: (maxY - minY) / frame.height,
    forehead,
  };
}

export interface ObserverOptions {
  intervalMs?: number;
  windowSec?: number;
  /** Called with a fresh summary about once a second. */
  onObservation?: (obs: VisualObservation) => void;
  onError?: (message: string) => void;
}

export class CameraObserver {
  private samples: FaceSample[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private canvas = document.createElement('canvas');
  private lastEmit = 0;
  private latest: VisualObservation | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly opts: ObserverOptions = {}
  ) {}

  get observation(): VisualObservation | null {
    return this.latest;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let faceapi: FaceApi;
    try {
      faceapi = await loadObserverModels();
    } catch {
      this.running = false;
      this.opts.onError?.('Face analysis models could not load.');
      return;
    }
    const interval = this.opts.intervalMs ?? 200;
    const detector = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });
    const tick = async () => {
      if (!this.running) return;
      const started = performance.now();
      try {
        await this.sample(faceapi, detector);
      } catch {
        // one bad frame is not worth surfacing
      }
      const now = performance.now();
      if (now - this.lastEmit >= 1000) {
        this.lastEmit = now;
        this.latest = summarize(this.samples, now, this.opts.windowSec ?? 30);
        this.opts.onObservation?.(this.latest);
      }
      // Keep the loop from hogging a slow machine: never less than the work time again.
      this.timer = setTimeout(tick, Math.max(interval - (now - started), (now - started) * 0.5, 40));
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.samples = [];
    this.latest = null;
  }

  private async sample(faceapi: FaceApi, detector: InstanceType<FaceApi['TinyFaceDetectorOptions']>): Promise<void> {
    const v = this.video;
    const t = performance.now();
    if (!v.videoWidth || v.readyState < 2) return;
    const result = await faceapi.detectSingleFace(v, detector).withFaceLandmarks().withFaceExpressions();
    if (!result) {
      this.push({ t, facePresent: false });
      return;
    }
    const geo = geometryFromLandmarks(result.landmarks.positions, { width: v.videoWidth, height: v.videoHeight });
    const expressions = result.expressions as unknown as Record<EmotionLabel, number>;
    this.push({
      t,
      facePresent: true,
      ear: geo.ear,
      mar: geo.mar,
      rollDeg: geo.rollDeg,
      yaw: geo.yaw,
      cx: geo.cx,
      cy: geo.cy,
      size: geo.size,
      expressions: {
        neutral: expressions.neutral,
        happy: expressions.happy,
        sad: expressions.sad,
        angry: expressions.angry,
        fearful: expressions.fearful,
        surprised: expressions.surprised,
        disgusted: expressions.disgusted,
      },
      green: this.foreheadGreen(geo.forehead),
    });
  }

  private foreheadGreen(r: { x: number; y: number; width: number; height: number }): number | undefined {
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < 4 || h < 4) return undefined;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(this.video, r.x, r.y, r.width, r.height, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 1; i < data.length; i += 4) sum += data[i];
    return sum / (data.length / 4);
  }

  private push(s: FaceSample): void {
    this.samples.push(s);
    const cutoff = s.t - 60_000;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
  }
}

/** Downscaled JPEG of the current frame for the model (base64 without prefix), or null. */
export function captureFrame(video: HTMLVideoElement, maxEdge: number, quality = 0.75): string | null {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? null;
}
