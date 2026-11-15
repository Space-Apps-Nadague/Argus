CREATE TABLE "earth_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astronaut_id" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"urgency" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"one_way_delay_sec" real DEFAULT 0 NOT NULL,
	"deliver_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"reply_text" text,
	"replied_by" uuid,
	"replied_by_name" text,
	"replied_at" timestamp with time zone,
	"reply_deliver_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mental_state_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astronaut_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"concern_level" text NOT NULL,
	"score" smallint NOT NULL,
	"mood" text NOT NULL,
	"stress" text NOT NULL,
	"fatigue" text NOT NULL,
	"trend" text NOT NULL,
	"assessment" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "earth_packets" ADD CONSTRAINT "earth_packets_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earth_packets" ADD CONSTRAINT "earth_packets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earth_packets" ADD CONSTRAINT "earth_packets_replied_by_users_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mental_state_assessments" ADD CONSTRAINT "mental_state_assessments_astronaut_id_astronauts_id_fk" FOREIGN KEY ("astronaut_id") REFERENCES "public"."astronauts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "earth_packets_astronaut_idx" ON "earth_packets" USING btree ("astronaut_id","created_at");--> statement-breakpoint
CREATE INDEX "earth_packets_deliver_idx" ON "earth_packets" USING btree ("deliver_at");--> statement-breakpoint
CREATE INDEX "mental_state_astronaut_ts_idx" ON "mental_state_assessments" USING btree ("astronaut_id","ts");