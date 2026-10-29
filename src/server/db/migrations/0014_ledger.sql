CREATE TYPE "public"."ledger_account" AS ENUM('platform_cash', 'host_payable', 'ramble_commission', 'processing_fees', 'gift_liability', 'refunds_pending', 'dispute_hold', 'dispute_losses', 'ramble_payouts');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('charge_host_share', 'charge_commission', 'charge_tax', 'processing_fee', 'transfer_to_host', 'transfer_reversal', 'refund_host_share', 'commission_returned', 'refund_tax', 'refund_cash_out', 'refund_reversal', 'gift_liability_in', 'gift_to_host_share', 'gift_to_commission', 'gift_to_tax', 'gift_refund', 'gift_reinstated', 'ramble_payout', 'dispute_withdrawal', 'dispute_fee', 'dispute_reinstated', 'dispute_to_host', 'dispute_loss');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"debit_account" "ledger_account" NOT NULL,
	"credit_account" "ledger_account" NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"order_id" uuid,
	"gift_id" uuid,
	"host_id" uuid,
	"payment_attempt_id" uuid,
	"refund_id" uuid,
	"transfer_id" uuid,
	"dispute_id" uuid,
	"provider_object_id" text,
	"simulated" boolean NOT NULL,
	"created_by" uuid,
	"memo" text,
	CONSTRAINT "ledger_entries_accounts_differ" CHECK ("ledger_entries"."debit_account" <> "ledger_entries"."credit_account"),
	CONSTRAINT "ledger_entries_entry_type_accounts" CHECK (("ledger_entries"."entry_type", "ledger_entries"."debit_account", "ledger_entries"."credit_account") IN (('charge_host_share', 'platform_cash', 'host_payable'), ('charge_commission', 'platform_cash', 'ramble_commission'), ('charge_tax', 'platform_cash', 'host_payable'), ('processing_fee', 'processing_fees', 'platform_cash'), ('transfer_to_host', 'host_payable', 'platform_cash'), ('transfer_reversal', 'platform_cash', 'host_payable'), ('refund_host_share', 'host_payable', 'refunds_pending'), ('commission_returned', 'ramble_commission', 'refunds_pending'), ('refund_tax', 'host_payable', 'refunds_pending'), ('refund_cash_out', 'refunds_pending', 'platform_cash'), ('refund_reversal', 'refunds_pending', 'host_payable'), ('refund_reversal', 'refunds_pending', 'ramble_commission'), ('gift_liability_in', 'platform_cash', 'gift_liability'), ('gift_to_host_share', 'gift_liability', 'host_payable'), ('gift_to_commission', 'gift_liability', 'ramble_commission'), ('gift_to_tax', 'gift_liability', 'host_payable'), ('gift_refund', 'gift_liability', 'refunds_pending'), ('gift_reinstated', 'host_payable', 'gift_liability'), ('gift_reinstated', 'ramble_commission', 'gift_liability'), ('ramble_payout', 'ramble_payouts', 'platform_cash'), ('dispute_withdrawal', 'dispute_hold', 'platform_cash'), ('dispute_fee', 'processing_fees', 'platform_cash'), ('dispute_reinstated', 'platform_cash', 'dispute_hold'), ('dispute_to_host', 'host_payable', 'dispute_hold'), ('dispute_loss', 'dispute_losses', 'dispute_hold'))),
	CONSTRAINT "ledger_entries_amount_in_range" CHECK ("ledger_entries"."amount_minor" BETWEEN 1 AND 2000000000),
	CONSTRAINT "ledger_entries_currency_usd" CHECK ("ledger_entries"."currency" = 'USD'),
	CONSTRAINT "ledger_entries_names_a_subject" CHECK (num_nonnulls("ledger_entries"."order_id", "ledger_entries"."gift_id", "ledger_entries"."host_id") >= 1 OR "ledger_entries"."entry_type" = 'ramble_payout'),
	CONSTRAINT "ledger_entries_provider_id_on_cash" CHECK (("ledger_entries"."provider_object_id" IS NOT NULL) = ("ledger_entries"."debit_account" = 'platform_cash' OR "ledger_entries"."credit_account" = 'platform_cash')),
	CONSTRAINT "ledger_entries_provider_id_text" CHECK ("ledger_entries"."provider_object_id" IS NULL OR ("ledger_entries"."provider_object_id" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("ledger_entries"."provider_object_id") <= 255)),
	CONSTRAINT "ledger_entries_memo_text" CHECK ("ledger_entries"."memo" IS NULL OR ("ledger_entries"."memo" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("ledger_entries"."memo") <= 500)),
	CONSTRAINT "ledger_entries_occurred_at_in_range" CHECK ("ledger_entries"."occurred_at" >= '1000-01-01 00:00:00+00' AND "ledger_entries"."occurred_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "ledger_entries_recorded_at_in_range" CHECK ("ledger_entries"."recorded_at" >= '1000-01-01 00:00:00+00' AND "ledger_entries"."recorded_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_cash_event_unique" ON "ledger_entries" USING btree ("entry_type","provider_object_id") WHERE "ledger_entries"."provider_object_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_entries_host_occurred_idx" ON "ledger_entries" USING btree ("host_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries" USING btree ("order_id");