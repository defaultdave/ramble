CREATE TYPE "public"."support_topic" AS ENUM('booking', 'change_or_cancel', 'refund', 'gift', 'accessibility', 'other');--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"topic" "support_topic" NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_requests_name_shape" CHECK ("support_requests"."name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("support_requests"."name") <= 120),
	CONSTRAINT "support_requests_email_shape" CHECK ("support_requests"."email" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("support_requests"."email") <= 254),
	CONSTRAINT "support_requests_message_shape" CHECK ("support_requests"."message" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("support_requests"."message") <= 2000),
	CONSTRAINT "support_requests_created_at_in_range" CHECK ("support_requests"."created_at" >= '1000-01-01 00:00:00+00' AND "support_requests"."created_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE INDEX "support_requests_created_at_idx" ON "support_requests" USING btree ("created_at" DESC NULLS LAST);