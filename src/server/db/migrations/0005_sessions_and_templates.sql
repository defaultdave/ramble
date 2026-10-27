CREATE TYPE "public"."session_cancel_reason" AS ENUM('host', 'weather', 'ramble');--> statement-breakpoint
CREATE TYPE "public"."session_source" AS ENUM('ramble', 'allocation', 'external');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('scheduled', 'cancelled', 'completed');--> statement-breakpoint
CREATE TABLE "session_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time(0) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"allocation" integer NOT NULL,
	"source" "session_source" DEFAULT 'ramble' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_templates_id_experience_unique" UNIQUE("id","experience_id"),
	CONSTRAINT "session_templates_weekday_in_range" CHECK ("session_templates"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "session_templates_start_time_whole_minute" CHECK ("session_templates"."start_time" < '24:00:00' AND extract(second FROM "session_templates"."start_time") = 0),
	CONSTRAINT "session_templates_duration_in_range" CHECK ("session_templates"."duration_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "session_templates_allocation_in_range" CHECK ("session_templates"."allocation" BETWEEN 0 AND 1000),
	CONSTRAINT "session_templates_source_generated" CHECK ("session_templates"."source" IN ('ramble', 'allocation')),
	CONSTRAINT "session_templates_created_at_in_range" CHECK ("session_templates"."created_at" >= '1000-01-01 00:00:00+00' AND "session_templates"."created_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"template_id" uuid,
	"local_date" date,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"allocation" integer NOT NULL,
	"seats_sold" integer DEFAULT 0 NOT NULL,
	"status" "session_status" DEFAULT 'scheduled' NOT NULL,
	"source" "session_source" NOT NULL,
	"cancel_reason" "session_cancel_reason",
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sessions_ends_after_start" CHECK ("sessions"."ends_at" > "sessions"."starts_at"),
	CONSTRAINT "sessions_starts_at_in_range" CHECK ("sessions"."starts_at" >= '1000-01-01 00:00:00+00' AND "sessions"."starts_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "sessions_ends_at_in_range" CHECK ("sessions"."ends_at" >= '1000-01-01 00:00:00+00' AND "sessions"."ends_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "sessions_allocation_in_range" CHECK ("sessions"."allocation" BETWEEN 0 AND 1000),
	CONSTRAINT "sessions_seats_sold_not_negative" CHECK ("sessions"."seats_sold" >= 0),
	CONSTRAINT "sessions_seats_sold_within_allocation" CHECK ("sessions"."seats_sold" <= "sessions"."allocation"),
	CONSTRAINT "sessions_time_zone_iana" CHECK (char_length("sessions"."time_zone") <= 64 AND "sessions"."time_zone" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$|^UTC$'),
	CONSTRAINT "sessions_cancel_reason_matches_status" CHECK (("sessions"."status" = 'cancelled') = ("sessions"."cancel_reason" IS NOT NULL)),
	CONSTRAINT "sessions_version_positive" CHECK ("sessions"."version" >= 1),
	CONSTRAINT "sessions_template_has_local_date" CHECK (("sessions"."template_id" IS NULL) = ("sessions"."local_date" IS NULL)),
	CONSTRAINT "sessions_local_date_in_range" CHECK ("sessions"."local_date" IS NULL OR "sessions"."local_date" BETWEEN '1000-01-01' AND '9999-12-31'),
	CONSTRAINT "sessions_template_source_generated" CHECK ("sessions"."template_id" IS NULL OR "sessions"."source" IN ('ramble', 'allocation'))
);
--> statement-breakpoint
ALTER TABLE "session_templates" ADD CONSTRAINT "session_templates_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_template_experience_fk" FOREIGN KEY ("template_id","experience_id") REFERENCES "public"."session_templates"("id","experience_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_templates_slot_unique" ON "session_templates" USING btree ("experience_id","weekday","start_time");--> statement-breakpoint
CREATE INDEX "sessions_experience_starts_at_idx" ON "sessions" USING btree ("experience_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_template_local_date_unique" ON "sessions" USING btree ("template_id","local_date");