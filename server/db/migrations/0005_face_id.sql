CREATE TABLE "face_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"user_agent" text,
	CONSTRAINT "face_logins_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "face_logins" ADD CONSTRAINT "face_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "face_logins_user_idx" ON "face_logins" USING btree ("user_id");