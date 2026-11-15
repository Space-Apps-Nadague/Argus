/**
 * ARGUS — Database schema (Drizzle ORM)
 * Single source of truth: specs/05-data-platform.md §3
 *
 * Change the spec first, then this file, then `npm run db:generate` and commit the SQL migration.
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ── Enums ────────────────────────────────────────────────────────────────────
export const userRole = pgEnum('user_role', ['admin', 'astronaut', 'flight_surgeon']);
export const metricKind = pgEnum('metric_kind', ['passive', 'clinical', 'self_report', 'environment', 'derived']);
export const deviceKind = pgEnum('device_kind', [
  'smart_shirt', // retired kit
  'bp_cuff', // retired kit
  'wrist_actigraph', // retired kit
  'ring', // retired kit
  'core_temp_patch', // retired kit
  'dosimeter',
  'cgm',
  'manual',
  'smartwatch',
  'habitat_sensor',
  'exercise_device',
  'clinical_exam',
]);
export const observationQuality = pgEnum('observation_quality', ['ok', 'artifact', 'out_of_range']);
export const observationOrigin = pgEnum('observation_origin', ['wearable', 'check_in', 'clinical', 'simulated']);
export const ingestKind = pgEnum('ingest_kind', [
  'wearable_batch',
  'simulator_backfill',
  'nasa_dataset',
  'check_in',
  'import',
  'seed',
]);
export const ingestStatus = pgEnum('ingest_status', ['running', 'succeeded', 'failed']);
export const baselineKind = pgEnum('baseline_kind', ['preflight', 'rolling_14d', 'hour_of_day', 'early_flight']);
export const anomalyDetector = pgEnum('anomaly_detector', ['robust_z', 'ewma', 'cusum']);
export const anomalySeverity = pgEnum('anomaly_severity', ['watch', 'drifting']);
export const triageStatus = pgEnum('triage_status', ['green', 'yellow', 'red']);
export const chatRole = pgEnum('chat_role', ['user', 'assistant']);

// ── 3.3 Sources, catalog, devices, ingest runs ──────────────────────────────
export const dataSources = pgTable('data_sources', {
  id: text('id').primaryKey(), // SRC-xxx, mirrors SOURCES.md
  title: text('title').notNull(),
  url: text('url'),
  kind: text('kind'),
  access: text('access'),
});

export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: text('source_id').references(() => dataSources.id),
  kind: ingestKind('kind').notNull(),
  script: text('script'),
  checksum: text('checksum'),
  rowCount: integer('row_count').notNull().default(0),
  status: ingestStatus('status').notNull().default('running'),
  startedAt: tsz('started_at').notNull().defaultNow(),
  finishedAt: tsz('finished_at'),
  detail: jsonb('detail'),
});

// ── 3.2 Crew & missions ─────────────────────────────────────────────────────
export const missions = pgTable('missions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  locationId: text('location_id').notNull(), // SpaceLocationId
  startAt: tsz('start_at').notNull(),
  gravityEnv: text('gravity_env').notNull().default('0g_transit'),
});

export const astronauts = pgTable('astronauts', {
  id: text('id').primaryKey(), // crew-<slug>
  missionId: text('mission_id').references(() => missions.id),
  callsign: text('callsign').notNull(),
  sex: text('sex').notNull(), // BiologicalSex
  birthYear: smallint('birth_year').notNull(),
  bloodType: text('blood_type').notNull(),
  crewRole: text('crew_role').notNull(),
  restingHrBaselineBpm: real('resting_hr_baseline_bpm').notNull(),
  preFlightOnsdMm: real('pre_flight_onsd_mm').notNull(),
  defaultScenarioId: text('default_scenario_id').notNull().default('nominal'),
  countermeasureStreakSols: integer('countermeasure_streak_sols').notNull().default(0),
  aiConsent: boolean('ai_consent').notNull().default(true),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: tsz('created_at').notNull().defaultNow(),
  archivedAt: tsz('archived_at'),
});

export const astronautPrivate = pgTable('astronaut_private', {
  astronautId: text('astronaut_id')
    .primaryKey()
    .references(() => astronauts.id, { onDelete: 'cascade' }),
  legalName: text('legal_name').notNull(),
  medicalNotes: text('medical_notes').notNull().default(''),
});

// ── 3.1 Identity & access ───────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: citext('username').notNull().unique(),
    role: userRole('role').notNull(),
    astronautId: text('astronaut_id').references(() => astronauts.id, { onDelete: 'cascade' }),
    passwordHash: text('password_hash').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    disabledAt: tsz('disabled_at'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: tsz('locked_until'),
  },
  (t) => [uniqueIndex('users_astronaut_unique').on(t.astronautId).where(sql`${t.astronautId} is not null`)]
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    expiresAt: tsz('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)]
);

/** Face ID device sign-in tokens (spec 05 §6). The face template stays on the device; only the token hash is here. */
export const faceLogins = pgTable(
  'face_logins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    lastUsedAt: tsz('last_used_at'),
    userAgent: text('user_agent'),
  },
  (t) => [index('face_logins_user_idx').on(t.userId)]
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: tsz('ts').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'), // no FK: the log outlives deleted users
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    detail: jsonb('detail'),
    ip: text('ip'),
  },
  (t) => [index('audit_ts_idx').on(t.ts)]
);

export const metrics = pgTable('metrics', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  unit: text('unit').notNull(),
  zone: text('zone'), // BodyZoneId
  kind: metricKind('kind').notNull(),
  plausibleMin: doublePrecision('plausible_min').notNull(),
  plausibleMax: doublePrecision('plausible_max').notNull(),
  sourceId: text('source_id').references(() => dataSources.id),
});

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    kind: deviceKind('kind').notNull(),
    model: text('model').notNull(),
    serial: text('serial'),
    tokenHash: text('token_hash').unique(),
    sourceId: text('source_id').references(() => dataSources.id),
    createdAt: tsz('created_at').notNull().defaultNow(),
    retiredAt: tsz('retired_at'),
  },
  (t) => [index('devices_astronaut_idx').on(t.astronautId)]
);

// ── 3.4 Medallion layers ────────────────────────────────────────────────────
export const rawReadings = pgTable(
  'raw_readings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    receivedAt: tsz('received_at').notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
    ingestRunId: uuid('ingest_run_id').references(() => ingestRuns.id),
  },
  (t) => [index('raw_readings_received_brin').using('brin', t.receivedAt)]
);

export const observations = pgTable(
  'observations',
  {
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    metricId: text('metric_id')
      .notNull()
      .references(() => metrics.id),
    ts: tsz('ts').notNull(),
    value: doublePrecision('value').notNull(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    quality: observationQuality('quality').notNull().default('ok'),
    origin: observationOrigin('origin').notNull(),
    ingestRunId: uuid('ingest_run_id').references(() => ingestRuns.id),
  },
  (t) => [
    primaryKey({ columns: [t.astronautId, t.metricId, t.ts] }),
    index('observations_ts_brin').using('brin', t.ts),
  ]
);

export const wellbeingCheckIns = pgTable(
  'wellbeing_check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    ts: tsz('ts').notNull().defaultNow(),
    mood: smallint('mood').notNull(),
    stress: smallint('stress').notNull(),
    energy: smallint('energy').notNull(),
    sleepQuality: smallint('sleep_quality').notNull(),
    cohesion: smallint('cohesion').notNull(),
    motivation: smallint('motivation').notNull(),
    note: text('note'),
  },
  (t) => [index('wellbeing_astronaut_ts_idx').on(t.astronautId, t.ts)]
);

export const environmentReadings = pgTable(
  'environment_readings',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    metricId: text('metric_id')
      .notNull()
      .references(() => metrics.id),
    ts: tsz('ts').notNull(),
    value: doublePrecision('value').notNull(),
    sourceId: text('source_id').references(() => dataSources.id),
  },
  (t) => [primaryKey({ columns: [t.missionId, t.metricId, t.ts] })]
);

export const dailyMetrics = pgTable(
  'daily_metrics',
  {
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    metricId: text('metric_id')
      .notNull()
      .references(() => metrics.id),
    day: date('day', { mode: 'string' }).notNull(),
    value: doublePrecision('value').notNull(),
    n: integer('n').notNull(),
    method: text('method').notNull(),
    origin: observationOrigin('origin').notNull(),
    pipelineVersion: text('pipeline_version').notNull(),
    computedAt: tsz('computed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.astronautId, t.metricId, t.day] })]
);

export const baselines = pgTable(
  'baselines',
  {
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    metricId: text('metric_id')
      .notNull()
      .references(() => metrics.id),
    kind: baselineKind('kind').notNull(),
    hour: smallint('hour').notNull().default(-1), // -1 = not hour-specific
    n: integer('n').notNull(),
    mean: doublePrecision('mean').notNull(),
    sd: doublePrecision('sd').notNull(),
    median: doublePrecision('median').notNull(),
    mad: doublePrecision('mad').notNull(),
    p05: doublePrecision('p05').notNull(),
    p95: doublePrecision('p95').notNull(),
    windowStart: tsz('window_start').notNull(),
    windowEnd: tsz('window_end').notNull(),
    pipelineVersion: text('pipeline_version').notNull(),
    computedAt: tsz('computed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.astronautId, t.metricId, t.kind, t.hour] })]
);

export const anomalies = pgTable(
  'anomalies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    metricId: text('metric_id')
      .notNull()
      .references(() => metrics.id),
    tsStart: tsz('ts_start').notNull(),
    tsEnd: tsz('ts_end').notNull(),
    detector: anomalyDetector('detector').notNull(),
    score: doublePrecision('score').notNull(),
    severity: anomalySeverity('severity').notNull(),
    detail: jsonb('detail'),
    pipelineVersion: text('pipeline_version').notNull(),
    computedAt: tsz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    index('anomalies_astronaut_ts_idx').on(t.astronautId, t.tsStart),
    uniqueIndex('anomalies_dedupe').on(t.astronautId, t.metricId, t.detector, t.tsStart),
  ]
);

export const triageEvents = pgTable(
  'triage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    ts: tsz('ts').notNull().defaultNow(),
    zone: text('zone').notNull(),
    status: triageStatus('status').notNull(),
    previousStatus: triageStatus('previous_status'),
    metrics: jsonb('metrics').notNull(),
    engineVersion: text('engine_version').notNull(),
  },
  (t) => [index('triage_astronaut_ts_idx').on(t.astronautId, t.ts)]
);

// ── Reference (NASA) ────────────────────────────────────────────────────────
export const refThresholds = pgTable('ref_thresholds', {
  id: text('id').primaryKey(),
  quantity: text('quantity').notNull(),
  limitValue: doublePrecision('limit_value').notNull(),
  unit: text('unit').notNull(),
  context: text('context').notNull(),
  sourceId: text('source_id')
    .notNull()
    .references(() => dataSources.id),
  sourceLocator: text('source_locator'), // section / page in the source
  ingestRunId: uuid('ingest_run_id').references(() => ingestRuns.id),
});

export const refRadiationDoseRates = pgTable('ref_radiation_dose_rates', {
  id: text('id').primaryKey(),
  environment: text('environment').notNull(), // SpaceLocationId-like key
  doseRateMsvPerDay: doublePrecision('dose_rate_msv_per_day').notNull(),
  quantity: text('quantity').notNull(), // dose equivalent / absorbed dose
  instrument: text('instrument'),
  periodLabel: text('period_label'),
  sourceId: text('source_id')
    .notNull()
    .references(() => dataSources.id),
  sourceLocator: text('source_locator'),
  ingestRunId: uuid('ingest_run_id').references(() => ingestRuns.id),
});

export const refOsdrStudies = pgTable('ref_osdr_studies', {
  id: text('id').primaryKey(), // OSD-xxx
  title: text('title').notNull(),
  mission: text('mission'),
  organism: text('organism'),
  assayTypes: text('assay_types'),
  description: text('description'),
  url: text('url'),
  sourceId: text('source_id')
    .notNull()
    .references(() => dataSources.id),
  ingestRunId: uuid('ingest_run_id').references(() => ingestRuns.id),
});

/** Long-format clinical lab values from open NASA datasets (e.g. Inspiration4 CBC, OSD-569). */
export const refOsdrLabValues = pgTable(
  'ref_osdr_lab_values',
  {
    studyId: text('study_id').notNull(), // OSD-xxx
    subject: text('subject').notNull(), // pseudonymous crew code, e.g. C001
    timepoint: text('timepoint').notNull(), // L-92 … R+194 (L = before launch, R = after return)
    daysFromLaunch: integer('days_from_launch').notNull(),
    phase: text('phase').notNull(), // preflight | postflight
    analyte: text('analyte').notNull(),
    value: doublePrecision('value').notNull(),
    unit: text('unit').notNull(),
    refMin: doublePrecision('ref_min'),
    refMax: doublePrecision('ref_max'),
    sourceId: text('source_id')
      .notNull()
      .references(() => dataSources.id),
    ingestRunId: uuid('ingest_run_id').references(() => ingestRuns.id),
  },
  (t) => [primaryKey({ columns: [t.studyId, t.subject, t.timepoint, t.analyte] })]
);

// ── 3.5 AI chat link ────────────────────────────────────────────────────────
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astronautId: text('astronaut_id')
      .notNull()
      .references(() => astronauts.id, { onDelete: 'cascade' }),
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: tsz('started_at').notNull().defaultNow(),
  },
  (t) => [index('conversations_astronaut_idx').on(t.astronautId, t.startedAt)]
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    ts: tsz('ts').notNull().defaultNow(),
    role: chatRole('role').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    provider: text('provider'),
    model: text('model'),
    source: text('source'), // 'ai' | 'offline_verified_cache'
    contextSnapshot: jsonb('context_snapshot'),
    triageEventId: uuid('triage_event_id').references(() => triageEvents.id, { onDelete: 'set null' }),
    crisisFlag: boolean('crisis_flag').notNull().default(false),
  },
  (t) => [index('messages_conversation_ts_idx').on(t.conversationId, t.ts)]
);
