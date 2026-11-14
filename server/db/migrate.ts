/** npm run db:migrate — applies committed SQL migrations to DATABASE_URL. */
import { loadEnv } from '../env';
import { openDb } from './client';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const h = openDb(url);
await h.migrate();
console.log(`[db:migrate] ${h.kind} schema is up to date`);
await h.close();
