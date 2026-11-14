/** npm run data:nasa — load NASA reference data into DATABASE_URL (specs/05-data-platform.md §7). */
import { openDb } from '../../server/db/client';
import { loadEnv } from '../../server/env';
import { loadOsdr } from './osdr';
import { loadReferenceCsvs } from './reference';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const h = openDb(url);
await h.migrate();
console.log('[data:nasa] reference CSVs', await loadReferenceCsvs(h.db));
console.log('[data:nasa] OSDR', await loadOsdr(h.db, process.cwd(), (m) => console.log(m)));
await h.close();
