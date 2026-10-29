CREATE TYPE "public"."hold_purpose" AS ENUM('booking', 'gift_redemption');--> statement-breakpoint
CREATE TYPE "public"."hold_released_reason" AS ENUM('expired', 'guest_left', 'payment_abandoned', 'sold_out_after_lapse', 'session_cancelled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."hold_status" AS ENUM('active', 'paying', 'converted', 'released');--> statement-breakpoint
CREATE TABLE "hold_items" (
	"hold_id" uuid NOT NULL,
	"price_option_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"uses_space" boolean NOT NULL,
	CONSTRAINT "hold_items_hold_id_price_option_id_pk" PRIMARY KEY("hold_id","price_option_id"),
	CONSTRAINT "hold_items_quantity_in_range" CHECK ("hold_items"."quantity" BETWEEN 1 AND 6),
	CONSTRAINT "hold_items_unit_price_in_range" CHECK ("hold_items"."unit_price_minor" BETWEEN 0 AND 10000000)
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"purpose" "hold_purpose" NOT NULL,
	"gift_id" uuid,
	"status" "hold_status" DEFAULT 'active' NOT NULL,
	"seats" integer NOT NULL,
	"device_key" text NOT NULL,
	"ip_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paying_until" timestamp with time zone,
	"released_reason" "hold_released_reason",
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holds_gift_matches_purpose" CHECK (("holds"."purpose" = 'gift_redemption') = ("holds"."gift_id" IS NOT NULL)),
	CONSTRAINT "holds_seats_in_range" CHECK ("holds"."seats" BETWEEN 1 AND 6),
	CONSTRAINT "holds_device_key_sha256" CHECK ("holds"."device_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "holds_ip_hash_sha256" CHECK ("holds"."ip_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "holds_released_reason_matches_status" CHECK (("holds"."status" = 'released') = ("holds"."released_reason" IS NOT NULL)),
	CONSTRAINT "holds_superseded_by_matches_reason" CHECK (coalesce("holds"."released_reason" = 'superseded', false) = ("holds"."superseded_by" IS NOT NULL)),
	CONSTRAINT "holds_not_superseded_by_itself" CHECK ("holds"."superseded_by" IS NULL OR "holds"."superseded_by" <> "holds"."id"),
	CONSTRAINT "holds_paying_has_deadline" CHECK ("holds"."status" <> 'paying' OR "holds"."paying_until" IS NOT NULL),
	CONSTRAINT "holds_paying_until_not_before_expiry" CHECK ("holds"."paying_until" IS NULL OR "holds"."paying_until" >= "holds"."expires_at"),
	CONSTRAINT "holds_expiry_window" CHECK ("holds"."expires_at" > "holds"."created_at" AND "holds"."expires_at" <= "holds"."created_at" + make_interval(mins => 60)),
	CONSTRAINT "holds_updated_not_before_created" CHECK ("holds"."updated_at" >= "holds"."created_at"),
	CONSTRAINT "holds_expires_at_in_range" CHECK ("holds"."expires_at" >= '1000-01-01 00:00:00+00' AND "holds"."expires_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "holds_paying_until_in_range" CHECK ("holds"."paying_until" >= '1000-01-01 00:00:00+00' AND "holds"."paying_until" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "holds_created_at_in_range" CHECK ("holds"."created_at" >= '1000-01-01 00:00:00+00' AND "holds"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "holds_updated_at_in_range" CHECK ("holds"."updated_at" >= '1000-01-01 00:00:00+00' AND "holds"."updated_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "hold_items" ADD CONSTRAINT "hold_items_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_items" ADD CONSTRAINT "hold_items_price_option_id_price_options_id_fk" FOREIGN KEY ("price_option_id") REFERENCES "public"."price_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_superseded_by_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holds_session_open_idx" ON "holds" USING btree ("session_id") WHERE "holds"."status" IN ('active', 'paying');