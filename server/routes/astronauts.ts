/**
 * /api/astronauts — crew roster, private details and data export (specs/05-data-platform.md §6, §8)
 */

import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { canManageRoster, canReadAstronaut, canReadPrivate } from '../auth/access';
import { audit } from '../auth/audit';
import { requireAuth } from '../auth/session';
import type { AppEnv } from '../auth/types';
import { conversationMessages, latestConversationId, startConversation } from '../db/chatLog';
import { DEMO_MISSION_ID, ensureSensorKits } from '../db/seed';
import { getProfile, listProfiles } from '../db/profiles';
import {
  anomalies,
  astronautPrivate,
  astronauts,
  baselines,
  conversations,
  dailyMetrics,
  messages,
  triageEvents,
  wellbeingCheckIns,
} from '../db/schema';
import { CrewMemberSchema, ScenarioIdSchema } from '../schemas';
import { parseBody } from './util';

export const astronautRoutes = new Hono<AppEnv>();
astronautRoutes.use('/astronauts', requireAuth());
astronautRoutes.use('/astronauts/*', requireAuth());

const NewAstronautSchema = CrewMemberSchema.omit({ id: true, missionDaysLogged: true, isCustom: true }).extend({
  countermeasureStreakSols: z.number().min(0).max(5000).optional(),
});
const PatchAstronautSchema = z.object({
  sex: z.enum(['female', 'male']).optional(),
  defaultScenarioId: ScenarioIdSchema.optional(),
  aiConsent: z.boolean().optional(),
  medicalNotes: z.string().max(2000).optional(),
});

function noDb(c: { json: (b: unknown, s: 503) => Response }) {
  return c.json({ error: 'Database not configured' }, 503);
}

astronautRoutes.get('/astronauts', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  return c.json({ crew: await listProfiles(db, c.get('user')) });
});

astronautRoutes.post('/astronauts', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const user = c.get('user');
  if (!canManageRoster(user)) return c.json({ error: 'Only admins and flight surgeons can add crew.' }, 403);
  const body = await parseBody(c, NewAstronautSchema);
  if (!body.ok) return body.response;
  const p = body.data;
  const id = `crew-${randomBytes(5).toString('hex')}`;
  await db.insert(astronauts).values({
    id,
    missionId: DEMO_MISSION_ID,
    callsign: p.callsign.trim().toUpperCase(),
    sex: p.sex,
    birthYear: new Date().getUTCFullYear() - p.age,
    bloodType: p.bloodType,
    crewRole: p.role,
    restingHrBaselineBpm: p.restingHrBaselineBpm,
    preFlightOnsdMm: p.preFlightOnsdMm,
    defaultScenarioId: p.defaultScenarioId,
    countermeasureStreakSols: p.countermeasureStreakSols ?? 0,
  });
  await db.insert(astronautPrivate).values({ astronautId: id, legalName: p.name.trim(), medicalNotes: p.medicalNotes });
  await ensureSensorKits(db);
  await audit(c, { action: 'astronaut_create', targetType: 'astronaut', targetId: id });
  return c.json({ crewMember: await getProfile(db, id, user, { forceFull: true }) }, 201);
});

astronautRoutes.patch('/astronauts/:id', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await parseBody(c, PatchAstronautSchema);
  if (!body.ok) return body.response;
  const { medicalNotes, ...rest } = body.data;
  // Astronauts may change their own consent; everything else needs roster rights.
  const selfConsentOnly = Object.keys(body.data).every((k) => k === 'aiConsent') && user?.astronautId === id;
  if (!canManageRoster(user) && !selfConsentOnly) return c.json({ error: 'Not allowed' }, 403);
  if (medicalNotes !== undefined && !canReadPrivate(user, id)) return c.json({ error: 'Not allowed to edit medical notes' }, 403);
  if (!(await getProfile(db, id, user))) return c.json({ error: 'Crew member not found' }, 404);
  if (Object.keys(rest).length) await db.update(astronauts).set(rest).where(eq(astronauts.id, id));
  if (medicalNotes !== undefined) await db.update(astronautPrivate).set({ medicalNotes }).where(eq(astronautPrivate.astronautId, id));
  await audit(c, { action: 'astronaut_update', targetType: 'astronaut', targetId: id, detail: Object.keys(body.data) });
  return c.json({ crewMember: await getProfile(db, id, user) });
});

/** Archive (soft delete). `?purge=1` (admin only) hard-deletes the astronaut and all their data. */
astronautRoutes.delete('/astronauts/:id', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const user = c.get('user');
  const id = c.req.param('id');
  const purge = c.req.query('purge') === '1';
  if (purge ? user?.role !== 'admin' : !canManageRoster(user)) return c.json({ error: 'Not allowed' }, 403);
  const existing = await getProfile(db, id, user, { includeArchived: true });
  if (!existing) return c.json({ error: 'Crew member not found' }, 404);
  if (purge) await db.delete(astronauts).where(eq(astronauts.id, id));
  else await db.update(astronauts).set({ archivedAt: new Date() }).where(eq(astronauts.id, id));
  await audit(c, { action: purge ? 'astronaut_purge' : 'astronaut_archive', targetType: 'astronaut', targetId: id });
  return c.json({ ok: true });
});

astronautRoutes.get('/astronauts/:id/private', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const id = c.req.param('id');
  if (!canReadPrivate(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const row = (await db.select().from(astronautPrivate).where(eq(astronautPrivate.astronautId, id)).limit(1))[0];
  if (!row) return c.json({ error: 'Not found' }, 404);
  await audit(c, { action: 'read_private', targetType: 'astronaut', targetId: id });
  return c.json({ legalName: row.legalName, medicalNotes: row.medicalNotes });
});

/** Data rights: everything stored about one astronaut, as JSON (minute observations excluded; use /series). */
astronautRoutes.get('/astronauts/:id/export', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const user = c.get('user');
  const id = c.req.param('id');
  if (!canReadAstronaut(user, id)) return c.json({ error: 'Not allowed' }, 403);
  const profile = await getProfile(db, id, user, { includeArchived: true });
  if (!profile) return c.json({ error: 'Crew member not found' }, 404);
  const convs = await db.select().from(conversations).where(eq(conversations.astronautId, id));
  const msgs = [];
  for (const conv of convs) msgs.push(...(await db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(asc(messages.ts))));
  const data = {
    exportedAtIso: new Date().toISOString(),
    profile,
    dailyMetrics: await db.select().from(dailyMetrics).where(eq(dailyMetrics.astronautId, id)),
    baselines: await db.select().from(baselines).where(eq(baselines.astronautId, id)),
    anomalies: await db.select().from(anomalies).where(eq(anomalies.astronautId, id)),
    triageEvents: await db.select().from(triageEvents).where(eq(triageEvents.astronautId, id)),
    wellbeing: await db.select().from(wellbeingCheckIns).where(eq(wellbeingCheckIns.astronautId, id)),
    conversations: convs,
    messages: msgs,
  };
  await audit(c, { action: 'export', targetType: 'astronaut', targetId: id });
  c.header('Content-Disposition', `attachment; filename="argus-${id}-export.json"`);
  return c.json(data);
});

/** AI chat link: history of the astronaut's latest conversation. */
astronautRoutes.get('/astronauts/:id/conversations/latest', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const conversationId = await latestConversationId(db, id);
  return c.json({ conversationId, messages: conversationId ? await conversationMessages(db, conversationId) : [] });
});

/** "Clear chat": starts a new conversation. Earlier ones stay stored (and in /export). */
astronautRoutes.post('/astronauts/:id/conversations', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const id = c.req.param('id');
  const user = c.get('user');
  if (!canReadAstronaut(user, id)) return c.json({ error: 'Not allowed' }, 403);
  const conversationId = await startConversation(db, id, user?.id ?? null);
  return c.json({ conversationId }, 201);
});

