/**
 * /api/auth — server-side sign-in (specs/05-data-platform.md §6, §8)
 */

import { randomBytes } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { UserAccount } from '../../src/types/argus';
import { audit, clientIp } from '../auth/audit';
import { getDummyHash, hashPassword, MIN_PASSWORD_LENGTH, validatePassword, validateUsername, verifyPassword } from '../auth/passwords';
import { RateLimiter } from '../auth/rateLimit';
import { createSession, destroySession, hashToken, requireAuth } from '../auth/session';
import type { AppEnv } from '../auth/types';
import { faceLogins, users } from '../db/schema';
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

// ── Guest sign-in (spec 05 §6): one shared read-all `flight_surgeon` account, no password ──
export const GUEST_USERNAME = 'guest';
/** On unless ARGUS_GUEST_LOGIN is `off`, `false` or `0`. */
export function guestLoginEnabled(): boolean {
  const v = process.env.ARGUS_GUEST_LOGIN?.trim().toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0');
}

authRoutes.get('/auth/me', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ mode: 'stateless', error: 'Database not configured' }, 503);
  const user = c.get('user');
  const [{ n }] = await db.select({ n: count() }).from(users);
  const full = user ? (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0] : null;
  return c.json({ mode: 'server', user: full ? toAccount(full) : null, setupNeeded: n === 0, minPasswordLength: MIN_PASSWORD_LENGTH, guestLogin: guestLoginEnabled() });
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

authRoutes.post('/auth/guest', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  if (!guestLoginEnabled()) return c.json({ error: 'Guest sign-in is turned off.' }, 403);
  if (!loginLimiter.take(clientIp(c) ?? 'local')) {
    return c.json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429);
  }
  let guest = (await db.select().from(users).where(eq(users.username, GUEST_USERNAME)).limit(1))[0];
  if (!guest) {
    // Random password nobody knows: the account can only be entered through this endpoint.
    const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
    await db.insert(users).values({ username: GUEST_USERNAME, role: 'flight_surgeon', passwordHash }).onConflictDoNothing();
    guest = (await db.select().from(users).where(eq(users.username, GUEST_USERNAME)).limit(1))[0];
  }
  if (!guest || guest.role !== 'flight_surgeon' || guest.disabledAt) {
    return c.json({ error: 'Guest sign-in is not available.' }, 409);
  }
  await createSession(c, db, guest.id);
  await audit(c, { action: 'login', targetType: 'user', targetId: guest.id, detail: { method: 'guest' }, actorUserId: guest.id });
  return c.json({ user: toAccount(guest) });
});

authRoutes.post('/auth/logout', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ ok: true });
  const user = c.get('user');
  await destroySession(c, db);
  if (user) await audit(c, { action: 'logout', targetType: 'user', targetId: user.id });
  return c.json({ ok: true });
});

// ── Face ID (spec 05 §6): the browser matches the face on-device, then presents this device token ──
const faceLimiter = new RateLimiter(20, 60_000);
const FaceTokenSchema = z.object({ token: z.string().min(20).max(200) });

authRoutes.post('/auth/face/enroll', requireAuth(), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!db || !user) return c.json({ error: 'Database not configured' }, 503);
  const token = randomBytes(32).toString('base64url');
  await db.insert(faceLogins).values({ userId: user.id, tokenHash: hashToken(token), userAgent: c.req.header('user-agent')?.slice(0, 300) });
  await audit(c, { action: 'face_enroll', targetType: 'user', targetId: user.id });
  return c.json({ token }, 201);
});

authRoutes.post('/auth/face/login', async (c) => {
  const db = c.get('db');
  if (!db) return c.json({ error: 'Database not configured' }, 503);
  if (!faceLimiter.take(clientIp(c) ?? 'local')) {
    return c.json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429);
  }
  const body = await parseBody(c, FaceTokenSchema);
  if (!body.ok) return body.response;
  const row = (
    await db
      .select({ faceId: faceLogins.id, user: users })
      .from(faceLogins)
      .innerJoin(users, eq(users.id, faceLogins.userId))
      .where(eq(faceLogins.tokenHash, hashToken(body.data.token)))
      .limit(1)
  )[0];
  if (!row || row.user.disabledAt) {
    await audit(c, { action: 'login_failed', targetType: 'user', targetId: row?.user.id, detail: { method: 'face_id' }, actorUserId: null });
    return c.json({ error: 'Face ID is no longer valid on this device. Sign in with your password.' }, 401);
  }
  if (row.user.lockedUntil && row.user.lockedUntil > new Date()) {
    return c.json({ error: 'Too many failed attempts. This account is locked for 15 minutes.' }, 423);
  }
  await db.update(faceLogins).set({ lastUsedAt: new Date() }).where(eq(faceLogins.id, row.faceId));
  await createSession(c, db, row.user.id);
  await audit(c, { action: 'login', targetType: 'user', targetId: row.user.id, detail: { method: 'face_id' }, actorUserId: row.user.id });
  return c.json({ user: toAccount(row.user) });
});

authRoutes.post('/auth/face/remove', requireAuth(), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!db || !user) return c.json({ ok: true });
  const body = await parseBody(c, FaceTokenSchema);
  if (!body.ok) return body.response;
  await db.delete(faceLogins).where(and(eq(faceLogins.tokenHash, hashToken(body.data.token)), eq(faceLogins.userId, user.id)));
  await audit(c, { action: 'face_remove', targetType: 'user', targetId: user.id });
  return c.json({ ok: true });
});
