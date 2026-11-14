/**
 * Guards every /api/ai/* request (specs/05-data-platform.md §6):
 * - with a database, the signed-in user must be allowed to read the astronaut in `crewMember.id`;
 * - `ai_consent = false` forces deterministic offline answers;
 * - prompt privacy (identity only for local-only provider chains) is set for the whole request.
 */

import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { chainIsLocalOnly, runWithPrivacy } from '../ai/privacy';
import { astronauts } from '../db/schema';
import { keyFromHeader } from '../routes/util';
import { canReadAstronaut } from './access';
import type { AppEnv } from './types';

export async function requestCrewId(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Promise<string | undefined> {
  if (c.req.method !== 'POST' || !c.req.header('content-type')?.includes('application/json')) return undefined;
  const body = (await c.req.json().catch(() => null)) as { crewMember?: { id?: unknown } } | null;
  return typeof body?.crewMember?.id === 'string' ? body.crewMember.id : undefined;
}

export const aiGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = c.get('db');
  let consent = true;
  const crewId = await requestCrewId(c);
  if (db && crewId) {
    if (!canReadAstronaut(c.get('user'), crewId)) return c.json({ error: 'Not allowed to access this crew member' }, 403);
    const row = (await db.select({ aiConsent: astronauts.aiConsent }).from(astronauts).where(eq(astronauts.id, crewId)).limit(1))[0];
    consent = row?.aiConsent ?? true;
  }
  const identity = chainIsLocalOnly(process.env, keyFromHeader(c));
  await runWithPrivacy({ identity, offlineOnly: !consent }, () => next());
};
