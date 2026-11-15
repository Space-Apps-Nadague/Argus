CREATE TYPE "public"."rag_doc_kind" AS ENUM('emergency_checklist', 'countermeasure', 'clinical_reference', 'medication');--> statement-breakpoint
CREATE TABLE "rag_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" real[],
	"embedding_model" text,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading, '') || ' ' || coalesce(content, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "rag_citations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"astronaut_id" text,
	"message_id" uuid,
	"mode" text NOT NULL,
	"query" text NOT NULL,
	"chunk_id" uuid,
	"document_id" text,
	"source_id" text,
	"rank" smallint NOT NULL,
	"score" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"title" text NOT NULL,
	"kind" "rag_doc_kind" NOT NULL,
	"origin" text NOT NULL,
	"url" text,
	"zone_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"content_hash" text NOT NULL,
	"ingest_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_document_id_rag_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rag_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_citations" ADD CONSTRAINT "rag_citations_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_citations" ADD CONSTRAINT "rag_citations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_citations" ADD CONSTRAINT "rag_citations_chunk_id_rag_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."rag_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_citations" ADD CONSTRAINT "rag_citations_document_id_rag_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rag_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rag_chunks_document_ordinal_idx" ON "rag_chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "rag_chunks_search_idx" ON "rag_chunks" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "rag_citations_astronaut_ts_idx" ON "rag_citations" USING btree ("astronaut_id","ts");--> statement-breakpoint
CREATE INDEX "rag_citations_message_idx" ON "rag_citations" USING btree ("message_id");