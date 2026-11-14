CREATE TYPE "public"."anomaly_detector" AS ENUM('robust_z', 'ewma', 'cusum');--> statement-breakpoint
CREATE TYPE "public"."anomaly_severity" AS ENUM('watch', 'drifting');--> statement-breakpoint
CREATE TYPE "public"."baseline_kind" AS ENUM('preflight', 'rolling_14d', 'hour_of_day');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."device_kind" AS ENUM('smart_shirt', 'bp_cuff', 'wrist_actigraph', 'ring', 'core_temp_patch', 'dosimeter', 'manual');--> statement-breakpoint
CREATE TYPE "public"."ingest_kind" AS ENUM('wearable_batch', 'simulator_backfill', 'nasa_dataset', 'check_in', 'import', 'seed');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."metric_kind" AS ENUM('passive', 'clinical', 'self_report', 'environment', 'derived');--> statement-breakpoint
CREATE TYPE "public"."observation_origin" AS ENUM('wearable', 'check_in', 'clinical', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."observation_quality" AS ENUM('ok', 'artifact', 'out_of_range');--> statement-breakpoint
CREATE TYPE "public"."triage_status" AS ENUM('green', 'yellow', 'red');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'astronaut', 'flight_surgeon');--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astronaut_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"ts_start" timestamp with time zone NOT NULL,
	"ts_end" timestamp with time zone NOT NULL,
	"detector" "anomaly_detector" NOT NULL,
	"score" double precision NOT NULL,
	"severity" "anomaly_severity" NOT NULL,
	"detail" jsonb,
	"pipeline_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "astronaut_private" (
	"astronaut_id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"medical_notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "astronauts" (
	"id" text PRIMARY KEY NOT NULL,
	"mission_id" text,
	"callsign" text NOT NULL,
	"sex" text NOT NULL,
	"birth_year" smallint NOT NULL,
	"blood_type" text NOT NULL,
	"crew_role" text NOT NULL,
	"resting_hr_baseline_bpm" real NOT NULL,
	"pre_flight_onsd_mm" real NOT NULL,
	"default_scenario_id" text DEFAULT 'nominal' NOT NULL,
	"countermeasure_streak_sols" integer DEFAULT 0 NOT NULL,
	"ai_consent" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"detail" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"astronaut_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"kind" "baseline_kind" NOT NULL,
	"hour" smallint DEFAULT -1 NOT NULL,
	"n" integer NOT NULL,
	"mean" double precision NOT NULL,
	"sd" double precision NOT NULL,
	"median" double precision NOT NULL,
	"mad" double precision NOT NULL,
	"p05" double precision NOT NULL,
	"p95" double precision NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"pipeline_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baselines_astronaut_id_metric_id_kind_hour_pk" PRIMARY KEY("astronaut_id","metric_id","kind","hour")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astronaut_id" text NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"astronaut_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"day" date NOT NULL,
	"value" double precision NOT NULL,
	"n" integer NOT NULL,
	"method" text NOT NULL,
	"origin" "observation_origin" NOT NULL,
	"pipeline_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_metrics_astronaut_id_metric_id_day_pk" PRIMARY KEY("astronaut_id","metric_id","day")
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"kind" text,
	"access" text
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astronaut_id" text NOT NULL,
	"kind" "device_kind" NOT NULL,
	"model" text NOT NULL,
	"serial" text,
	"token_hash" text,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "environment_readings" (
	"mission_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"source_id" text,
	CONSTRAINT "environment_readings_mission_id_metric_id_ts_pk" PRIMARY KEY("mission_id","metric_id","ts")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text,
	"kind" "ingest_kind" NOT NULL,
	"script" text,
	"checksum" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"status" "ingest_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"role" "chat_role" NOT NULL,
	"author_user_id" uuid,
	"content" text NOT NULL,
	"provider" text,
	"model" text,
	"source" text,
	"context_snapshot" jsonb,
	"triage_event_id" uuid,
	"crisis_flag" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"zone" text,
	"kind" "metric_kind" NOT NULL,
	"plausible_min" double precision NOT NULL,
	"plausible_max" double precision NOT NULL,
	"source_id" text
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"gravity_env" text DEFAULT '0g_transit' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"astronaut_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"device_id" uuid,
	"quality" "observation_quality" DEFAULT 'ok' NOT NULL,
	"origin" "observation_origin" NOT NULL,
	"ingest_run_id" uuid,
	CONSTRAINT "observations_astronaut_id_metric_id_ts_pk" PRIMARY KEY("astronaut_id","metric_id","ts")
);
--> statement-breakpoint
CREATE TABLE "raw_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"ingest_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ref_osdr_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"mission" text,
	"organism" text,
	"assay_types" text,
	"description" text,
	"url" text,
	"source_id" text NOT NULL,
	"ingest_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ref_radiation_dose_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"dose_rate_msv_per_day" double precision NOT NULL,
	"quantity" text NOT NULL,
	"instrument" text,
	"period_label" text,
	"source_id" text NOT NULL,
	"source_locator" text,
	"ingest_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ref_thresholds" (
	"id" text PRIMARY KEY NOT NULL,
	"quantity" text NOT NULL,
	"limit_value" double precision NOT NULL,
	"unit" text NOT NULL,
	"context" text NOT NULL,
	"source_id" text NOT NULL,
	"source_locator" text,
	"ingest_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "triage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astronaut_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"zone" text NOT NULL,
	"status" "triage_status" NOT NULL,
	"previous_status" "triage_status",
	"metrics" jsonb NOT NULL,
	"engine_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" "citext" NOT NULL,
	"role" "user_role" NOT NULL,
	"astronaut_id" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "wellbeing_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astronaut_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"mood" smallint NOT NULL,
	"stress" smallint NOT NULL,
	"energy" smallint NOT NULL,
	"sleep_quality" smallint NOT NULL,
	"cohesion" smallint NOT NULL,
	"motivation" smallint NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "astronaut_private" ADD CONSTRAINT "astronaut_private_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "astronauts" ADD CONSTRAINT "astronauts_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_readings" ADD CONSTRAINT "environment_readings_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_readings" ADD CONSTRAINT "environment_readings_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_readings" ADD CONSTRAINT "environment_readings_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_triage_event_id_triage_events_id_fk" FOREIGN KEY ("triage_event_id") REFERENCES "public"."triage_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_readings" ADD CONSTRAINT "raw_readings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_readings" ADD CONSTRAINT "raw_readings_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_osdr_studies" ADD CONSTRAINT "ref_osdr_studies_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_osdr_studies" ADD CONSTRAINT "ref_osdr_studies_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_radiation_dose_rates" ADD CONSTRAINT "ref_radiation_dose_rates_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_radiation_dose_rates" ADD CONSTRAINT "ref_radiation_dose_rates_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_thresholds" ADD CONSTRAINT "ref_thresholds_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_thresholds" ADD CONSTRAINT "ref_thresholds_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_events" ADD CONSTRAINT "triage_events_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wellbeing_check_ins" ADD CONSTRAINT "wellbeing_check_ins_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anomalies_astronaut_ts_idx" ON "anomalies" USING btree ("astronaut_id","ts_start");--> statement-breakpoint
CREATE UNIQUE INDEX "anomalies_dedupe" ON "anomalies" USING btree ("astronaut_id","metric_id","detector","ts_start");--> statement-breakpoint
CREATE INDEX "audit_ts_idx" ON "audit_log" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "conversations_astronaut_idx" ON "conversations" USING btree ("astronaut_id","started_at");--> statement-breakpoint
CREATE INDEX "devices_astronaut_idx" ON "devices" USING btree ("astronaut_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_ts_idx" ON "messages" USING btree ("conversation_id","ts");--> statement-breakpoint
CREATE INDEX "observations_ts_brin" ON "observations" USING brin ("ts");--> statement-breakpoint
CREATE INDEX "raw_readings_received_brin" ON "raw_readings" USING brin ("received_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "triage_astronaut_ts_idx" ON "triage_events" USING btree ("astronaut_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "users_astronaut_unique" ON "users" USING btree ("astronaut_id") WHERE "users"."astronaut_id" is not null;--> statement-breakpoint
CREATE INDEX "wellbeing_astronaut_ts_idx" ON "wellbeing_check_ins" USING btree ("astronaut_id","ts");