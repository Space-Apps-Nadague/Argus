// Copies the three Face ID models from @vladmandic/face-api into public/models/face
// so Vite serves them (offline, no CDN). Runs before `dev` and `build`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@vladmandic', 'face-api', 'model');
const dest = join(root, 'public', 'models', 'face');
const MODELS = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];

if (!existsSync(src)) {
  console.warn('[face-models] @vladmandic/face-api not installed; Face ID will be unavailable.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const m of MODELS) {
  for (const f of [`${m}-weights_manifest.json`, `${m}.bin`]) copyFileSync(join(src, f), join(dest, f));
}
console.log(`[face-models] copied ${MODELS.length} models to public/models/face`);
