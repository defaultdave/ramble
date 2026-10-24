CREATE TYPE "public"."age_rule" AS ENUM('all_ages', 'minimum_age', 'age_range', 'twenty_one_plus');--> statement-breakpoint
CREATE TYPE "public"."experience_status" AS ENUM('draft', 'in_review', 'live', 'paused', 'guide_only');--> statement-breakpoint
CREATE TYPE "public"."price_kind" AS ENUM('adult', 'child');--> statement-breakpoint
CREATE TYPE "public"."slug_entity_kind" AS ENUM('category', 'neighborhood', 'experience', 'host');--> statement-breakpoint
CREATE TYPE "public"."tax_treatment" AS ENUM('taxable', 'not_taxable', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."weather_policy" AS ENUM('rain_or_shine', 'decided_before_start');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_slug_kebab" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"neighborhood_id" uuid NOT NULL,
	"cancellation_tier_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"meeting_point" text,
	"included" text,
	"duration_minutes" integer,
	"accessibility_notes" text,
	"status" "experience_status" DEFAULT 'draft' NOT NULL,
	"outdoor" boolean DEFAULT false NOT NULL,
	"weather_policy" "weather_policy",
	"weather_decision_hours" integer,
	"age_rule" "age_rule" DEFAULT 'all_ages' NOT NULL,
	"min_age" integer,
	"max_age" integer,
	"tax_treatment" "tax_treatment" DEFAULT 'unknown' NOT NULL,
	"waiver_required" boolean DEFAULT false NOT NULL,
	"waiver_document_id" uuid,
	"link_out_url" text,
	"affiliate_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_slug_kebab" CHECK ("experiences"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "experiences_duration_positive" CHECK ("experiences"."duration_minutes" > 0),
	CONSTRAINT "experiences_age_rule_limits" CHECK ((
        "experiences"."age_rule" IN ('all_ages', 'twenty_one_plus')
          AND "experiences"."min_age" IS NULL AND "experiences"."max_age" IS NULL
      ) OR (
        "experiences"."age_rule" = 'minimum_age'
          AND "experiences"."min_age" IS NOT NULL AND "experiences"."min_age" >= 0
          AND "experiences"."max_age" IS NULL
      ) OR (
        "experiences"."age_rule" = 'age_range'
          AND "experiences"."min_age" IS NOT NULL AND "experiences"."min_age" >= 0
          AND "experiences"."max_age" IS NOT NULL AND "experiences"."max_age" >= "experiences"."min_age"
      )),
	CONSTRAINT "experiences_outdoor_has_weather_policy" CHECK (NOT "experiences"."outdoor" OR "experiences"."weather_policy" IS NOT NULL),
	CONSTRAINT "experiences_weather_decision_hours" CHECK (coalesce("experiences"."weather_policy" = 'decided_before_start', false)
        = ("experiences"."weather_decision_hours" IS NOT NULL)
        AND coalesce("experiences"."weather_decision_hours" > 0, true)),
	CONSTRAINT "experiences_guide_only_has_link" CHECK ("experiences"."status" <> 'guide_only' OR "experiences"."link_out_url" IS NOT NULL),
	CONSTRAINT "experiences_urls_are_http" CHECK (("experiences"."link_out_url" IS NULL OR "experiences"."link_out_url" ~* '^https?://')
        AND ("experiences"."affiliate_url" IS NULL OR "experiences"."affiliate_url" ~* '^https?://'))
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hosts_slug_kebab" CHECK ("hosts"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "neighborhoods_slug_unique" UNIQUE("slug"),
	CONSTRAINT "neighborhoods_slug_kebab" CHECK ("neighborhoods"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "price_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"kind" "price_kind" NOT NULL,
	"price_minor" integer NOT NULL,
	"uses_space" boolean DEFAULT true NOT NULL,
	CONSTRAINT "price_options_price_not_negative" CHECK ("price_options"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "slug_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" "slug_entity_kind" NOT NULL,
	"entity_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"full_refund_hours_before" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cancellation_tiers_key_unique" UNIQUE("key"),
	CONSTRAINT "cancellation_tiers_hours_not_negative" CHECK ("cancellation_tiers"."full_refund_hours_before" >= 0)
);
--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_cancellation_tier_id_cancellation_tiers_id_fk" FOREIGN KEY ("cancellation_tier_id") REFERENCES "public"."cancellation_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_options" ADD CONSTRAINT "price_options_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiences_host_id_idx" ON "experiences" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "experiences_category_id_idx" ON "experiences" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "experiences_neighborhood_id_idx" ON "experiences" USING btree ("neighborhood_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_options_experience_kind_unique" ON "price_options" USING btree ("experience_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "slug_history_kind_slug_unique" ON "slug_history" USING btree ("entity_kind","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_tiers_one_default" ON "cancellation_tiers" USING btree ("is_default") WHERE "cancellation_tiers"."is_default";