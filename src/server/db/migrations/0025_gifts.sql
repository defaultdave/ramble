CREATE TYPE "public"."gift_status" AS ENUM('pending_payment', 'scheduled', 'delivered', 'redeemed');--> statement-breakpoint
CREATE TABLE "gift_items" (
	"gift_id" uuid NOT NULL,
	"price_option_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"tax_rate_ppm" integer NOT NULL,
	"uses_space" boolean NOT NULL,
	"line_total_minor" integer NOT NULL,
	CONSTRAINT "gift_items_gift_id_price_option_id_pk" PRIMARY KEY("gift_id","price_option_id"),
	CONSTRAINT "gift_items_label_text" CHECK ("gift_items"."label" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("gift_items"."label") <= 80),
	CONSTRAINT "gift_items_quantity_in_range" CHECK ("gift_items"."quantity" BETWEEN 1 AND 100),
	CONSTRAINT "gift_items_unit_price_in_range" CHECK ("gift_items"."unit_price_minor" BETWEEN 0 AND 10000000),
	CONSTRAINT "gift_items_tax_rate_in_range" CHECK ("gift_items"."tax_rate_ppm" BETWEEN 0 AND 1000000),
	CONSTRAINT "gift_items_line_total_is_quantity_times_price" CHECK ("gift_items"."line_total_minor" = "gift_items"."quantity" * "gift_items"."unit_price_minor")
);
--> statement-breakpoint
CREATE TABLE "gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"value_minor" integer NOT NULL,
	"buyer_guest_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"message" text,
	"send_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"token_hash" text NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"status" "gift_status" DEFAULT 'pending_payment' NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"redeemed_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"redeemed_at" timestamp with time zone,
	CONSTRAINT "gifts_value_in_range" CHECK ("gifts"."value_minor" BETWEEN 1 AND 2000000000),
	CONSTRAINT "gifts_recipient_name_text" CHECK ("gifts"."recipient_name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("gifts"."recipient_name") <= 120),
	CONSTRAINT "gifts_recipient_email_shape" CHECK ("gifts"."recipient_email" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("gifts"."recipient_email") <= 254),
	CONSTRAINT "gifts_message_text" CHECK ("gifts"."message" IS NULL OR ("gifts"."message" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("gifts"."message") <= 300)),
	CONSTRAINT "gifts_token_hash_shape" CHECK ("gifts"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gifts_token_version_positive" CHECK ("gifts"."token_version" >= 1),
	CONSTRAINT "gifts_created_at_in_range" CHECK ("gifts"."created_at" >= '1000-01-01 00:00:00+00' AND "gifts"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "gifts_send_at_within_horizon" CHECK ("gifts"."send_at" >= '1000-01-01 00:00:00+00' AND "gifts"."send_at" < '10000-01-01 00:00:00+00' AND "gifts"."send_at" <= "gifts"."created_at" + make_interval(days => 365)),
	CONSTRAINT "gifts_valid_until_after_send_at" CHECK ("gifts"."valid_until" >= '1000-01-01 00:00:00+00' AND "gifts"."valid_until" < '10000-01-01 00:00:00+00' AND "gifts"."valid_until" > "gifts"."send_at"),
	CONSTRAINT "gifts_sent_at_matches_status" CHECK (("gifts"."sent_at" IS NOT NULL) = ("gifts"."status" IN ('delivered', 'redeemed'))
        AND ("gifts"."sent_at" IS NULL OR "gifts"."sent_at" >= '1000-01-01 00:00:00+00' AND "gifts"."sent_at" < '10000-01-01 00:00:00+00')),
	CONSTRAINT "gifts_redeemed_matches_status" CHECK (("gifts"."redeemed_order_id" IS NOT NULL) = ("gifts"."status" = 'redeemed')
        AND ("gifts"."redeemed_at" IS NOT NULL) = ("gifts"."status" = 'redeemed')),
	CONSTRAINT "gifts_redeemed_at_in_range" CHECK ("gifts"."redeemed_at" IS NULL OR ("gifts"."redeemed_at" >= '1000-01-01 00:00:00+00' AND "gifts"."redeemed_at" < '10000-01-01 00:00:00+00' AND "gifts"."redeemed_at" >= "gifts"."sent_at"))
);
--> statement-breakpoint
ALTER TABLE "gift_items" ADD CONSTRAINT "gift_items_gift_id_gifts_id_fk" FOREIGN KEY ("gift_id") REFERENCES "public"."gifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_items" ADD CONSTRAINT "gift_items_price_option_id_price_options_id_fk" FOREIGN KEY ("price_option_id") REFERENCES "public"."price_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_purchase_order_id_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_buyer_guest_id_guests_id_fk" FOREIGN KEY ("buyer_guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_redeemed_order_id_orders_id_fk" FOREIGN KEY ("redeemed_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gifts_purchase_order_id_unique" ON "gifts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gifts_token_hash_unique" ON "gifts" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "gifts_buyer_guest_id_idx" ON "gifts" USING btree ("buyer_guest_id");--> statement-breakpoint
CREATE INDEX "gifts_experience_id_idx" ON "gifts" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "gifts_redeemed_order_id_idx" ON "gifts" USING btree ("redeemed_order_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gift_id_gifts_id_fk" FOREIGN KEY ("gift_id") REFERENCES "public"."gifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_gift_id_gifts_id_fk" FOREIGN KEY ("gift_id") REFERENCES "public"."gifts"("id") ON DELETE restrict ON UPDATE no action;