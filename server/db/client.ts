/**
 * ARGUS — Database client (specs/05-data-platform.md §2)
 *
 * DATABASE_URL selects the engine:
 *   postgres://…            → real PostgreSQL (Azure Flexible Server, Docker) via postgres-js
 *   pglite:./.data/argus     → embedded PGlite (Postgres in WebAssembly) stored in a folder, no install needed
 *   pglite:memory            → throwaway in-memory PGlite (tests)
 */

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { resolveDatabaseUrl } from './connectionString';
import * as schema from './schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDb(url: string): DbHandle {
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    const inMemory = target === '' || target === 'memory';
    if (!inMemory) mkdirSync(resolve(target), { recursive: true });
    // In-memory PGlite only honours options when they are the first argument.
    const client = inMemory ? new PGlite({ extensions: { citext } }) : new PGlite(resolve(target), { extensions: { citext } });
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return {
      db,
      kind: 'pglite',
      migrate: () => migratePglite(db as never, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => client.close(),
    };
  }
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX) || 5, onnotice: () => {} });
  const db = drizzlePg(client, { schema }) as unknown as Db;
  return {
    db,
    kind: 'postgres',
    migrate: () => migratePg(db as never, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.end({ timeout: 5 }),
  };
}

let handle: DbHandle | null = null;

/** The process-wide database, or null when DATABASE_URL is not set (stateless/offline mode). */
export function getDb(): Db | null {
  if (handle) return handle.db;
  const url = resolveDatabaseUrl();
  if (!url) return null;
  handle = openDb(url);
  return handle.db;
}

export function getDbHandle(): DbHandle | null {
  getDb();
  return handle;
}

/** Tests: replace the process-wide database. */
export function setDbHandle(next: DbHandle | null): void {
  handle = next;
}

/** Normalizes `db.execute` results across postgres-js (array) and PGlite (`{ rows }`). */
export async function queryRows<T = Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as T[] | { rows: T[] };
  return Array.isArray(res) ? res : res.rows;
}

export { sql };
