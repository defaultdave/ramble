ALTER TABLE "categories" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_length" CHECK (char_length("categories"."name") <= 80);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_length" CHECK (char_length("categories"."slug") <= 80);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_position_in_range" CHECK ("categories"."position" >= 0 AND "categories"."position" < 100);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_retired_at_in_range" CHECK ("categories"."retired_at" IS NULL OR ("categories"."retired_at" >= '1000-01-01 00:00:00+00' AND "categories"."retired_at" < '10000-01-01 00:00:00+00'));--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_link_out_url_length" CHECK (char_length("experiences"."link_out_url") <= 2000);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_affiliate_url_length" CHECK (char_length("experiences"."affiliate_url") <= 2000);--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_name_length" CHECK (char_length("neighborhoods"."name") <= 80);--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_slug_length" CHECK (char_length("neighborhoods"."slug") <= 80);--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_position_in_range" CHECK ("neighborhoods"."position" >= 0 AND "neighborhoods"."position" < 100);--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_retired_at_in_range" CHECK ("neighborhoods"."retired_at" IS NULL OR ("neighborhoods"."retired_at" >= '1000-01-01 00:00:00+00' AND "neighborhoods"."retired_at" < '10000-01-01 00:00:00+00'));