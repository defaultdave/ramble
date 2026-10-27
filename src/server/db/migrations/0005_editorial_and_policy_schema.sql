CREATE TYPE "public"."publish_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."acceptance_subject_kind" AS ENUM('order', 'host');--> statement-breakpoint
CREATE TYPE "public"."gift_expiry_action" AS ENUM('refund_buyer', 'leave_open');--> statement-breakpoint
CREATE TYPE "public"."collection_kind" AS ENUM('pick', 'gift_guide');--> statement-breakpoint
CREATE TYPE "public"."home_module_kind" AS ENUM('hero_search', 'category_rail', 'picks', 'gift_guide', 'this_week', 'reassurance');--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"subject_kind" "acceptance_subject_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptances_accepted_at_in_range" CHECK ("legal_acceptances"."accepted_at" >= '1000-01-01 00:00:00+00' AND "legal_acceptances"."accepted_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_doc_key" CHECK ("legal_documents"."doc" ~ '^(terms|privacy|host-agreement|waiver-[a-z0-9]+(-[a-z0-9]+)*)$' AND char_length("legal_documents"."doc") <= 80),
	CONSTRAINT "legal_documents_version_positive" CHECK ("legal_documents"."version" >= 1),
	CONSTRAINT "legal_documents_title" CHECK ("legal_documents"."title" ~ '[^[:space:]]' AND char_length("legal_documents"."title") <= 120),
	CONSTRAINT "legal_documents_body_is_rich_text" CHECK (jsonb_typeof("legal_documents"."body") = 'object'
    AND coalesce("legal_documents"."body"->>'type', '') = 'doc'
    AND coalesce(jsonb_typeof("legal_documents"."body"->'content'), '') = 'array'
    AND octet_length("legal_documents"."body"::text) <= 200000),
	CONSTRAINT "legal_documents_published_at_matches_status" CHECK (("legal_documents"."status" = 'published') = ("legal_documents"."published_at" IS NOT NULL)),
	CONSTRAINT "legal_documents_dates_in_range" CHECK ("legal_documents"."created_at" >= '1000-01-01 00:00:00+00' AND "legal_documents"."created_at" < '10000-01-01 00:00:00+00'
        AND ("legal_documents"."published_at" IS NULL OR ("legal_documents"."published_at" >= '1000-01-01 00:00:00+00' AND "legal_documents"."published_at" < '10000-01-01 00:00:00+00')))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"banner_text" text,
	"bookings_paused" boolean DEFAULT false NOT NULL,
	"gifts_enabled" boolean DEFAULT true NOT NULL,
	"checkout_maintenance" boolean DEFAULT false NOT NULL,
	"hold_minutes" integer DEFAULT 10 NOT NULL,
	"payment_grace_minutes" integer DEFAULT 5 NOT NULL,
	"gift_validity_months" integer DEFAULT 12 NOT NULL,
	"gift_expiry_action" "gift_expiry_action" DEFAULT 'refund_buyer' NOT NULL,
	"tax_rate_ppm" integer DEFAULT 88750 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id"),
	CONSTRAINT "settings_banner_text" CHECK ("settings"."banner_text" IS NULL OR ("settings"."banner_text" ~ '[^[:space:]]' AND char_length("settings"."banner_text") <= 280)),
	CONSTRAINT "settings_hold_minutes" CHECK ("settings"."hold_minutes" BETWEEN 1 AND 60),
	CONSTRAINT "settings_payment_grace_minutes" CHECK ("settings"."payment_grace_minutes" BETWEEN 0 AND 30),
	CONSTRAINT "settings_gift_validity_months" CHECK ("settings"."gift_validity_months" BETWEEN 1 AND 120),
	CONSTRAINT "settings_tax_rate_ppm" CHECK ("settings"."tax_rate_ppm" BETWEEN 0 AND 250000),
	CONSTRAINT "settings_updated_at_in_range" CHECK ("settings"."updated_at" >= '1000-01-01 00:00:00+00' AND "settings"."updated_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"note" text,
	CONSTRAINT "collection_items_position_in_range" CHECK ("collection_items"."position" >= 0 AND "collection_items"."position" < 60),
	CONSTRAINT "collection_items_note" CHECK ("collection_items"."note" IS NULL OR ("collection_items"."note" ~ '[^[:space:]]' AND char_length("collection_items"."note") <= 280))
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "collection_kind" NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"intro" jsonb,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "collections_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "collections_slug_shape" CHECK ("collections"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("collections"."slug") <= 80),
	CONSTRAINT "collections_title" CHECK ("collections"."title" ~ '[^[:space:]]' AND char_length("collections"."title") <= 120),
	CONSTRAINT "collections_summary" CHECK ("collections"."summary" IS NULL OR ("collections"."summary" ~ '[^[:space:]]' AND char_length("collections"."summary") <= 300)),
	CONSTRAINT "collections_intro_is_rich_text" CHECK ("collections"."intro" IS NULL OR (jsonb_typeof("collections"."intro") = 'object'
    AND coalesce("collections"."intro"->>'type', '') = 'doc'
    AND coalesce(jsonb_typeof("collections"."intro"->'content'), '') = 'array'
    AND octet_length("collections"."intro"::text) <= 200000)),
	CONSTRAINT "collections_published_at_matches_status" CHECK (("collections"."status" = 'published') = ("collections"."published_at" IS NOT NULL)),
	CONSTRAINT "collections_dates_in_range" CHECK ("collections"."created_at" >= '1000-01-01 00:00:00+00' AND "collections"."created_at" < '10000-01-01 00:00:00+00' AND "collections"."updated_at" >= '1000-01-01 00:00:00+00' AND "collections"."updated_at" < '10000-01-01 00:00:00+00'
        AND ("collections"."published_at" IS NULL OR ("collections"."published_at" >= '1000-01-01 00:00:00+00' AND "collections"."published_at" < '10000-01-01 00:00:00+00')))
);
--> statement-breakpoint
CREATE TABLE "help_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "help_articles_slug_shape" CHECK ("help_articles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("help_articles"."slug") <= 80),
	CONSTRAINT "help_articles_title" CHECK ("help_articles"."title" ~ '[^[:space:]]' AND char_length("help_articles"."title") <= 120),
	CONSTRAINT "help_articles_summary" CHECK ("help_articles"."summary" IS NULL OR ("help_articles"."summary" ~ '[^[:space:]]' AND char_length("help_articles"."summary") <= 300)),
	CONSTRAINT "help_articles_body_is_rich_text" CHECK (jsonb_typeof("help_articles"."body") = 'object'
    AND coalesce("help_articles"."body"->>'type', '') = 'doc'
    AND coalesce(jsonb_typeof("help_articles"."body"->'content'), '') = 'array'
    AND octet_length("help_articles"."body"::text) <= 200000),
	CONSTRAINT "help_articles_position_in_range" CHECK ("help_articles"."position" >= 0 AND "help_articles"."position" <= 9999),
	CONSTRAINT "help_articles_published_at_matches_status" CHECK (("help_articles"."status" = 'published') = ("help_articles"."published_at" IS NOT NULL)),
	CONSTRAINT "help_articles_dates_in_range" CHECK ("help_articles"."created_at" >= '1000-01-01 00:00:00+00' AND "help_articles"."created_at" < '10000-01-01 00:00:00+00' AND "help_articles"."updated_at" >= '1000-01-01 00:00:00+00' AND "help_articles"."updated_at" < '10000-01-01 00:00:00+00'
        AND ("help_articles"."published_at" IS NULL OR ("help_articles"."published_at" >= '1000-01-01 00:00:00+00' AND "help_articles"."published_at" < '10000-01-01 00:00:00+00')))
);
--> statement-breakpoint
CREATE TABLE "home_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"kind" "home_module_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"heading" text,
	"body" jsonb,
	"collection_id" uuid,
	"collection_kind" "collection_kind" GENERATED ALWAYS AS (CASE "kind" WHEN 'picks' THEN 'pick'::collection_kind WHEN 'gift_guide' THEN 'gift_guide'::collection_kind END) STORED,
	CONSTRAINT "home_modules_position_unique" UNIQUE("position"),
	CONSTRAINT "home_modules_position_in_range" CHECK ("home_modules"."position" >= 0 AND "home_modules"."position" < 20),
	CONSTRAINT "home_modules_heading" CHECK ("home_modules"."heading" IS NULL OR ("home_modules"."heading" ~ '[^[:space:]]' AND char_length("home_modules"."heading") <= 120)),
	CONSTRAINT "home_modules_body_is_rich_text" CHECK ("home_modules"."body" IS NULL OR (jsonb_typeof("home_modules"."body") = 'object'
    AND coalesce("home_modules"."body"->>'type', '') = 'doc'
    AND coalesce(jsonb_typeof("home_modules"."body"->'content'), '') = 'array'
    AND octet_length("home_modules"."body"::text) <= 200000)),
	CONSTRAINT "home_modules_collection_only_where_shown" CHECK ("home_modules"."collection_id" IS NULL OR "home_modules"."kind" IN ('picks', 'gift_guide'))
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"neighborhood_id" uuid,
	"heading" text,
	"meta_description" text,
	"intro" jsonb,
	"body" jsonb,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_one_target" CHECK (num_nonnulls("pages"."category_id", "pages"."neighborhood_id") = 1),
	CONSTRAINT "pages_heading" CHECK ("pages"."heading" IS NULL OR ("pages"."heading" ~ '[^[:space:]]' AND char_length("pages"."heading") <= 120)),
	CONSTRAINT "pages_meta_description" CHECK ("pages"."meta_description" IS NULL OR ("pages"."meta_description" ~ '[^[:space:]]' AND char_length("pages"."meta_description") <= 200)),
	CONSTRAINT "pages_intro_is_rich_text" CHECK ("pages"."intro" IS NULL OR (jsonb_typeof("pages"."intro") = 'object'
    AND coalesce("pages"."intro"->>'type', '') = 'doc'
    AND coalesce(jsonb_typeof("pages"."intro"->'content'), '') = 'array'
    AND octet_length("pages"."intro"::text) <= 200000)),
	CONSTRAINT "pages_body_is_rich_text" CHECK ("pages"."body" IS NULL OR (jsonb_typeof("pages"."body") = 'object'
    AND coalesce("pages"."body"->>'type', '') = 'doc'
    AND coalesce(jsonb_typeof("pages"."body"->'content'), '') = 'array'
    AND octet_length("pages"."body"::text) <= 200000)),
	CONSTRAINT "pages_published_at_matches_status" CHECK (("pages"."status" = 'published') = ("pages"."published_at" IS NOT NULL)),
	CONSTRAINT "pages_dates_in_range" CHECK ("pages"."updated_at" >= '1000-01-01 00:00:00+00' AND "pages"."updated_at" < '10000-01-01 00:00:00+00'
        AND ("pages"."published_at" IS NULL OR ("pages"."published_at" >= '1000-01-01 00:00:00+00' AND "pages"."published_at" < '10000-01-01 00:00:00+00')))
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_modules" ADD CONSTRAINT "home_modules_collection_kind_fk" FOREIGN KEY ("collection_id","collection_kind") REFERENCES "public"."collections"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_once_per_subject" ON "legal_acceptances" USING btree ("subject_kind","subject_id","legal_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_doc_version_unique" ON "legal_documents" USING btree ("doc","version");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_position_unique" ON "collection_items" USING btree ("collection_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_experience_unique" ON "collection_items" USING btree ("collection_id","experience_id");--> statement-breakpoint
CREATE INDEX "collection_items_experience_id_idx" ON "collection_items" USING btree ("experience_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_one_gift_guide" ON "collections" USING btree ("kind") WHERE "collections"."kind" = 'gift_guide';--> statement-breakpoint
CREATE INDEX "home_modules_collection_id_idx" ON "home_modules" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_category_unique" ON "pages" USING btree ("category_id") WHERE "pages"."category_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_neighborhood_unique" ON "pages" USING btree ("neighborhood_id") WHERE "pages"."neighborhood_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_waiver_document_id_legal_documents_id_fk" FOREIGN KEY ("waiver_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;