/**
 * ARGUS — On-device face recognition engine (specs/02-ui-dashboard.md §6 "Face ID")
 *
 * Uses @vladmandic/face-api (TensorFlow.js) entirely in the browser: no image or face
 * template is sent anywhere. The models (~7 MB) are copied to /models/face by
 * `scripts/copy-face-models.mjs` and loaded only when Face ID is used.
 */

import { eyeAspectRatio } from './faceStore';

type FaceApi = typeof import('@vladmandic/face-api');

export const FACE_MODEL_URL = `${import.meta.env.BASE_URL ?? '/'}models/face`;

let loading: Promise<FaceApi> | null = null;

/** Loads the library and the three models once (detector, 68 landmarks, recognition). */
export function loadFaceEngine(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      // The bundled TensorFlow.js has these at runtime; face-api's type stub omits them.
      const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      const webgl = await tf.setBackend('webgl').catch(() => false);
      if (!webgl) await tf.setBackend('cpu');
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL),
      ]);
      return faceapi;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export interface FaceFrame {
  descriptor: Float32Array;
  /** Mean eye aspect ratio of both eyes (blink check). */
  ear: number;
  /** Detector confidence 0–1. */
  score: number;
  /** Face box relative to the video (0–1), to check the face is centred and close enough. */
  box: { x: number; y: number; width: number; height: number };
}

/** Reads the single most prominent face in the current video frame, or null. */
export async function readFace(faceapi: FaceApi, video: HTMLVideoElement): Promise<FaceFrame | null> {
  if (!video.videoWidth) return null;
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  const { landmarks, detection, descriptor } = result;
  const ear = (eyeAspectRatio(landmarks.getLeftEye()) + eyeAspectRatio(landmarks.getRightEye())) / 2;
  const b = detection.box;
  return {
    descriptor,
    ear,
    score: detection.score,
    box: { x: b.x / video.videoWidth, y: b.y / video.videoHeight, width: b.width / video.videoWidth, height: b.height / video.videoHeight },
  };
}
