/**
 * /api/admin/users — account management, admin only (specs/05-data-platform.md §6)
 */

import { and, eq, isNull, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../auth/audit';
import { hashPassword, validatePassword, validateUsername } from '../auth/passwords';
import { requireAuth, revokeUserSessions } from '../auth/session';
import type { AppEnv } from '../auth/types';
import { astronauts, users } from '../db/schema';
import { toAccount } from './auth';
import { parseBody } from './util';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('/admin/*', requireAuth('admin'));

const RoleSchema = z.enum(['admin', 'astronaut', 'flight_surgeon']);
const NewUserSchema = z.object({
  username: z.string().max(64),
  password: z.string().max(256),
  role: RoleSchema,
  crewId: z.string().max(100).optional(),
});
const PatchUserSchema = z.object({
  password: z.string().max(256).optional(),
  disabled: z.boolean().optional(),
  crewId: z.string().max(100).nullable().optional(),
});

adminRoutes.get('/admin/users', async (c) => {
  const db = c.get('db')!;
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return c.json({ users: rows.map(toAccount) });
});

async function checkCrewLink(db: NonNullable<AppEnv['Variables']['db']>, crewId: string, exceptUserId?: string) {
  const a = (await db.select({ id: astronauts.id }).from(astronauts).where(and(eq(astronauts.id, crewId), isNull(astronauts.archivedAt))).limit(1))[0];
  if (!a) return 'That crew member does not exist.';
  const linked = await db
    .select({ id: users.id })
    .from(users)
    .where(exceptUserId ? and(eq(users.astronautId, crewId), ne(users.id, exceptUserId)) : eq(users.astronautId, crewId))
    .limit(1);
  return linked.length ? 'That crew member already has an account.' : null;
}

adminRoutes.post('/admin/users', async (c) => {
  const db = c.get('db')!;
  const body = await parseBody(c, NewUserSchema);
  if (!body.ok) return body.response;
  const { username, password, role, crewId } = body.data;
  const err = validateUsername(username) ?? validatePassword(password);
  if (err) return c.json({ error: err }, 400);
  if (role === 'astronaut' && !crewId) return c.json({ error: 'Pick the crew member this account belongs to.' }, 400);
  if (crewId) {
    const linkErr = await checkCrewLink(db, crewId);
    if (linkErr) return c.json({ error: linkErr }, 400);
  }
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username.trim())).limit(1);
  if (existing.length) return c.json({ error: 'That username is already taken.' }, 409);
  const [created] = await db
    .insert(users)
    .values({ username: username.trim(), role, astronautId: crewId ?? null, passwordHash: await hashPassword(password) })
    .returning();
  await audit(c, { action: 'user_create', targetType: 'user', targetId: created.id, detail: { role, crewId } });
  return c.json({ user: toAccount(created) }, 201);
});

adminRoutes.patch('/admin/users/:id', async (c) => {
  const db = c.get('db')!;
  const id = c.req.param('id');
  const body = await parseBody(c, PatchUserSchema);
  if (!body.ok) return body.response;
  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return c.json({ error: 'User not found' }, 404);
  const set: Partial<typeof users.$inferInsert> = {};
  if (body.data.password !== undefined) {
    const err = validatePassword(body.data.password);
    if (err) return c.json({ error: err }, 400);
    set.passwordHash = await hashPassword(body.data.password);
    set.failedLogins = 0;
    set.lockedUntil = null;
  }
  if (body.data.disabled !== undefined) {
    if (id === c.get('user')!.id) return c.json({ error: "You can't disable your own account." }, 400);
    set.disabledAt = body.data.disabled ? new Date() : null;
  }
  if (body.data.crewId !== undefined) {
    if (body.data.crewId) {
      const linkErr = await checkCrewLink(db, body.data.crewId, id);
      if (linkErr) return c.json({ error: linkErr }, 400);
    } else if (target.role === 'astronaut') {
      return c.json({ error: 'Astronaut accounts must stay linked to a crew member.' }, 400);
    }
    set.astronautId = body.data.crewId;
  }
  const [updated] = await db.update(users).set(set).where(eq(users.id, id)).returning();
  if (set.passwordHash || set.disabledAt) await revokeUserSessions(db, id);
  await audit(c, {
    action: 'user_update',
    targetType: 'user',
    targetId: id,
    detail: { password: body.data.password !== undefined, disabled: body.data.disabled, crewId: body.data.crewId },
  });
  return c.json({ user: toAccount(updated) });
});

adminRoutes.delete('/admin/users/:id', async (c) => {
  const db = c.get('db')!;
  const id = c.req.param('id');
  const me = c.get('user')!;
  if (id === me.id) return c.json({ error: "You can't delete your own account." }, 400);
  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'admin') {
    const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), isNull(users.disabledAt)));
    if (admins.length <= 1) return c.json({ error: "You can't delete the last admin." }, 400);
  }
  await db.delete(users).where(eq(users.id, id));
  await audit(c, { action: 'user_delete', targetType: 'user', targetId: id, detail: { username: target.username } });
  return c.json({ ok: true });
});
