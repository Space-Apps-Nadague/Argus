/**
 * Reports to the doctors on Earth (specs/04-ai-backend.md §4.4).
 *
 * A report is visible to flight surgeons only after the one-way light time from the crew
 * member's location; the reply is visible to the crew member only after the trip back.
 */

import { and, desc, eq, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { EarthTelemetryPacket } from '../../src/types/argus';
import type { EarthReport, MentalStateAssessment } from '../../src/types/assistant';
import { SPACE_LOCATIONS, commDelayAt } from '../../src/data/spaceLocations';
import { canReadAstronaut } from '../auth/access';
import { audit } from '../auth/audit';
import { requireAuth } from '../auth/session';
import type { AppEnv } from '../auth/types';
import { astronauts, earthPackets, mentalStateAssessments } from '../db/schema';
import { LocationIdSchema, MentalStateAssessmentSchema, UrgencySchema } from '../schemas';
import { parseBody } from './util';

export const packetRoutes = new Hono<AppEnv>();
packetRoutes.use('/astronauts/:id/packets', requireAuth());
packetRoutes.use('/astronauts/:id/mental-state', requireAuth());
packetRoutes.use('/packets/*', requireAuth());

const NewPacketSchema = z.object({
  urgency: UrgencySchema,
  kind: z.enum(['medical', 'behavioral', 'emergency', 'digest']),
  summary: z.string().min(1).max(1200),
  payload: z.record(z.string(), z.unknown()),
  locationId: LocationIdSchema.optional(),
});

const ReplySchema = z.object({ text: z.string().min(1).max(4000) });

type Row = typeof earthPackets.$inferSelect;

function toReport(row: Row, now: Date, viewer: 'crew' | 'earth', astronautLabel?: string): EarthReport {
  const replyArrived = Boolean(row.replyDeliverAt && row.replyDeliverAt <= now);
  // The crew member cannot see a reply that is still in transit; Earth always sees its own reply.
  const showReply = row.replyText && (viewer === 'earth' || replyArrived);
  return {
    id: row.id,
    astronautId: row.astronautId,
    astronautLabel,
    createdAtIso: row.createdAt.toISOString(),
    urgency: row.urgency as EarthReport['urgency'],
    kind: row.kind as EarthReport['kind'],
    summary: row.summary,
    oneWayDelaySec: row.oneWayDelaySec,
    deliverAtIso: row.deliverAt.toISOString(),
    delivered: row.deliverAt <= now,
    readAtIso: row.readAt?.toISOString() ?? null,
    payload: row.payload as EarthTelemetryPacket,
    reply: showReply
      ? {
          text: row.replyText!,
          author: row.repliedByName ?? 'Flight Surgeon',
          sentAtIso: (row.repliedAt ?? now).toISOString(),
          arrivesAtIso: (row.replyDeliverAt ?? now).toISOString(),
          arrived: replyArrived,
        }
      : null,
  };
}

function noDb(c: { json: (b: unknown, s: 503) => Response }) {
  return c.json({ error: 'Database not configured' }, 503);
}

/** Crew side: queue a report. */
packetRoutes.post('/astronauts/:id/packets', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const id = c.req.param('id');
  const user = c.get('user');
  if (!canReadAstronaut(user, id)) return c.json({ error: 'Not allowed' }, 403);
  const body = await parseBody(c, NewPacketSchema);
  if (!body.ok) return body.response;

  const now = new Date();
  const loc = body.data.locationId ? SPACE_LOCATIONS[body.data.locationId] : undefined;
  const oneWayDelaySec = loc ? commDelayAt(loc, now).seconds : 0;
  const [row] = await db
    .insert(earthPackets)
    .values({
      astronautId: id,
      createdBy: user?.id ?? null,
      urgency: body.data.urgency,
      kind: body.data.kind,
      summary: body.data.summary,
      oneWayDelaySec,
      deliverAt: new Date(now.getTime() + oneWayDelaySec * 1000),
      payload: body.data.payload,
    })
    .returning();
  await audit(c, { action: 'earth_packet', targetType: 'astronaut', targetId: id });
  return c.json({ report: toReport(row, now, 'crew') }, 201);
});

/** Crew side: their own reports, with replies that have arrived. */
packetRoutes.get('/astronauts/:id/packets', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const id = c.req.param('id');
  const user = c.get('user');
  if (!canReadAstronaut(user, id)) return c.json({ error: 'Not allowed' }, 403);
  const rows = await db.select().from(earthPackets).where(eq(earthPackets.astronautId, id)).orderBy(desc(earthPackets.createdAt)).limit(50);
  const now = new Date();
  return c.json({ reports: rows.map((r) => toReport(r, now, 'crew')) });
});

/** Earth side: everything that has arrived, newest first. Flight surgeons only. */
packetRoutes.get('/packets/inbox', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  if (c.get('user')?.role !== 'flight_surgeon') return c.json({ error: 'Flight surgeons only' }, 403);
  const now = new Date();
  const rows = await db
    .select({ packet: earthPackets, callsign: astronauts.callsign })
    .from(earthPackets)
    .innerJoin(astronauts, eq(astronauts.id, earthPackets.astronautId))
    .where(lte(earthPackets.deliverAt, now))
    .orderBy(desc(earthPackets.createdAt))
    .limit(100);
  return c.json({ reports: rows.map((r) => toReport(r.packet, now, 'earth', r.callsign)) });
});

/** Earth side: mark read. */
packetRoutes.post('/packets/:packetId/read', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  if (c.get('user')?.role !== 'flight_surgeon') return c.json({ error: 'Flight surgeons only' }, 403);
  const now = new Date();
  await db.update(earthPackets).set({ readAt: now }).where(and(eq(earthPackets.id, c.req.param('packetId')), lte(earthPackets.deliverAt, now)));
  return c.json({ ok: true });
});

/** Earth side: reply. It reaches the crew member after the light time back. */
packetRoutes.post('/packets/:packetId/reply', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const user = c.get('user');
  if (user?.role !== 'flight_surgeon') return c.json({ error: 'Flight surgeons only' }, 403);
  const body = await parseBody(c, ReplySchema);
  if (!body.ok) return body.response;
  const now = new Date();
  const [existing] = await db.select().from(earthPackets).where(eq(earthPackets.id, c.req.param('packetId'))).limit(1);
  if (!existing || existing.deliverAt > now) return c.json({ error: 'Not found' }, 404);
  const [row] = await db
    .update(earthPackets)
    .set({
      replyText: body.data.text,
      repliedBy: user.id,
      repliedByName: user.username,
      repliedAt: now,
      replyDeliverAt: new Date(now.getTime() + existing.oneWayDelaySec * 1000),
      readAt: existing.readAt ?? now,
    })
    .where(eq(earthPackets.id, existing.id))
    .returning();
  await audit(c, { action: 'earth_reply', targetType: 'astronaut', targetId: existing.astronautId });
  return c.json({ report: toReport(row, now, 'earth') });
});

// ── Mental-state history ─────────────────────────────────────────────────────

packetRoutes.post('/astronauts/:id/mental-state', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const body = await parseBody(c, MentalStateAssessmentSchema);
  if (!body.ok) return body.response;
  const a = body.data as MentalStateAssessment;
  await db.insert(mentalStateAssessments).values({
    astronautId: id,
    concernLevel: a.concernLevel,
    score: Math.round(a.score),
    mood: a.mood,
    stress: a.stress,
    fatigue: a.fatigue,
    trend: a.trend,
    assessment: a,
  });
  return c.json({ ok: true }, 201);
});

packetRoutes.get('/astronauts/:id/mental-state', async (c) => {
  const db = c.get('db');
  if (!db) return noDb(c);
  const id = c.req.param('id');
  if (!canReadAstronaut(c.get('user'), id)) return c.json({ error: 'Not allowed' }, 403);
  const rows = await db
    .select()
    .from(mentalStateAssessments)
    .where(eq(mentalStateAssessments.astronautId, id))
    .orderBy(desc(mentalStateAssessments.ts))
    .limit(60);
  return c.json({ history: rows.reverse().map((r) => r.assessment as MentalStateAssessment) });
});
