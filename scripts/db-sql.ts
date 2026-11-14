/** npm run db:sql -- "select count(*) from observations"  — ad-hoc query against DATABASE_URL. */
import { openDb, queryRows, sql } from '../server/db/client';
import { loadEnv } from '../server/env';

loadEnv();
const url = process.env.DATABASE_URL;
const query = process.argv.slice(2).join(' ');
if (!url || !query) {
  console.error('Usage: npm run db:sql -- "<SQL>"  (needs DATABASE_URL)');
  process.exit(1);
}
const h = openDb(url);
console.table(await queryRows(h.db, sql.raw(query)));
await h.close();
