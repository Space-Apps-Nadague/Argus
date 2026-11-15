/**
 * Hosted bootstrap (specs/05-data-platform.md §2). The production database is private to the App Service
 * network, so the app fills it itself:
 * - on start: seed an empty database (sources, catalog, crew, kits, admin, demo logins); give every astronaut
 *   without simulated history 30 days of it (resumable after restarts); load NASA reference data if missing;
 * - every ARGUS_SIMULATE_TOPUP_MIN minutes (default 15, 0 = off): extend the simulated history to "now"
 *   so the demo never goes stale;
 * - on start: sync the AI knowledge base (spec 05 §3.6) with the deployed corpus; unchanged documents are skipped.
 * Enabled with ARGUS_BOOTSTRAP_ON_START=1. Passwords come only from app settings.
 */

import { count } from 'drizzle-orm';
import type { Db } from '../db/client';
import { astronauts, refRadiationDoseRates } from '../db/schema';
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
  // Resumable: each astronaut without simulated history gets it, so a restart mid-fill continues where it stopped.
  const filled = await backfillSimulated(db, { days: 30, onlyMissing: true, script: 'server/jobs/bootstrap.ts', log });
  if (filled) log(`simulated history added: ${filled} readings`);
  const [{ n: refRows }] = await db.select({ n: count() }).from(refRadiationDoseRates);
  if (refRows === 0) {
    try {
      const { loadReferenceCsvs } = await import('../ingest/reference');
      log(`NASA reference CSVs: ${JSON.stringify(await loadReferenceCsvs(db))}`);
    } catch (err) {
      log(`NASA reference load skipped: ${(err as Error).message}`);
    }
  }
  // Idempotent, so every deploy picks up new or edited corpus files.
  try {
    const { ingestKnowledge } = await import('../rag/ingest');
    await ingestKnowledge(db, { script: 'server/jobs/bootstrap.ts', log });
  } catch (err) {
    log(`AI knowledge base sync failed: ${(err as Error).message}`);
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
