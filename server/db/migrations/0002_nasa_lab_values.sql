CREATE TABLE "ref_osdr_lab_values" (
	"study_id" text NOT NULL,
	"subject" text NOT NULL,
	"timepoint" text NOT NULL,
	"days_from_launch" integer NOT NULL,
	"phase" text NOT NULL,
	"analyte" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"ref_min" double precision,
	"ref_max" double precision,
	"source_id" text NOT NULL,
	"ingest_run_id" uuid,
	CONSTRAINT "ref_osdr_lab_values_study_id_subject_timepoint_analyte_pk" PRIMARY KEY("study_id","subject","timepoint","analyte")
);
--> statement-breakpoint
ALTER TABLE "ref_osdr_lab_values" ADD CONSTRAINT "ref_osdr_lab_values_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_osdr_lab_values" ADD CONSTRAINT "ref_osdr_lab_values_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;