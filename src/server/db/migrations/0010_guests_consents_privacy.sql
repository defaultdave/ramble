CREATE TYPE "public"."consent_kind" AS ENUM('newsletter', 'attribution');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('checkout', 'unsubscribe', 'ops', 'erasure');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_kind" AS ENUM('access', 'deletion');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('open', 'completed', 'declined');--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" "consent_source" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "consents_source_allows_status" CHECK (("consents"."source" = 'checkout' AND "consents"."status" IN ('granted')) OR ("consents"."source" = 'unsubscribe' AND "consents"."status" IN ('withdrawn')) OR ("consents"."source" = 'ops' AND "consents"."status" IN ('granted', 'withdrawn')) OR ("consents"."source" = 'erasure' AND "consents"."status" IN ('withdrawn'))),
	CONSTRAINT "consents_recorded_at_in_range" CHECK ("consents"."recorded_at" >= '1000-01-01 00:00:00+00' AND "consents"."recorded_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "guests_email_shape" CHECK ("guests"."email" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("guests"."email") <= 254),
	CONSTRAINT "guests_reserved_domain_iff_anonymized" CHECK (("guests"."anonymized_at" IS NOT NULL) = ("guests"."email" ~ '@anonymized\.invalid$')),
	CONSTRAINT "guests_anonymized_email_from_id" CHECK ("guests"."anonymized_at" IS NULL OR "guests"."email" = 'erased-' || "guests"."id"::text || '@anonymized.invalid'),
	CONSTRAINT "guests_created_at_in_range" CHECK ("guests"."created_at" >= '1000-01-01 00:00:00+00' AND "guests"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "guests_anonymized_at_in_range" CHECK ("guests"."anonymized_at" IS NULL OR ("guests"."anonymized_at" >= '1000-01-01 00:00:00+00' AND "guests"."anonymized_at" < '10000-01-01 00:00:00+00' AND "guests"."anonymized_at" >= "guests"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_id" uuid NOT NULL,
	"kind" "privacy_request_kind" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "privacy_requests_resolved_iff_not_open" CHECK (("privacy_requests"."status" = 'open') = ("privacy_requests"."resolved_at" IS NULL)),
	CONSTRAINT "privacy_requests_created_at_in_range" CHECK ("privacy_requests"."created_at" >= '1000-01-01 00:00:00+00' AND "privacy_requests"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "privacy_requests_resolved_at_in_range" CHECK ("privacy_requests"."resolved_at" IS NULL OR ("privacy_requests"."resolved_at" >= '1000-01-01 00:00:00+00' AND "privacy_requests"."resolved_at" < '10000-01-01 00:00:00+00' AND "privacy_requests"."resolved_at" >= "privacy_requests"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_guest_kind_recorded_idx" ON "consents" USING btree ("guest_id","kind","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "guests_email_unique" ON "guests" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_one_open_per_kind" ON "privacy_requests" USING btree ("guest_id","kind") WHERE "privacy_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "privacy_requests_guest_idx" ON "privacy_requests" USING btree ("guest_id");