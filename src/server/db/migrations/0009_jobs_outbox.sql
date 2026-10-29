CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'dead');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"run_after" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"finished_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "jobs_kind_shape" CHECK ("jobs"."kind" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("jobs"."kind") <= 64),
	CONSTRAINT "jobs_payload_bounded" CHECK (jsonb_typeof("jobs"."payload") = 'object' AND pg_column_size("jobs"."payload") <= 16384),
	CONSTRAINT "jobs_dedupe_key_shape" CHECK ("jobs"."dedupe_key" IS NULL OR ("jobs"."dedupe_key" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]*$' AND char_length("jobs"."dedupe_key") <= 200)),
	CONSTRAINT "jobs_max_attempts_range" CHECK ("jobs"."max_attempts" BETWEEN 1 AND 20),
	CONSTRAINT "jobs_attempts_range" CHECK ("jobs"."attempts" >= 0 AND "jobs"."attempts" <= "jobs"."max_attempts"),
	CONSTRAINT "jobs_last_error_bounded" CHECK ("jobs"."last_error" IS NULL OR char_length("jobs"."last_error") <= 2000),
	CONSTRAINT "jobs_finished_matches_status" CHECK (("jobs"."status" IN ('succeeded', 'dead')) = ("jobs"."finished_at" IS NOT NULL)),
	CONSTRAINT "jobs_locked_matches_status" CHECK (("jobs"."status" = 'running') = ("jobs"."locked_until" IS NOT NULL)),
	CONSTRAINT "jobs_run_after_readable" CHECK ("jobs"."run_after" >= '1000-01-01 00:00:00+00' AND "jobs"."run_after" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_unique" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_status_run_after" ON "jobs" USING btree ("status","run_after");