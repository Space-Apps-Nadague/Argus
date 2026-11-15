/** Same-day resting HR fallback is refreshed as the day fills in, but never overrides the nightly watch value. */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openDb } from '../db/client';
import { dailyMetrics, observations } from '../db/schema';
import { seedDatabase } from '../db/seed';
import { rollupDays } from '../jobs/rollup';

let h: DbHandle;
beforeAll(async () => {
  h = openDb('pglite:memory');
  await h.migrate();
  await seedDatabase(h.db, {});
}, 60_000);
afterAll(async () => h.close());

const day = new Date('2026-11-15T00:00:00Z');
const at = (min: number) => new Date(day.getTime() + min * 60_000);
const hr = (min: number, value: number) => ({ astronautId: 'crew-vance', metricId: 'heart_rate', ts: at(min), value, origin: 'simulated' as const });
const resting = async () =>
  (await h.db.select().from(dailyMetrics).where(and(eq(dailyMetrics.astronautId, 'crew-vance'), eq(dailyMetrics.metricId, 'resting_hr'))))[0];

describe('resting HR daily value', () => {
  it('recomputes the fallback as more minutes arrive', async () => {
    await h.db.insert(observations).values(Array.from({ length: 15 }, (_, i) => hr(i, 72))); // 00:00–00:15 awake
    await rollupDays(h.db, 'crew-vance', day, at(15));
    expect((await resting()).value).toBeCloseTo(72);
    await h.db.insert(observations).values(Array.from({ length: 300 }, (_, i) => hr(60 + i, 58))); // asleep
    await rollupDays(h.db, 'crew-vance', day, at(360));
    const r = await resting();
    expect(r.method).toBe('p05_minute_hr');
    expect(r.value).toBeCloseTo(58);
  });

  it('keeps the nightly watch value once it exists', async () => {
    await h.db.insert(observations).values({ astronautId: 'crew-vance', metricId: 'resting_hr', ts: at(540), value: 61, origin: 'simulated' });
    await rollupDays(h.db, 'crew-vance', day, at(600));
    await h.db.execute(sql`select 1`);
    const r = await resting();
    expect(r.method).toBe('last_of_day');
    expect(r.value).toBe(61);
  });
});
