CREATE TABLE "fake_gateway_state" (
	"key" text PRIMARY KEY DEFAULT 'fake' NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "fake_gateway_state_single_row" CHECK ("fake_gateway_state"."key" = 'fake'),
	CONSTRAINT "fake_gateway_state_document" CHECK (jsonb_typeof("fake_gateway_state"."state") = 'object'
        AND octet_length("fake_gateway_state"."state"::text) <= 8388608),
	CONSTRAINT "fake_gateway_state_updated_at_in_range" CHECK ("fake_gateway_state"."updated_at" >= '1000-01-01 00:00:00+00' AND "fake_gateway_state"."updated_at" < '10000-01-01 00:00:00+00')
);
