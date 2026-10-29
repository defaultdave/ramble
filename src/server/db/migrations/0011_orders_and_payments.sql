CREATE TYPE "public"."order_cancelled_by" AS ENUM('guest', 'host', 'weather', 'ramble');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('booking', 'gift_purchase');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'confirmed', 'payment_failed', 'void', 'cancelled', 'refunded_after_lapse');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('created', 'requires_action', 'processing', 'failed_try', 'succeeded', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'apple_pay', 'google_pay');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('fake', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."provider_event_type" AS ENUM('payment.succeeded', 'payment.failed', 'payment.requires_action', 'payment.canceled', 'refund.succeeded', 'refund.failed', 'transfer.paid', 'transfer.failed', 'transfer.reversed', 'dispute.opened', 'dispute.won', 'dispute.lost');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('guest_cancel', 'host_cancel', 'weather', 'ramble_cancel', 'session_cancelled', 'lapse_after_payment', 'duplicate_payment', 'goodwill', 'gift_unredeemed', 'gift_buyer_request', 'gift_exchange_difference', 'ops_adjustment');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed', 'gift_reinstated');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('scheduled', 'releasing', 'paid', 'failed', 'reversed', 'skipped', 'simulated');--> statement-breakpoint
CREATE TABLE "order_items" (
	"order_id" uuid NOT NULL,
	"price_option_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"uses_space" boolean NOT NULL,
	"line_total_minor" integer NOT NULL,
	CONSTRAINT "order_items_order_id_price_option_id_pk" PRIMARY KEY("order_id","price_option_id"),
	CONSTRAINT "order_items_label_text" CHECK ("order_items"."label" ~ '[^[:space:]]' AND char_length("order_items"."label") <= 80),
	CONSTRAINT "order_items_quantity_in_range" CHECK ("order_items"."quantity" BETWEEN 1 AND 100),
	CONSTRAINT "order_items_unit_price_in_range" CHECK ("order_items"."unit_price_minor" BETWEEN 0 AND 10000000),
	CONSTRAINT "order_items_line_total_is_quantity_times_price" CHECK ("order_items"."line_total_minor" = "order_items"."quantity" * "order_items"."unit_price_minor")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"kind" "order_kind" NOT NULL,
	"status" "order_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"hold_id" uuid,
	"session_id" uuid,
	"experience_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"gift_id" uuid,
	"guest_id" uuid NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"lead_guest_name" text,
	"age_confirmed" boolean,
	"children_ages" integer[],
	"guardian_name" text,
	"guardian_contact" text,
	"waiver_document_id" uuid,
	"terms_document_id" uuid NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"ticket_subtotal_minor" integer NOT NULL,
	"tax_treatment" "tax_treatment" NOT NULL,
	"tax_rate_ppm" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"gift_applied_minor" integer DEFAULT 0 NOT NULL,
	"amount_due_minor" integer NOT NULL,
	"commission_rate_bps" integer NOT NULL,
	"commission_minor" integer NOT NULL,
	"refunded_ticket_minor" integer DEFAULT 0 NOT NULL,
	"refunded_tax_minor" integer DEFAULT 0 NOT NULL,
	"commission_returned_minor" integer DEFAULT 0 NOT NULL,
	"refund_failed" boolean DEFAULT false NOT NULL,
	"cancellation_tier_id" uuid NOT NULL,
	"free_cancel_until" timestamp with time zone,
	"cancelled_by" "order_cancelled_by",
	"attribution_source" text,
	"attribution_campaign" text,
	"attribution_issue" text,
	"manage_token_hash" text,
	"manage_token_version" integer DEFAULT 1 NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "orders_reference_shape" CHECK ("orders"."reference" ~ '^RMB-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "orders_kind_shape" CHECK (("orders"."kind" = 'booking'
        AND "orders"."hold_id" IS NOT NULL
        AND "orders"."session_id" IS NOT NULL
        AND "orders"."lead_guest_name" IS NOT NULL
        AND "orders"."idempotency_key" = 'book:' || "orders"."hold_id"::text)
        OR ("orders"."kind" = 'gift_purchase'
        AND "orders"."hold_id" IS NULL
        AND "orders"."session_id" IS NULL
        AND "orders"."gift_applied_minor" = 0
        AND "orders"."idempotency_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
	CONSTRAINT "orders_contact_email_shape" CHECK ("orders"."contact_email" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("orders"."contact_email") <= 254),
	CONSTRAINT "orders_contact_phone_text" CHECK ("orders"."contact_phone" IS NULL OR ("orders"."contact_phone" ~ '[^[:space:]]' AND char_length("orders"."contact_phone") <= 40)),
	CONSTRAINT "orders_lead_guest_name_text" CHECK ("orders"."lead_guest_name" IS NULL OR ("orders"."lead_guest_name" ~ '[^[:space:]]' AND char_length("orders"."lead_guest_name") <= 120)),
	CONSTRAINT "orders_children_ages_valid" CHECK ("orders"."children_ages" IS NULL OR (
        array_ndims("orders"."children_ages") = 1
        AND cardinality("orders"."children_ages") BETWEEN 1 AND 100
        AND "orders"."children_ages" <@ ARRAY[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]::integer[])),
	CONSTRAINT "orders_guardian_text" CHECK (("orders"."guardian_name" IS NULL OR ("orders"."guardian_name" ~ '[^[:space:]]' AND char_length("orders"."guardian_name") <= 120))
        AND ("orders"."guardian_contact" IS NULL OR ("orders"."guardian_contact" ~ '[^[:space:]]' AND char_length("orders"."guardian_contact") <= 254))),
	CONSTRAINT "orders_guardian_complete" CHECK (("orders"."guardian_name" IS NULL) = ("orders"."guardian_contact" IS NULL)
        AND ("orders"."children_ages" IS NULL OR "orders"."guardian_name" IS NOT NULL)),
	CONSTRAINT "orders_currency_usd" CHECK ("orders"."currency" = 'USD'),
	CONSTRAINT "orders_ticket_subtotal_in_range" CHECK ("orders"."ticket_subtotal_minor" BETWEEN 0 AND 1000000000),
	CONSTRAINT "orders_tax_rate_in_range" CHECK ("orders"."tax_rate_ppm" BETWEEN 0 AND 1000000),
	CONSTRAINT "orders_tax_rate_zero_unless_taxable" CHECK ("orders"."tax_treatment" = 'taxable' OR "orders"."tax_rate_ppm" = 0),
	CONSTRAINT "orders_tax_is_rounded_rate" CHECK ("orders"."tax_minor" = ("orders"."ticket_subtotal_minor"::bigint * "orders"."tax_rate_ppm"::bigint + 500000) / 1000000),
	CONSTRAINT "orders_total_is_subtotal_plus_tax" CHECK ("orders"."total_minor" = "orders"."ticket_subtotal_minor" + "orders"."tax_minor"),
	CONSTRAINT "orders_gift_applied_within_total" CHECK ("orders"."gift_applied_minor" BETWEEN 0 AND "orders"."total_minor"),
	CONSTRAINT "orders_gift_applied_names_gift" CHECK ("orders"."gift_applied_minor" = 0 OR "orders"."gift_id" IS NOT NULL),
	CONSTRAINT "orders_amount_due_is_total_less_gift" CHECK ("orders"."amount_due_minor" = "orders"."total_minor" - "orders"."gift_applied_minor"),
	CONSTRAINT "orders_commission_rate_in_range" CHECK ("orders"."commission_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "orders_commission_is_rounded_rate" CHECK ("orders"."commission_minor" = ("orders"."ticket_subtotal_minor"::bigint * "orders"."commission_rate_bps"::bigint * 100 + 500000) / 1000000),
	CONSTRAINT "orders_refunded_ticket_within_subtotal" CHECK ("orders"."refunded_ticket_minor" BETWEEN 0 AND "orders"."ticket_subtotal_minor"),
	CONSTRAINT "orders_refunded_tax_within_tax" CHECK ("orders"."refunded_tax_minor" BETWEEN 0 AND "orders"."tax_minor"),
	CONSTRAINT "orders_commission_returned_within_commission" CHECK ("orders"."commission_returned_minor" BETWEEN 0 AND "orders"."commission_minor"),
	CONSTRAINT "orders_money_in_range" CHECK ("orders"."tax_minor" BETWEEN 0 AND 2000000000
        AND "orders"."total_minor" <= 2000000000
        AND "orders"."commission_minor" <= 2000000000),
	CONSTRAINT "orders_attribution_text" CHECK (("orders"."attribution_source" IS NULL OR ("orders"."attribution_source" ~ '[^[:space:]]' AND char_length("orders"."attribution_source") <= 100))
        AND ("orders"."attribution_campaign" IS NULL OR ("orders"."attribution_campaign" ~ '[^[:space:]]' AND char_length("orders"."attribution_campaign") <= 100))
        AND ("orders"."attribution_issue" IS NULL OR ("orders"."attribution_issue" ~ '[^[:space:]]' AND char_length("orders"."attribution_issue") <= 100))),
	CONSTRAINT "orders_manage_token_hash_shape" CHECK ("orders"."manage_token_hash" IS NULL OR "orders"."manage_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orders_manage_token_version_positive" CHECK ("orders"."manage_token_version" >= 1),
	CONSTRAINT "orders_confirmed_at_matches_status" CHECK (("orders"."confirmed_at" IS NOT NULL) = ("orders"."status" IN ('confirmed', 'cancelled'))),
	CONSTRAINT "orders_cancelled_matches_status" CHECK (("orders"."cancelled_at" IS NOT NULL) = ("orders"."status" = 'cancelled')
        AND ("orders"."cancelled_by" IS NOT NULL) = ("orders"."status" = 'cancelled')),
	CONSTRAINT "orders_created_at_in_range" CHECK ("orders"."created_at" >= '1000-01-01 00:00:00+00' AND "orders"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "orders_confirmed_at_in_range" CHECK ("orders"."confirmed_at" IS NULL OR ("orders"."confirmed_at" >= '1000-01-01 00:00:00+00' AND "orders"."confirmed_at" < '10000-01-01 00:00:00+00' AND "orders"."confirmed_at" >= "orders"."created_at")),
	CONSTRAINT "orders_cancelled_at_in_range" CHECK ("orders"."cancelled_at" IS NULL OR ("orders"."cancelled_at" >= '1000-01-01 00:00:00+00' AND "orders"."cancelled_at" < '10000-01-01 00:00:00+00' AND "orders"."cancelled_at" >= "orders"."confirmed_at")),
	CONSTRAINT "orders_free_cancel_until_in_range" CHECK ("orders"."free_cancel_until" IS NULL OR "orders"."free_cancel_until" >= '1000-01-01 00:00:00+00' AND "orders"."free_cancel_until" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_key" text NOT NULL,
	"provider_payment_id" text,
	"amount_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"failed_tries" integer DEFAULT 0 NOT NULL,
	"method" "payment_method",
	"status" "attempt_status" DEFAULT 'created' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_attempts_order_attempt_no_unique" UNIQUE("order_id","attempt_no"),
	CONSTRAINT "payment_attempts_attempt_no_in_range" CHECK ("payment_attempts"."attempt_no" BETWEEN 1 AND 50),
	CONSTRAINT "payment_attempts_provider_key_from_order" CHECK ("payment_attempts"."provider_key" = 'pay:' || "payment_attempts"."order_id"::text || ':' || "payment_attempts"."attempt_no"::text),
	CONSTRAINT "payment_attempts_provider_payment_id_text" CHECK ("payment_attempts"."provider_payment_id" IS NULL OR ("payment_attempts"."provider_payment_id" ~ '[^[:space:]]' AND char_length("payment_attempts"."provider_payment_id") <= 255)),
	CONSTRAINT "payment_attempts_amount_in_range" CHECK ("payment_attempts"."amount_minor" BETWEEN 0 AND 2000000000),
	CONSTRAINT "payment_attempts_currency_usd" CHECK ("payment_attempts"."currency" = 'USD'),
	CONSTRAINT "payment_attempts_failed_tries_in_range" CHECK ("payment_attempts"."failed_tries" BETWEEN 0 AND 5),
	CONSTRAINT "payment_attempts_failed_try_counted" CHECK ("payment_attempts"."status" <> 'failed_try' OR "payment_attempts"."failed_tries" >= 1),
	CONSTRAINT "payment_attempts_failure_code_shape" CHECK ("payment_attempts"."failure_code" IS NULL OR ("payment_attempts"."failed_tries" >= 1
        AND char_length("payment_attempts"."failure_code") <= 64
        AND "payment_attempts"."failure_code" ~ '^[a-z0-9_]+$')),
	CONSTRAINT "payment_attempts_created_at_in_range" CHECK ("payment_attempts"."created_at" >= '1000-01-01 00:00:00+00' AND "payment_attempts"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "payment_attempts_updated_at_in_range" CHECK ("payment_attempts"."updated_at" >= '1000-01-01 00:00:00+00' AND "payment_attempts"."updated_at" < '10000-01-01 00:00:00+00' AND "payment_attempts"."updated_at" >= "payment_attempts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" "provider_event_type" NOT NULL,
	"object_id" text NOT NULL,
	"ramble_order_id" uuid,
	"ramble_record_id" uuid,
	"amount_minor" integer,
	"currency" char(3),
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"payload" jsonb NOT NULL,
	CONSTRAINT "provider_events_provider_event_id_unique" UNIQUE("provider","provider_event_id"),
	CONSTRAINT "provider_events_event_id_text" CHECK ("provider_events"."provider_event_id" ~ '[^[:space:]]' AND char_length("provider_events"."provider_event_id") <= 255),
	CONSTRAINT "provider_events_object_id_text" CHECK ("provider_events"."object_id" ~ '[^[:space:]]' AND char_length("provider_events"."object_id") <= 255),
	CONSTRAINT "provider_events_amount_in_range" CHECK ("provider_events"."amount_minor" IS NULL OR "provider_events"."amount_minor" BETWEEN 0 AND 2000000000),
	CONSTRAINT "provider_events_amount_and_currency_together" CHECK (("provider_events"."amount_minor" IS NULL) = ("provider_events"."currency" IS NULL)),
	CONSTRAINT "provider_events_currency_shape" CHECK ("provider_events"."currency" IS NULL OR "provider_events"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "provider_events_attempts_in_range" CHECK ("provider_events"."attempts" BETWEEN 0 AND 25),
	CONSTRAINT "provider_events_last_error_text" CHECK ("provider_events"."last_error" IS NULL OR ("provider_events"."last_error" ~ '[^[:space:]]' AND char_length("provider_events"."last_error") <= 500)),
	CONSTRAINT "provider_events_payload_object" CHECK (jsonb_typeof("provider_events"."payload") = 'object'
        AND octet_length("provider_events"."payload"::text) <= 32768),
	CONSTRAINT "provider_events_occurred_at_in_range" CHECK ("provider_events"."occurred_at" >= '1000-01-01 00:00:00+00' AND "provider_events"."occurred_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "provider_events_received_at_in_range" CHECK ("provider_events"."received_at" >= '1000-01-01 00:00:00+00' AND "provider_events"."received_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "provider_events_processed_at_in_range" CHECK ("provider_events"."processed_at" IS NULL OR ("provider_events"."processed_at" >= '1000-01-01 00:00:00+00' AND "provider_events"."processed_at" < '10000-01-01 00:00:00+00' AND "provider_events"."processed_at" >= "provider_events"."received_at"))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_attempt_id" uuid,
	"ticket_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"commission_returned_minor" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason" "refund_reason" NOT NULL,
	"initiated_by" uuid,
	"provider_key" text NOT NULL,
	"provider_refund_id" text,
	"status" "refund_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"succeeded_at" timestamp with time zone,
	CONSTRAINT "refunds_parts_in_range" CHECK ("refunds"."ticket_minor" BETWEEN 0 AND 2000000000
        AND "refunds"."tax_minor" BETWEEN 0 AND 2000000000
        AND "refunds"."commission_returned_minor" BETWEEN 0 AND "refunds"."ticket_minor"),
	CONSTRAINT "refunds_amount_is_ticket_plus_tax" CHECK ("refunds"."amount_minor" = "refunds"."ticket_minor" + "refunds"."tax_minor" AND "refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_provider_key_from_id" CHECK ("refunds"."provider_key" = 'refund:' || "refunds"."id"::text),
	CONSTRAINT "refunds_provider_refund_id_text" CHECK ("refunds"."provider_refund_id" IS NULL OR ("refunds"."provider_refund_id" ~ '[^[:space:]]' AND char_length("refunds"."provider_refund_id") <= 255)),
	CONSTRAINT "refunds_reinstated_gift_refunds_no_payment" CHECK ("refunds"."status" <> 'gift_reinstated' OR ("refunds"."payment_attempt_id" IS NULL AND "refunds"."provider_refund_id" IS NULL)),
	CONSTRAINT "refunds_succeeded_at_matches_status" CHECK (("refunds"."succeeded_at" IS NOT NULL) = ("refunds"."status" = 'succeeded')),
	CONSTRAINT "refunds_created_at_in_range" CHECK ("refunds"."created_at" >= '1000-01-01 00:00:00+00' AND "refunds"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "refunds_succeeded_at_in_range" CHECK ("refunds"."succeeded_at" IS NULL OR ("refunds"."succeeded_at" >= '1000-01-01 00:00:00+00' AND "refunds"."succeeded_at" < '10000-01-01 00:00:00+00' AND "refunds"."succeeded_at" >= "refunds"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"amount_minor" integer,
	"release_after" timestamp with time zone NOT NULL,
	"provider_key" text NOT NULL,
	"provider_transfer_id" text,
	"reversed_minor" integer DEFAULT 0 NOT NULL,
	"status" "transfer_status" DEFAULT 'scheduled' NOT NULL,
	CONSTRAINT "transfers_amount_in_range" CHECK ("transfers"."amount_minor" IS NULL OR "transfers"."amount_minor" BETWEEN 0 AND 2000000000),
	CONSTRAINT "transfers_amount_set_at_release" CHECK (("transfers"."status" = 'scheduled' AND "transfers"."amount_minor" IS NULL)
        OR ("transfers"."status" IN ('releasing', 'paid', 'failed', 'reversed', 'simulated') AND coalesce("transfers"."amount_minor" >= 1, false))
        OR "transfers"."status" = 'skipped'),
	CONSTRAINT "transfers_reversed_within_amount" CHECK ("transfers"."reversed_minor" BETWEEN 0 AND coalesce("transfers"."amount_minor", 0)),
	CONSTRAINT "transfers_provider_key_from_order" CHECK ("transfers"."provider_key" = 'transfer:' || "transfers"."order_id"::text),
	CONSTRAINT "transfers_provider_transfer_id_text" CHECK ("transfers"."provider_transfer_id" IS NULL OR ("transfers"."provider_transfer_id" ~ '[^[:space:]]' AND char_length("transfers"."provider_transfer_id") <= 255)),
	CONSTRAINT "transfers_release_after_in_range" CHECK ("transfers"."release_after" >= '1000-01-01 00:00:00+00' AND "transfers"."release_after" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_option_id_price_options_id_fk" FOREIGN KEY ("price_option_id") REFERENCES "public"."price_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancellation_tier_id_cancellation_tiers_id_fk" FOREIGN KEY ("cancellation_tier_id") REFERENCES "public"."cancellation_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_reference_unique" ON "orders" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_unique" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_live_per_hold" ON "orders" USING btree ("hold_id") WHERE "orders"."status" <> 'void';--> statement-breakpoint
CREATE UNIQUE INDEX "orders_manage_token_hash_unique" ON "orders" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE INDEX "orders_guest_id_idx" ON "orders" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "orders_session_id_idx" ON "orders" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "orders_host_id_idx" ON "orders" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_live_per_order" ON "payment_attempts" USING btree ("order_id") WHERE "payment_attempts"."status" NOT IN ('succeeded', 'canceled');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_key_unique" ON "payment_attempts" USING btree ("provider_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_payment_id_unique" ON "payment_attempts" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "provider_events_unprocessed_idx" ON "provider_events" USING btree ("received_at") WHERE "provider_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "refunds_order_id_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_key_unique" ON "refunds" USING btree ("provider_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund_id_unique" ON "refunds" USING btree ("provider_refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_order_id_unique" ON "transfers" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_provider_key_unique" ON "transfers" USING btree ("provider_key");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_provider_transfer_id_unique" ON "transfers" USING btree ("provider_transfer_id");--> statement-breakpoint
CREATE INDEX "transfers_host_id_idx" ON "transfers" USING btree ("host_id");