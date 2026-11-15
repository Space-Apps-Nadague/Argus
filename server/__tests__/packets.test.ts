/**
 * Reports to Earth: access rules and light-time delivery in both directions
 * (specs/04-ai-backend.md §4.4). Runs against an in-memory PGlite Postgres.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EarthReport, MentalStateAssessment } from '../../src/types/assistant';
import { combineAssessment } from '../../shared/mentalState';
import { createApp } from '../app';
import { type DbHandle, openDb, setDbHandle } from '../db/client';
import { earthPackets, users } from '../db/schema';
import { seedDatabase } from '../db/seed';
import { hashPassword } from '../auth/passwords';

const PW = 'demo-password-123';
let h: DbHandle;
const app = createApp();
let ip = 0;

beforeAll(async () => {
  h = openDb('pglite:memory');
  await h.migrate();
  await seedDatabase(h.db, { adminUsername: 'admin', adminPassword: 'admin-password-123', demoPassword: PW });
  const existing = await h.db.select().from(users).where(eq(users.role, 'flight_surgeon')).limit(1);
  if (!existing.length) {
    await h.db.insert(users).values({ username: 'surgeon', passwordHash: await hashPassword(PW), role: 'flight_surgeon' });
  }
  setDbHandle(h);
}, 60_000);

afterAll(async () => {
  setDbHandle(null);
  await h.close();
});

function req(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.1.0.${++ip % 250}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.cookie) headers.Cookie = init.cookie;
  return app.request(path, { method: init.body === undefined ? 'GET' : 'POST', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function login(username: string): Promise<string> {
  const res = await req('/api/auth/login', { body: { username, password: PW } });
  expect(res.status).toBe(200);
  return `argus_session=${/argus_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
}

async function surgeonName(): Promise<string> {
  const [row] = await h.db.select().from(users).where(eq(users.role, 'flight_surgeon')).limit(1);
  return row.username;
}

const packet = (locationId: string, urgency = 'priority_packet') => ({
  urgency,
  kind: 'behavioral',
  summary: 'Behavioural health: signs of real strain.',
  locationId,
  payload: { packetId: 'p1', crewNotes: 'note', behavioralHealth: { assessment: combineAssessment({ userMessages: ['I feel hopeless'] }), countermeasures: [], history: [] } },
});

describe('reports to Earth', () => {
  it('needs a signed-in user and only lets crew write their own', async () => {
    expect((await req('/api/astronauts/crew-vance/packets', { body: packet('leo') })).status).toBe(401);
    const cookie = await login('valkyrie');
    expect((await req('/api/astronauts/crew-chen/packets', { body: packet('leo'), cookie })).status).toBe(403);
    expect((await req('/api/packets/inbox', { cookie })).status).toBe(403);
  });

  it('delivers at once from low Earth orbit and the surgeon can reply', async () => {
    const crew = await login('valkyrie');
    const created = await req('/api/astronauts/crew-vance/packets', { body: packet('leo'), cookie: crew });
    expect(created.status).toBe(201);
    const { report } = (await created.json()) as { report: EarthReport };
    expect(report.oneWayDelaySec).toBeLessThan(1);

    await new Promise((r) => setTimeout(r, 400));
    const surgeon = await login(await surgeonName());
    const inbox = ((await (await req('/api/packets/inbox', { cookie: surgeon })).json()) as { reports: EarthReport[] }).reports;
    const seen = inbox.find((r) => r.id === report.id)!;
    expect(seen).toBeTruthy();
    expect(seen.astronautLabel).toBeTruthy();
    expect(seen.payload.behavioralHealth?.assessment.concernLevel).toBe('concern');

    const reply = await req(`/api/packets/${report.id}/reply`, { body: { text: 'Rest today. We will call at the next window.' }, cookie: surgeon });
    expect(reply.status).toBe(200);
    await new Promise((r) => setTimeout(r, 400));
    const mine = ((await (await req('/api/astronauts/crew-vance/packets', { cookie: crew })).json()) as { reports: EarthReport[] }).reports;
    expect(mine.find((r) => r.id === report.id)?.reply).toMatchObject({ text: 'Rest today. We will call at the next window.', arrived: true });
  });

  it('holds a report from Mars until the light time has passed, both ways', async () => {
    const crew = await login('valkyrie');
    const { report } = (await (await req('/api/astronauts/crew-vance/packets', { body: packet('mars_surface', 'immediate_emergency_packet'), cookie: crew })).json()) as { report: EarthReport };
    expect(report.oneWayDelaySec).toBeGreaterThan(120);
    expect(report.delivered).toBe(false);

    const surgeon = await login(await surgeonName());
    const before = ((await (await req('/api/packets/inbox', { cookie: surgeon })).json()) as { reports: EarthReport[] }).reports;
    expect(before.some((r) => r.id === report.id)).toBe(false);
    expect((await req(`/api/packets/${report.id}/reply`, { body: { text: 'too early' }, cookie: surgeon })).status).toBe(404);

    // Let the light time pass.
    await h.db.update(earthPackets).set({ deliverAt: new Date(Date.now() - 1000) }).where(eq(earthPackets.id, report.id));
    const after = ((await (await req('/api/packets/inbox', { cookie: surgeon })).json()) as { reports: EarthReport[] }).reports;
    expect(after.some((r) => r.id === report.id)).toBe(true);

    await req(`/api/packets/${report.id}/reply`, { body: { text: 'Start the protocol.' }, cookie: surgeon });
    const mine = ((await (await req('/api/astronauts/crew-vance/packets', { cookie: crew })).json()) as { reports: EarthReport[] }).reports;
    expect(mine.find((r) => r.id === report.id)?.reply).toBeNull(); // still on its way back
  });

  it('stores and returns mental-state history in order', async () => {
    const crew = await login('valkyrie');
    const a1 = combineAssessment({ userMessages: ['all good'] });
    const a2 = combineAssessment({ userMessages: ["I'm overwhelmed and can't sleep"], previous: a1 });
    for (const a of [a1, a2]) expect((await req('/api/astronauts/crew-vance/mental-state', { body: a, cookie: crew })).status).toBe(201);
    const { history } = (await (await req('/api/astronauts/crew-vance/mental-state', { cookie: crew })).json()) as { history: MentalStateAssessment[] };
    expect(history.slice(-2).map((x) => x.concernLevel)).toEqual([a1.concernLevel, a2.concernLevel]);
  });
});
