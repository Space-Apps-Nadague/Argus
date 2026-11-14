import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads `.env` from the project root. Variables already present in the process
 * environment win, so `AI_PROVIDERS=local npm run dev:server` overrides the file.
 */
export function loadEnv(): void {
  const file = resolve(process.cwd(), '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}
