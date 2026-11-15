/**
 * Data platform: server-side auth, role/access matrix, pseudonymization, AI chat link
 * (specs/05-data-platform.md §6, §3.5). Runs against an in-memory PGlite Postgres.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CrewMemberProfile } from '../../src/types/argus';
import { createApp } from '../app';
import { type DbHandle, openDb, setDbHandle } from '../db/client';
import { astronauts, auditLog, messages } from '../db/schema';
import { seedDatabase } from '../db/seed';

const ADMIN_PW = 'admin-password-123';
const DEMO_PW = 'demo-password-123';
const AI_ENV_PREFIXES = ['AI_', 'OPENROUTER_', 'GEMINI_', 'GROQ_'];

let h: DbHandle;
const app = createApp();
let ipCounter = 0;

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (AI_ENV_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
  }
  h = openDb('pglite:memory');
  await h.migrate();
  await seedDatabase(h.db, { adminUsername: 'admin', adminPassword: ADMIN_PW, demoPassword: DEMO_PW });
  setDbHandle(h);
}, 60_000);

afterAll(async () => {
  setDbHandle(null);
  await h.close();
});

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.0.0.${++ipCounter % 250}`, ...init.headers };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.cookie) headers.Cookie = init.cookie;
  return app.request(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function login(username: string, password: string): Promise<string> {
  const res = await req('/api/auth/login', { body: { username, password } });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = /argus_session=([^;]+)/.exec(setCookie);
  expect(m).toBeTruthy();
  expect(setCookie).toMatch(/HttpOnly/i);
  return `argus_session=${m![1]}`;
}

describe('auth', () => {
  it('reports server mode and no setup needed after seeding', async () => {
    const res = await req('/api/auth/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: 'server', user: null, setupNeeded: false, minPasswordLength: 10 });
  });

  it('refuses a second setup', async () => {
    const res = await req('/api/auth/setup', { body: { username: 'evil', password: 'long-enough-pw' } });
    expect(res.status).toBe(409);
  });

  it('rejects wrong passwords and locks the account after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await req('/api/auth/login', { body: { username: 'apex', password: 'wrong-password' } });
      expect(res.status).toBe(401);
    }
    const locked = await req('/api/auth/login', { body: { username: 'apex', password: DEMO_PW } });
    expect(locked.status).toBe(423);
    const audits = await h.db.select().from(auditLog).where(eq(auditLog.action, 'login_failed'));
    expect(audits.length).toBeGreaterThanOrEqual(5);
  });

  it('signs in, reports the user, and signs out (revoking the session)', async () => {
    const cookie = await login('valkyrie', DEMO_PW);
    const me = await (await req('/api/auth/me', { cookie })).json();
    expect(me.user).toMatchObject({ username: 'valkyrie', role: 'astronaut', crewId: 'crew-vance' });
    await req('/api/auth/logout', { body: {}, cookie });
    const after = await (await req('/api/auth/me', { cookie })).json();
    expect(after.user).toBeNull();
  });

  it('blocks cross-origin mutations', async () => {
    const res = await req('/api/auth/login', {
      body: { username: 'admin', password: ADMIN_PW },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});

describe('access matrix', () => {
  it('astronauts see the roster pseudonymized except themselves', async () => {
    const cookie = await login('valkyrie', DEMO_PW);
    const { crew } = (await (await req('/api/astronauts', { cookie })).json()) as { crew: CrewMemberProfile[] };
    expect(crew).toHaveLength(4);
    const me = crew.find((c) => c.id === 'crew-vance')!;
    const other = crew.find((c) => c.id === 'crew-chen')!;
    expect(me.name).toBe('CDR Elena Vance');
    expect(me.medicalNotes).not.toBe('');
    expect(other.name).toBe(other.callsign);
    expect(other.medicalNotes).toBe('');
  });

  it("astronauts can't read another astronaut's private data", async () => {
    const cookie = await login('valkyrie', DEMO_PW);
    expect((await req('/api/astronauts/crew-chen/private', { cookie })).status).toBe(403);
    expect((await req('/api/astronauts/crew-vance/private', { cookie })).status).toBe(200);
  });

  it('flight surgeons read every private record; admins none', async () => {
    const surgeon = await login('surgeon', DEMO_PW);
    expect((await req('/api/astronauts/crew-chen/private', { cookie: surgeon })).status).toBe(200);
    const admin = await login('admin', ADMIN_PW);
    expect((await req('/api/astronauts/crew-chen/private', { cookie: admin })).status).toBe(403);
  });

  it('only admins manage accounts', async () => {
    const astronaut = await login('pulse', DEMO_PW);
    expect((await req('/api/admin/users', { cookie: astronaut })).status).toBe(403);
    const admin = await login('admin', ADMIN_PW);
    const created = await req('/api/admin/users', {
      cookie: admin,
      body: { username: 'surgeon2', password: 'another-pass-1', role: 'flight_surgeon' },
    });
    expect(created.status).toBe(201);
    const dupe = await req('/api/admin/users', {
      cookie: admin,
      body: { username: 'second-vance', password: 'another-pass-1', role: 'astronaut', crewId: 'crew-vance' },
    });
    expect(dupe.status).toBe(400);
  });

  it('a password reset revokes existing sessions', async () => {
    const admin = await login('admin', ADMIN_PW);
    const { users } = await (await req('/api/admin/users', { cookie: admin })).json();
    const solaris = users.find((u: { username: string }) => u.username === 'solaris');
    const cookie = await login('solaris', DEMO_PW);
    await req(`/api/admin/users/${solaris.id}`, { method: 'PATCH', cookie: admin, body: { password: 'brand-new-pass-1' } });
    expect((await (await req('/api/auth/me', { cookie })).json()).user).toBeNull();
  });

  it('AI routes need a session and access to the crew member', async () => {
    const vance = (await (await req('/api/astronauts', { cookie: await login('valkyrie', DEMO_PW) })).json()).crew.find(
      (c: CrewMemberProfile) => c.id === 'crew-vance'
    );
    const body = { crewMember: { ...vance, id: 'crew-chen' }, scenarioId: 'nominal', zoneId: 'neuro' };
    expect((await req('/api/ai/guidance', { body })).status).toBe(401);
    const cookie = await login('valkyrie', DEMO_PW);
    expect((await req('/api/ai/guidance', { body, cookie })).status).toBe(403);
    expect((await req('/api/ai/guidance', { body: { ...body, crewMember: vance }, cookie })).status).toBe(200);
  });
});

describe('AI chat link', () => {
  it('stores the question and the reply with the context the AI saw', async () => {
    const cookie = await login('valkyrie', DEMO_PW);
    const { crew } = await (await req('/api/astronauts', { cookie })).json();
    const vance = crew.find((c: CrewMemberProfile) => c.id === 'crew-vance');
    const res = await req('/api/ai/chat', {
      cookie,
      body: { crewMember: vance, scenarioId: 'nominal', messages: [{ role: 'user', content: 'How is my sleep?' }] },
    });
    expect(res.status).toBe(200);
    await res.text(); // drain the SSE stream so the reply is stored

    const history = await (await req('/api/astronauts/crew-vance/conversations/latest', { cookie })).json();
    expect(history.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(history.messages[0].content).toBe('How is my sleep?');

    const stored = await h.db.select().from(messages).where(eq(messages.role, 'assistant'));
    expect(stored[0].source).toBe('offline_verified_cache');
    expect(stored[0].contextSnapshot).toMatchObject({ scenarioId: 'nominal', zoneStatuses: expect.any(Object) });

    const other = await login('pulse', DEMO_PW);
    expect((await req('/api/astronauts/crew-vance/conversations/latest', { cookie: other })).status).toBe(403);
  });
});

describe('data rights (spec 05 §6)', () => {
  it('astronauts switch their own cloud AI consent, not anyone else\'s', async () => {
    const cookie = await login('valkyrie', DEMO_PW);
    const off = await req('/api/astronauts/crew-vance', { method: 'PATCH', cookie, body: { aiConsent: false } });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { crewMember: CrewMemberProfile }).crewMember.aiConsent).toBe(false);
    const row = (await h.db.select().from(astronauts).where(eq(astronauts.id, 'crew-vance')))[0];
    expect(row.aiConsent).toBe(false);
    const { crew } = (await (await req('/api/astronauts', { cookie })).json()) as { crew: CrewMemberProfile[] };
    expect(crew.find((c) => c.id === 'crew-vance')!.aiConsent).toBe(false);

    expect((await req('/api/astronauts/crew-chen', { method: 'PATCH', cookie, body: { aiConsent: false } })).status).toBe(403);
    // Consent is the only field an astronaut may change on their own profile.
    expect((await req('/api/astronauts/crew-vance', { method: 'PATCH', cookie, body: { aiConsent: true, sex: 'male' } })).status).toBe(403);

    expect((await req('/api/astronauts/crew-vance', { method: 'PATCH', cookie, body: { aiConsent: true } })).status).toBe(200);
  });

  it('exports an astronaut\'s data to themself and flight surgeons only, and audits it', async () => {
    const self = await login('valkyrie', DEMO_PW);
    const res = await req('/api/astronauts/crew-vance/export', { cookie: self });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('argus-crew-vance-export.json');
    const data = (await res.json()) as Record<string, unknown> & { profile: CrewMemberProfile };
    expect(data.profile.id).toBe('crew-vance');
    for (const key of ['dailyMetrics', 'baselines', 'anomalies', 'triageEvents', 'wellbeing', 'conversations', 'messages']) {
      expect(Array.isArray(data[key])).toBe(true);
    }

    expect((await req('/api/astronauts/crew-chen/export', { cookie: self })).status).toBe(403);
    expect((await req('/api/astronauts/crew-chen/export', { cookie: await login('surgeon', DEMO_PW) })).status).toBe(200);
    expect((await req('/api/astronauts/crew-chen/export', { cookie: await login('admin', ADMIN_PW) })).status).toBe(403);
    expect((await req('/api/astronauts/crew-vance/export')).status).toBe(401);

    const audited = await h.db.select().from(auditLog).where(eq(auditLog.action, 'export'));
    expect(audited.map((r) => r.targetId)).toEqual(expect.arrayContaining(['crew-vance', 'crew-chen']));
  });

  it('only admins purge an astronaut, and purging removes the profile for good', async () => {
    const surgeon = await login('surgeon', DEMO_PW);
    const created = await req('/api/astronauts', {
      cookie: surgeon,
      body: {
        name: 'Test Purge',
        callsign: 'purgeme',
        role: 'Payload & Science Specialist',
        sex: 'female',
        age: 35,
        bloodType: 'O+',
        restingHrBaselineBpm: 60,
        preFlightOnsdMm: 4.8,
        countermeasureStreakSols: 0,
        defaultScenarioId: 'nominal',
        medicalNotes: 'none',
      },
    });
    expect(created.status).toBe(201);
    const { id } = ((await created.json()) as { crewMember: CrewMemberProfile }).crewMember;

    expect((await req(`/api/astronauts/${id}?purge=1`, { method: 'DELETE', cookie: surgeon })).status).toBe(403);
    const admin = await login('admin', ADMIN_PW);
    expect((await req(`/api/astronauts/${id}?purge=1`, { method: 'DELETE', cookie: admin })).status).toBe(200);
    expect(await h.db.select().from(astronauts).where(eq(astronauts.id, id))).toHaveLength(0);
    const audited = await h.db.select().from(auditLog).where(eq(auditLog.action, 'astronaut_purge'));
    expect(audited.map((r) => r.targetId)).toContain(id);
  });
});
