CREATE TYPE "public"."role_grant_role" AS ENUM('host_owner', 'host_staff', 'ops', 'admin');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "auth_accounts_ids_length" CHECK (char_length("auth_accounts"."account_id") <= 256 AND char_length("auth_accounts"."provider_id") <= 64),
	CONSTRAINT "auth_accounts_credentials_unused" CHECK ("auth_accounts"."access_token" IS NULL AND "auth_accounts"."refresh_token" IS NULL AND "auth_accounts"."id_token" IS NULL AND "auth_accounts"."password" IS NULL AND "auth_accounts"."scope" IS NULL AND "auth_accounts"."access_token_expires_at" IS NULL AND "auth_accounts"."refresh_token_expires_at" IS NULL),
	CONSTRAINT "auth_accounts_created_at_in_range" CHECK ("auth_accounts"."created_at" >= '1000-01-01 00:00:00+00' AND "auth_accounts"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "auth_accounts_updated_at_in_range" CHECK ("auth_accounts"."updated_at" >= '1000-01-01 00:00:00+00' AND "auth_accounts"."updated_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "auth_sessions_token_length" CHECK (char_length("auth_sessions"."token") BETWEEN 16 AND 256),
	CONSTRAINT "auth_sessions_client_details_unused" CHECK ("auth_sessions"."ip_address" IS NULL AND "auth_sessions"."user_agent" IS NULL),
	CONSTRAINT "auth_sessions_expires_at_in_range" CHECK ("auth_sessions"."expires_at" >= '1000-01-01 00:00:00+00' AND "auth_sessions"."expires_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "auth_sessions_created_at_in_range" CHECK ("auth_sessions"."created_at" >= '1000-01-01 00:00:00+00' AND "auth_sessions"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "auth_sessions_updated_at_in_range" CHECK ("auth_sessions"."updated_at" >= '1000-01-01 00:00:00+00' AND "auth_sessions"."updated_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "auth_users_email_shape" CHECK ("auth_users"."email" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("auth_users"."email") <= 254),
	CONSTRAINT "auth_users_name_length" CHECK (char_length("auth_users"."name") <= 200),
	CONSTRAINT "auth_users_image_unused" CHECK ("auth_users"."image" IS NULL),
	CONSTRAINT "auth_users_created_at_in_range" CHECK ("auth_users"."created_at" >= '1000-01-01 00:00:00+00' AND "auth_users"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "auth_users_updated_at_in_range" CHECK ("auth_users"."updated_at" >= '1000-01-01 00:00:00+00' AND "auth_users"."updated_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "auth_verifications_identifier_shape" CHECK ("auth_verifications"."identifier" ~ '^magic-link:[0-9a-f]{64}$'),
	CONSTRAINT "auth_verifications_value_length" CHECK (char_length("auth_verifications"."value") <= 1024),
	CONSTRAINT "auth_verifications_expires_at_in_range" CHECK ("auth_verifications"."expires_at" >= '1000-01-01 00:00:00+00' AND "auth_verifications"."expires_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "auth_verifications_created_at_in_range" CHECK ("auth_verifications"."created_at" >= '1000-01-01 00:00:00+00' AND "auth_verifications"."created_at" < '10000-01-01 00:00:00+00'),
	CONSTRAINT "auth_verifications_updated_at_in_range" CHECK ("auth_verifications"."updated_at" >= '1000-01-01 00:00:00+00' AND "auth_verifications"."updated_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role_grant_role" NOT NULL,
	"host_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "role_grants_user_role_host_unique" UNIQUE NULLS NOT DISTINCT("user_id","role","host_id"),
	CONSTRAINT "role_grants_host_iff_host_role" CHECK (("role_grants"."role" IN ('host_owner', 'host_staff')) = ("role_grants"."host_id" IS NOT NULL)),
	CONSTRAINT "role_grants_created_at_in_range" CHECK ("role_grants"."created_at" >= '1000-01-01 00:00:00+00' AND "role_grants"."created_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_unique" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_unique" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_unique" ON "auth_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_verifications_expires_at_idx" ON "auth_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "role_grants_host_idx" ON "role_grants" USING btree ("host_id");