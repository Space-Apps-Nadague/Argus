/**
 * ARGUS — Server-side sessions (specs/05-data-platform.md §6)
 * Opaque 32-byte token in an HttpOnly cookie; only its SHA-256 is stored, so sessions are revocable.
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getDb, type Db } from '../db/client';
import { sessions, users } from '../db/schema';
import { clientIp } from './audit';
import type { AppEnv, Role, SessionUser } from './types';

export const SESSION_COOKIE = 'argus_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function isSecureRequest(c: Context): boolean {
  const host = new URL(c.req.url).hostname;
  return !(host === 'localhost' || host === '127.0.0.1' || host === '::1');
}

export async function createSession(c: Context<AppEnv>, db: Db, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: clientIp(c),
    userAgent: c.req.header('user-agent')?.slice(0, 300),
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(c),
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(c: Context<AppEnv>, db: Db): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function revokeUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Puts the database (or null in stateless mode) on the context. */
export const dbMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('db', getDb());
  c.set('user', null);
  await next();
};

/** Resolves the signed-in user from the session cookie (no-op without a database). */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = c.get('db');
  const token = getCookie(c, SESSION_COOKIE);
  if (db && token) {
    const rows = await db
      .select({
        sessionId: sessions.id,
        id: users.id,
        username: users.username,
        role: users.role,
        astronautId: users.astronautId,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
      .limit(1);
    if (rows[0]) c.set('user', rows[0] as SessionUser);
  }
  await next();
};

/** 401 unless signed in. In stateless mode (no DATABASE_URL) everything is allowed, as before. */
export function requireAuth(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get('db')) return next();
    const user = c.get('user');
    if (!user) return c.json({ error: 'Sign in required' }, 401);
    if (roles.length && !roles.includes(user.role)) return c.json({ error: 'Not allowed for your role' }, 403);
    return next();
  };
}

/**
 * CSRF guard for cookie-authenticated mutations: the Origin header (when sent) must be an allowed origin
 * or the API's own origin.
 */
export function originGuard(allowed: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    if (c.req.header('authorization')?.startsWith('Bearer ')) return next(); // device ingest, no cookie
    const origin = c.req.header('origin');
    if (origin && !allowed.includes(origin) && origin !== new URL(c.req.url).origin) {
      return c.json({ error: 'Cross-origin request blocked' }, 403);
    }
    return next();
  };
}
