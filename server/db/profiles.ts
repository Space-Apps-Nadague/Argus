/**
 * Maps database rows ⇄ the HUD's `CrewMemberProfile` (spec 01 §1) while enforcing pseudonymization:
 * legal name and medical notes are only filled in for users allowed to read them (spec 05 §6).
 */

import { eq, isNull } from 'drizzle-orm';
import type { CrewMemberProfile, ScenarioId } from '../../src/types/argus';
import { canReadPrivate } from '../auth/access';
import type { SessionUser } from '../auth/types';
import type { Db } from './client';
import { astronautPrivate, astronauts, missions } from './schema';

const DAY_MS = 86_400_000;

export function missionDayAt(startAt: Date | null | undefined, at = new Date()): number {
  if (!startAt) return 1;
  return Math.max(1, Math.floor((at.getTime() - startAt.getTime()) / DAY_MS) + 1);
}

type AstronautRow = typeof astronauts.$inferSelect;
type PrivateRow = typeof astronautPrivate.$inferSelect | null;

export function toProfile(
  a: AstronautRow,
  priv: PrivateRow,
  missionStart: Date | null,
  user: SessionUser | null,
  opts: { forceFull?: boolean } = {}
): CrewMemberProfile {
  const full = opts.forceFull || canReadPrivate(user, a.id);
  return {
    id: a.id,
    name: full && priv ? priv.legalName : a.callsign,
    callsign: a.callsign,
    role: a.crewRole,
    sex: a.sex as CrewMemberProfile['sex'],
    age: new Date().getUTCFullYear() - a.birthYear,
    bloodType: a.bloodType as CrewMemberProfile['bloodType'],
    restingHrBaselineBpm: a.restingHrBaselineBpm,
    preFlightOnsdMm: a.preFlightOnsdMm,
    missionDaysLogged: missionDayAt(missionStart),
    countermeasureStreakSols: a.countermeasureStreakSols,
    defaultScenarioId: a.defaultScenarioId as ScenarioId,
    medicalNotes: full && priv ? priv.medicalNotes : '',
    isCustom: !a.isDemo,
    aiConsent: a.aiConsent,
  };
}

export async function listProfiles(db: Db, user: SessionUser | null): Promise<CrewMemberProfile[]> {
  const rows = await db
    .select({ a: astronauts, p: astronautPrivate, start: missions.startAt })
    .from(astronauts)
    .leftJoin(astronautPrivate, eq(astronautPrivate.astronautId, astronauts.id))
    .leftJoin(missions, eq(missions.id, astronauts.missionId))
    .where(isNull(astronauts.archivedAt))
    .orderBy(astronauts.createdAt, astronauts.id);
  return rows.map((r) => toProfile(r.a, r.p, r.start, user));
}

export async function getProfile(
  db: Db,
  id: string,
  user: SessionUser | null,
  opts: { forceFull?: boolean; includeArchived?: boolean } = {}
): Promise<CrewMemberProfile | null> {
  const rows = await db
    .select({ a: astronauts, p: astronautPrivate, start: missions.startAt })
    .from(astronauts)
    .leftJoin(astronautPrivate, eq(astronautPrivate.astronautId, astronauts.id))
    .leftJoin(missions, eq(missions.id, astronauts.missionId))
    .where(eq(astronauts.id, id))
    .limit(1);
  const r = rows[0];
  if (!r || (r.a.archivedAt && !opts.includeArchived)) return null;
  return toProfile(r.a, r.p, r.start, user, opts);
}
