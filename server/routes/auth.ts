/**
 * /api/auth — server-side sign-in (specs/05-data-platform.md §6, §8)
 */

import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { UserAccount } from '../../src/types/argus';
import { audit, clientIp } from '../auth/audit';
import { getDummyHash, hashPassword, MIN_PASSWORD_LENGTH, validatePassword, validateUsername, verifyPassword } from '../auth/passwords';
import { RateLimiter } from '../auth/rateLimit';
import { createSession, destroySession } from '../auth/session';
import type { AppEnv } from '../auth/types';
import { users } from '../db/schema';
import { parseBody } from './util';

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const loginLimiter = new RateLimiter(20, 60_000);

const CredentialsSchema = z.object({ username: z.string().max(64), password: z.string().max(256) });

export function toAccount(u: typeof users.$inferSelect): UserAccount {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    crewId: u.astronautId ?? undefined,
    createdAtIso: u.createdAt.toISOString(),
    disabled: Boolean(u.disabledAt),
  };
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/auth/me', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ mode: 'stateless', error: 'Database not configured' }, 503);
  const user = c.get('user');
  const [{ n }] = await db.select({ n: count() }).from(users);
  const full = user ? (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0] : null;
  return c.json({ mode: 'server', user: full ? toAccount(full) : null, setupNeeded: n === 0, minPasswordLength: MIN_PASSWORD_LENGTH });
});

authRoutes.post('/auth/setup', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  const body = await parseBody(c, CredentialsSchema);
  if (!body.ok) return body.response;
  const err = validateUsername(body.data.username) ?? validatePassword(body.data.password);
  if (err) return c.json({ error: err }, 400);
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return c.json({ error: 'Setup is already done. Sign in instead.' }, 409);
  const [created] = await db
    .insert(users)
    .values({ username: body.data.username.trim(), role: 'admin', passwordHash: await hashPassword(body.data.password) })
    .returning();
  await createSession(c, db, created.id);
  await audit(c, { action: 'setup_admin', targetType: 'user', targetId: created.id, actorUserId: created.id });
  return c.json({ user: toAccount(created) }, 201);
});

authRoutes.post('/auth/login', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  if (!loginLimiter.take(clientIp(c) ?? 'local')) {
    return c.json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429);
  }
  const body = await parseBody(c, CredentialsSchema);
  if (!body.ok) return body.response;
  const { username, password } = body.data;

  const user = (await db.select().from(users).where(eq(users.username, username.trim())).limit(1))[0];
  const now = new Date();
  if (user?.lockedUntil && user.lockedUntil > now) {
    await audit(c, { action: 'login_locked', targetType: 'user', targetId: user.id, actorUserId: null });
    return c.json({ error: 'Too many failed attempts. This account is locked for 15 minutes.' }, 423);
  }
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !ok || user.disabledAt) {
    if (user && !ok) {
      const failed = user.failedLogins + 1;
      await db
        .update(users)
        .set({ failedLogins: failed, lockedUntil: failed >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_MS) : null })
        .where(eq(users.id, user.id));
    }
    await audit(c, { action: 'login_failed', targetType: 'user', targetId: user?.id, detail: { username }, actorUserId: null });
    return c.json({ error: 'Wrong username or password.' }, 401);
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await createSession(c, db, user.id);
  await audit(c, { action: 'login', targetType: 'user', targetId: user.id, actorUserId: user.id });
  return c.json({ user: toAccount(user) });
});

authRoutes.post('/auth/logout', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ ok: true });
  const user = c.get('user');
  await destroySession(c, db);
  if (user) await audit(c, { action: 'logout', targetType: 'user', targetId: user.id });
  return c.json({ ok: true });
});
