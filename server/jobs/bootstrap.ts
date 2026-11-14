/**
 * Hosted bootstrap (specs/05-data-platform.md §2). The production database is private to the App Service
 * network, so the app fills it itself:
 * - first start on an empty database: seed (sources, catalog, crew, kits, admin, demo logins),
 *   30 days of simulated wearable history, and NASA reference data (best effort);
 * - every ARGUS_SIMULATE_TOPUP_MIN minutes (default 15, 0 = off): extend the simulated history to "now"
 *   so the demo never goes stale.
 * Enabled with ARGUS_BOOTSTRAP_ON_START=1. Passwords come only from app settings.
 */

import { count } from 'drizzle-orm';
import type { Db } from '../db/client';
import { astronauts, observations } from '../db/schema';
import { seedDatabase } from '../db/seed';
import { backfillSimulated } from '../ingest/backfill';

const log = (m: string) => console.log(`[ARGUS bootstrap] ${m}`);

export async function bootstrapIfEmpty(db: Db): Promise<void> {
  const [{ n: crew }] = await db.select({ n: count() }).from(astronauts);
  if (crew === 0) {
    log('empty database: seeding');
    await seedDatabase(db, {
      adminUsername: process.env.ARGUS_BOOTSTRAP_ADMIN_USERNAME,
      adminPassword: process.env.ARGUS_BOOTSTRAP_ADMIN_PASSWORD,
      demoPassword: process.env.ARGUS_DEMO_PASSWORD,
      log,
    });
  } else {
    // Keep the catalog and sources current after deploys (idempotent, no passwords changed).
    await seedDatabase(db, { log: () => {} });
  }
  const [{ n: obs }] = await db.select({ n: count() }).from(observations);
  if (obs === 0) {
    log('no observations: generating 30 days of simulated wearable history');
    await backfillSimulated(db, { days: 30, script: 'server/jobs/bootstrap.ts', log });
    try {
      const { loadReferenceCsvs } = await import('../ingest/reference');
      log(`NASA reference CSVs: ${JSON.stringify(await loadReferenceCsvs(db))}`);
    } catch (err) {
      log(`NASA reference load skipped: ${(err as Error).message}`);
    }
  }
}

export function startSimulatedTopUp(db: Db): NodeJS.Timeout | null {
  const minutes = Number(process.env.ARGUS_SIMULATE_TOPUP_MIN ?? 15);
  if (!minutes) return null;
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const n = await backfillSimulated(db, { topUpOnly: true, script: 'server/jobs/bootstrap.ts topup' });
      if (n) log(`top-up: ${n} readings`);
    } catch (err) {
      console.error('[ARGUS bootstrap] top-up failed', err);
    } finally {
      running = false;
    }
  }, minutes * 60_000);
}
