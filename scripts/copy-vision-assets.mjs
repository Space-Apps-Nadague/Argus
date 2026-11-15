// Prepares the Photobooth vision assets (src/features/photobooth/vision.ts). Runs before `dev` and `build`.
//  1. Copies the MediaPipe Tasks WASM runtime into public/vision/wasm so Vite serves it offline.
//  2. Downloads the gesture model (8 MB, too large to keep in git) into public/models/vision once.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(root, 'public', 'vision', 'wasm');
const modelDir = join(root, 'public', 'models', 'vision');
const DOWNLOADS = {
  'gesture_recognizer.task':
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task',
  // Cognition games camera health check (src/features/cognition/faceCapture.ts), ~3.6 MB.
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

if (!existsSync(src)) {
  console.warn('[vision-assets] @mediapipe/tasks-vision not installed; Photobooth effects will be unavailable.');
} else {
  mkdirSync(wasmDest, { recursive: true });
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(wasmDest, f));
  console.log('[vision-assets] copied MediaPipe WASM to public/vision/wasm');
}

mkdirSync(modelDir, { recursive: true });
for (const [name, url] of Object.entries(DOWNLOADS)) {
  const target = join(modelDir, name);
  if (existsSync(target)) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log(`[vision-assets] downloaded ${name}`);
  } catch (err) {
    console.warn(`[vision-assets] could not download ${name} (${err.message}); the fist timer will use the online model.`);
  }
}
