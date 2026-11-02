CREATE TYPE "public"."audit_actor_kind" AS ENUM('user', 'guest', 'system');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_log_actor_matches_kind" CHECK (("audit_log"."actor_kind" = 'user') = ("audit_log"."actor_id" IS NOT NULL)),
	CONSTRAINT "audit_log_action_shape" CHECK ("audit_log"."action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("audit_log"."action") <= 64),
	CONSTRAINT "audit_log_subject_kind_shape" CHECK ("audit_log"."subject_kind" ~ '^[a-z][a-z0-9_]*$' AND char_length("audit_log"."subject_kind") <= 40),
	CONSTRAINT "audit_log_details_shape" CHECK (jsonb_typeof("audit_log"."details") = 'object' AND octet_length("audit_log"."details"::text) <= 4096 AND jsonb_array_length(jsonb_path_query_array("audit_log"."details", 'strict $.*')) <= 16 AND NOT jsonb_path_exists("audit_log"."details", 'strict $.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,39}$"))') AND NOT jsonb_path_exists("audit_log"."details", 'strict $.* ? (@.type() == "array" || @.type() == "object")') AND NOT jsonb_path_exists("audit_log"."details", 'strict $.* ? (@.type() == "number" && (@ != @.floor() || @ > 9007199254740991 || @ < -9007199254740991))') AND NOT jsonb_path_exists("audit_log"."details", 'strict $.* ? (@.type() == "string" && !(@ like_regex "^[A-Za-z0-9][A-Za-z0-9:_./-]{0,99}$"))')),
	CONSTRAINT "audit_log_recorded_at_in_range" CHECK ("audit_log"."recorded_at" >= '1000-01-01 00:00:00+00' AND "audit_log"."recorded_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE INDEX "audit_log_recorded_at_idx" ON "audit_log" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_kind","subject_id");