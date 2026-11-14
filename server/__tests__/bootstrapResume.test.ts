/** The first-start fill resumes after a restart: astronauts that already have history are skipped. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openDb, queryRows } from '../db/client';
import { seedDatabase } from '../db/seed';
import { backfillSimulated } from '../ingest/backfill';

let h: DbHandle;
beforeAll(async () => {
  h = openDb('pglite:memory');
  await h.migrate();
  await seedDatabase(h.db, {});
}, 60_000);
afterAll(async () => h.close());

const counts = async () =>
  Object.fromEntries(
    (await queryRows<{ astronaut_id: string; n: number }>(h.db, sql`select astronaut_id, count(*)::int n from observations where origin = 'simulated' group by 1`)).map((r) => [r.astronaut_id, r.n])
  );

describe('resumable bootstrap fill', () => {
  it('fills only astronauts without simulated history', async () => {
    await backfillSimulated(h.db, { days: 1, preflightDays: 0, crewIds: ['crew-vance'], secondaryEveryMin: 60 });
    const before = await counts();
    expect(Object.keys(before)).toEqual(['crew-vance']);
    await backfillSimulated(h.db, { days: 1, preflightDays: 0, onlyMissing: true, secondaryEveryMin: 60 });
    const after = await counts();
    expect(Object.keys(after).sort()).toEqual(['crew-chen', 'crew-lindqvist', 'crew-okafor', 'crew-vance']);
    expect(after['crew-vance']).toBe(before['crew-vance']); // not re-filled
  }, 120_000);

  it('clears and refills an astronaut whose fill was interrupted (history starts too late)', async () => {
    const first = async (id: string) =>
      (await queryRows<{ t: string }>(h.db, sql`select min(ts)::text t from observations where astronaut_id = ${id} and origin = 'simulated'`))[0].t;
    // Simulate an interrupted fill for APEX: only the last few hours exist.
    await h.db.execute(sql`delete from observations where astronaut_id = 'crew-chen'`);
    await backfillSimulated(h.db, { days: 1, preflightDays: 0, crewIds: ['crew-chen'], secondaryEveryMin: 60 });
    await h.db.execute(sql`delete from observations where astronaut_id = 'crew-chen' and ts < now() - interval '3 hours'`);
    const partialStart = new Date(await first('crew-chen')).getTime();
    await backfillSimulated(h.db, { days: 1, preflightDays: 0, onlyMissing: true, secondaryEveryMin: 60 });
    const repairedStart = new Date(await first('crew-chen')).getTime();
    expect(repairedStart).toBeLessThan(partialStart - 12 * 3600_000); // a full day again
  }, 120_000);
});

