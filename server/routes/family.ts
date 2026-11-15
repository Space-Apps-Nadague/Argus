/**
 * /api/family — Photobooth photos emailed to the crew member's family (specs/05-data-platform.md §6).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { canReadAstronaut } from '../auth/access';
import { audit, clientIp } from '../auth/audit';
import { RateLimiter } from '../auth/rateLimit';
import { requireAuth } from '../auth/session';
import type { AppEnv } from '../auth/types';
import { familyMailQueue } from '../family/mailer';
import { parseBody } from './util';

const JPEG_PREFIX = 'data:image/jpeg;base64,';
/** 30 photos per user per hour. */
const sendLimiter = new RateLimiter(30, 60 * 60 * 1000);

const SendSchema = z.object({
  id: z.string().regex(/^[\w-]{4,80}$/),
  crewId: z.string().min(1).max(80),
  callsign: z.string().min(1).max(40),
  place: z.string().min(1).max(60),
  to: z
    .array(z.object({ name: z.string().trim().min(1).max(60), email: z.email().max(200) }))
    .min(1)
    .max(10),
  message: z.string().max(300).default(''),
  image: z.string().startsWith(JPEG_PREFIX).max(3_000_000),
  /** One-way light time to Earth, seconds (≤ 1 h covers the far side of Mars' orbit). */
  delaySeconds: z.number().min(0).max(3600),
});

export const familyRoutes = new Hono<AppEnv>();

familyRoutes.post('/family/mail', requireAuth(), async (c) => {
  // Without a database nobody signs in, so the server would mail anything for anyone: refuse.
  if (!c.get('db')) return c.json({ error: 'Family email needs the ARGUS database and a signed-in user.' }, 503);
  const body = await parseBody(c, SendSchema);
  if (!body.ok) return body.response;
  const user = c.get('user');
  const d = body.data;
  // With a database every user is signed in; they may only send for an astronaut they can see.
  if (c.get('db') && !canReadAstronaut(user, d.crewId)) return c.json({ error: 'Not allowed for this crew member' }, 403);
  const owner = user?.id ?? clientIp(c) ?? 'local';
  if (!sendLimiter.take(owner)) return c.json({ error: 'Too many photos this hour. Try again later.' }, 429);

  const status = familyMailQueue.schedule({
    id: d.id,
    owner,
    crewId: d.crewId,
    callsign: d.callsign,
    place: d.place,
    to: d.to,
    message: d.message,
    imageBase64: d.image.slice(JPEG_PREFIX.length),
    sendAt: Date.now() + d.delaySeconds * 1000,
  });
  // Recipients' addresses are not written to the audit log.
  await audit(c, { action: 'family_mail', targetType: 'astronaut', targetId: d.crewId, detail: { recipients: d.to.length, delaySeconds: d.delaySeconds } });
  return c.json(status, 202);
});

familyRoutes.get('/family/mail/:id', requireAuth(), (c) => {
  const user = c.get('user');
  const owner = user?.id ?? clientIp(c) ?? 'local';
  const status = familyMailQueue.get(c.req.param('id'), owner);
  return status ? c.json(status) : c.json({ error: 'Not found' }, 404);
});
