/**
 * ARGUS — Idempotent seed (specs/05-data-platform.md §3, §6)
 *   npm run db:seed
 * Creates: data_sources (from SOURCES.md), the metric catalog, the demo mission, the default crew roster,
 * each astronaut's assumed sensor kit, the bootstrap admin, and optional demo accounts.
 * Passwords come only from the environment, never from code.
 */

import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CREW_ROSTER } from '../../src/data/telemetryScenarios';
import { hashPassword, validatePassword } from '../auth/passwords';
import { ALL_METRICS, SENSOR_KIT } from './catalog';
import type { Db } from './client';
import { astronautPrivate, astronauts, dataSources, devices, metrics, missions, users } from './schema';

export const DEMO_MISSION_ID = 'mission-ares';

export interface SeedOptions {
  adminUsername?: string;
  adminPassword?: string;
  demoPassword?: string;
  /** Mission start; defaults to 00:00 UTC 29 days ago (so today is mission day 30). */
  missionStart?: Date;
  root?: string;
  log?: (msg: string) => void;
}

export function parseSourcesTable(markdown: string) {
  const rows: Array<{ id: string; title: string; url: string | null; kind: string; access: string }> = [];
  for (const line of markdown.split('\n')) {
    if (!/^\|\s*SRC-\d{3}\s*\|/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    const [, id, source, kind, access] = cells;
    const link = /\[([^\]]+)\]\(([^)]+)\)(.*)/.exec(source);
    const title = link ? `${link[1]}${link[3]}`.trim() : source;
    rows.push({ id, title, url: link ? link[2] : null, kind, access });
  }
  return rows;
}

export function defaultMissionStart(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 29);
  return d;
}

export async function seedDatabase(db: Db, opts: SeedOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const root = opts.root ?? process.cwd();

  const sources = parseSourcesTable(readFileSync(resolve(root, 'SOURCES.md'), 'utf8'));
  for (const s of sources) {
    await db
      .insert(dataSources)
      .values(s)
      .onConflictDoUpdate({ target: dataSources.id, set: { title: s.title, url: s.url, kind: s.kind, access: s.access } });
  }
  log(`data_sources: ${sources.length}`);

  for (const m of ALL_METRICS) {
    await db
      .insert(metrics)
      .values(m)
      .onConflictDoUpdate({
        target: metrics.id,
        set: { label: m.label, unit: m.unit, zone: m.zone, kind: m.kind, plausibleMin: m.plausibleMin, plausibleMax: m.plausibleMax, sourceId: m.sourceId },
      });
  }
  log(`metrics: ${ALL_METRICS.length}`);

  await db
    .insert(missions)
    .values({ id: DEMO_MISSION_ID, name: 'Ares Transit (demo)', locationId: 'mars_transit', startAt: opts.missionStart ?? defaultMissionStart() })
    .onConflictDoNothing();

  const year = new Date().getUTCFullYear();
  for (const c of DEFAULT_CREW_ROSTER) {
    await db
      .insert(astronauts)
      .values({
        id: c.id,
        missionId: DEMO_MISSION_ID,
        callsign: c.callsign,
        sex: c.sex,
        birthYear: year - c.age,
        bloodType: c.bloodType,
        crewRole: String(c.role),
        restingHrBaselineBpm: c.restingHrBaselineBpm,
        preFlightOnsdMm: c.preFlightOnsdMm,
        defaultScenarioId: c.defaultScenarioId,
        countermeasureStreakSols: c.countermeasureStreakSols,
        isDemo: true,
      })
      .onConflictDoNothing();
    await db
      .insert(astronautPrivate)
      .values({ astronautId: c.id, legalName: c.name, medicalNotes: c.medicalNotes })
      .onConflictDoNothing();
  }
  log(`astronauts: ${DEFAULT_CREW_ROSTER.length}`);

  await ensureSensorKits(db);

  if (opts.adminUsername && opts.adminPassword) {
    const err = validatePassword(opts.adminPassword);
    if (err) throw new Error(`ARGUS_BOOTSTRAP_ADMIN_PASSWORD: ${err}`);
    const inserted = await db
      .insert(users)
      .values({ username: opts.adminUsername, role: 'admin', passwordHash: await hashPassword(opts.adminPassword) })
      .onConflictDoNothing()
      .returning({ id: users.id });
    log(inserted.length ? `admin "${opts.adminUsername}" created` : `admin "${opts.adminUsername}" already exists`);
  }

  if (opts.demoPassword) {
    const err = validatePassword(opts.demoPassword);
    if (err) throw new Error(`ARGUS_DEMO_PASSWORD: ${err}`);
    const pw = await hashPassword(opts.demoPassword);
    const demo = [
      ...DEFAULT_CREW_ROSTER.map((c) => ({ username: c.callsign.toLowerCase(), role: 'astronaut' as const, astronautId: c.id })),
      { username: 'surgeon', role: 'flight_surgeon' as const, astronautId: null },
    ];
    for (const u of demo) await db.insert(users).values({ ...u, passwordHash: pw }).onConflictDoNothing();
    log(`demo accounts: ${demo.map((d) => d.username).join(', ')}`);
  }
}

/** Gives every astronaut the assumed kit (spec 05 §4.1) and retires devices that are no longer part of it. */
export async function ensureSensorKits(db: Db): Promise<void> {
  await db.execute(sql`
    update devices set retired_at = now()
    where retired_at is null and kind::text not in (${sql.join(SENSOR_KIT.map((k) => sql`${k.kind}`), sql`, `)})`);
  await db.execute(sql`
    insert into devices (astronaut_id, kind, model, source_id)
    select a.id, k.kind::device_kind, k.model, k.source_id
    from astronauts a
    cross join (values ${sql.join(
      SENSOR_KIT.map((k) => sql`(${k.kind}, ${k.model}, ${k.sourceId})`),
      sql`, `
    )}) as k(kind, model, source_id)
    where not exists (select 1 from devices d where d.astronaut_id = a.id and d.kind = k.kind::device_kind and d.retired_at is null)
  `);
}

const isCli = process.argv[1] && resolve(process.argv[1]).endsWith('seed.ts');
if (isCli) {
  const { loadEnv } = await import('../env');
  const { openDb } = await import('./client');
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (see .env.example).');
    process.exit(1);
  }
  const h = openDb(url);
  await h.migrate();
  await seedDatabase(h.db, {
    adminUsername: process.env.ARGUS_BOOTSTRAP_ADMIN_USERNAME,
    adminPassword: process.env.ARGUS_BOOTSTRAP_ADMIN_PASSWORD,
    demoPassword: process.env.ARGUS_DEMO_PASSWORD,
    log: (m) => console.log(`[seed] ${m}`),
  });
  await h.close();
}
