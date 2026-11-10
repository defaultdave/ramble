CREATE TABLE "private_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"requested_date" date NOT NULL,
	"group_size" integer NOT NULL,
	"budget_minor" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "private_requests_group_size_in_range" CHECK ("private_requests"."group_size" BETWEEN 1 AND 200),
	CONSTRAINT "private_requests_budget_in_range" CHECK ("private_requests"."budget_minor" BETWEEN 100 AND 100000000),
	CONSTRAINT "private_requests_name_shape" CHECK ("private_requests"."name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("private_requests"."name") <= 120),
	CONSTRAINT "private_requests_email_shape" CHECK ("private_requests"."email" ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("private_requests"."email") <= 254),
	CONSTRAINT "private_requests_message_shape" CHECK ("private_requests"."message" IS NULL OR ("private_requests"."message" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("private_requests"."message") <= 2000)),
	CONSTRAINT "private_requests_created_at_in_range" CHECK ("private_requests"."created_at" >= '1000-01-01 00:00:00+00' AND "private_requests"."created_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "private_requests" ADD CONSTRAINT "private_requests_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_requests_experience_created_at_idx" ON "private_requests" USING btree ("experience_id","created_at" DESC NULLS LAST);