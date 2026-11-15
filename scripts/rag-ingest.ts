/**
 * npm run rag:ingest [-- --force] — builds the AI knowledge base in DATABASE_URL (specs/05-data-platform.md §3.6)
 * using the AI_EMBEDDINGS model. Applies migrations first so a fresh database works.
 */
import { openDb } from '../server/db/client';
import { resolveDatabaseUrl } from '../server/db/connectionString';
import { loadEnv } from '../server/env';
import { ingestKnowledge } from '../server/rag/ingest';

loadEnv();
const url = resolveDatabaseUrl();
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example). Without a database the AI uses the in-memory corpus.');
  process.exit(1);
}
const h = openDb(url);
try {
  await h.migrate();
  const s = await ingestKnowledge(h.db, {
    force: process.argv.includes('--force'),
    script: 'scripts/rag-ingest.ts',
    log: (m) => console.log(`[rag:ingest] ${m}`),
  });
  if (s.errors.length) process.exitCode = 2;
} finally {
  await h.close();
}
