CREATE TYPE "public"."email_adapter" AS ENUM('fake', 'resend', 'postmark');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'captured', 'delivered', 'bounced', 'complained', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'complaint');--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"address" text PRIMARY KEY NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_address_shape" CHECK ("email_suppressions"."address" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("email_suppressions"."address") <= 254)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"template" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"status" "message_status" NOT NULL,
	"adapter" "email_adapter" NOT NULL,
	"provider_message_id" text,
	"html" text,
	"text_body" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "messages_idempotency_key_shape" CHECK ("messages"."idempotency_key" ~ '^[!-~]{1,200}$'),
	CONSTRAINT "messages_template_shape" CHECK ("messages"."template" ~ '^[a-z][a-z0-9-]*$' AND char_length("messages"."template") <= 64),
	CONSTRAINT "messages_recipient_shape" CHECK ("messages"."recipient" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("messages"."recipient") <= 254),
	CONSTRAINT "messages_subject_shape" CHECK ("messages"."subject" ~ '^[^\r\n]+$' AND char_length("messages"."subject") <= 200),
	CONSTRAINT "messages_provider_message_id_length" CHECK ("messages"."provider_message_id" IS NULL OR char_length("messages"."provider_message_id") BETWEEN 1 AND 200),
	CONSTRAINT "messages_provider_message_id_follows_status" CHECK (("messages"."status" IN ('queued', 'failed', 'suppressed')) = ("messages"."provider_message_id" IS NULL)),
	CONSTRAINT "messages_body_only_for_fake_adapter" CHECK ("messages"."adapter" = 'fake' OR ("messages"."html" IS NULL AND "messages"."text_body" IS NULL)),
	CONSTRAINT "messages_body_is_both_or_neither" CHECK (("messages"."html" IS NULL) = ("messages"."text_body" IS NULL)),
	CONSTRAINT "messages_body_length" CHECK (("messages"."html" IS NULL OR char_length("messages"."html") BETWEEN 1 AND 300000) AND ("messages"."text_body" IS NULL OR char_length("messages"."text_body") BETWEEN 1 AND 300000)),
	CONSTRAINT "messages_attempts_capped" CHECK ("messages"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "messages_failure_reason_iff_failed" CHECK (("messages"."status" = 'failed') = ("messages"."failure_reason" IS NOT NULL) AND ("messages"."failure_reason" IS NULL OR char_length("messages"."failure_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "messages_created_at_in_range" CHECK ("messages"."created_at" >= '1000-01-01 00:00:00+00' AND "messages"."created_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_message_id_unique" ON "messages" USING btree ("adapter","provider_message_id") WHERE "messages"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);