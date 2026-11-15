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
    // Interrupted the way prod was: early raw rows remain, but daily values only exist for the latest day.
    await h.db.execute(sql`delete from daily_metrics where astronaut_id = 'crew-chen' and day < current_date`);
    await h.db.execute(sql`delete from observations where astronaut_id = 'crew-chen' and ts > now() - interval '20 hours' and ts < now() - interval '3 hours'`);
    const firstDay = async () => (await queryRows<{ d: string }>(h.db, sql`select min(day)::text d from daily_metrics where astronaut_id = 'crew-chen'`))[0].d;
    const before = await firstDay();
    await backfillSimulated(h.db, { days: 1, preflightDays: 0, onlyMissing: true, secondaryEveryMin: 60 });
    const after = await firstDay();
    expect(after < before).toBe(true); // daily values reach back to the start of the window again
    expect(await first('crew-chen')).toBeTruthy();
  }, 120_000);
});

