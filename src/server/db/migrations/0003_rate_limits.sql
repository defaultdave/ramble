CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_key_shape" CHECK ("rate_limits"."key" ~ '^[a-z][a-z_]{0,31}:[0-9a-f]{64}$'),
	CONSTRAINT "rate_limits_count_positive" CHECK ("rate_limits"."count" >= 1),
	CONSTRAINT "rate_limits_window_forward" CHECK ("rate_limits"."expires_at" > "rate_limits"."window_started_at")
);
--> statement-breakpoint
CREATE INDEX "rate_limits_expires_at" ON "rate_limits" USING btree ("expires_at");