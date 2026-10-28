CREATE TYPE "public"."photo_rights_basis" AS ENUM('host_agreement', 'ramble_owned', 'licensed');--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"storage_key" text NOT NULL,
	"url" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"decorative" boolean DEFAULT false NOT NULL,
	"alt_text" text,
	"blur_data_url" text NOT NULL,
	"rights_basis" "photo_rights_basis" NOT NULL,
	"rights_holder" text,
	"rights_license" text,
	"rights_source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_position_in_range" CHECK ("photos"."position" >= 0 AND "photos"."position" < 20),
	CONSTRAINT "photos_storage_key_from_ids" CHECK ("photos"."storage_key" = 'public/photos/' || "photos"."experience_id"::text || '/' || "photos"."id"::text || '.jpg'),
	CONSTRAINT "photos_url_http" CHECK ("photos"."url" ~ '^[Hh][Tt][Tt][Pp][Ss]?://((?![Xx][Nn]--)[A-Za-z0-9-]+\.)*(?![Xx][Nn]--)[A-Za-z][A-Za-z0-9-]*(:(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[0-9]{1,4}))?([/?#][!-~]*)?$' AND char_length("photos"."url") <= 2048),
	CONSTRAINT "photos_dimensions_in_range" CHECK ("photos"."width" BETWEEN 1 AND 2400 AND "photos"."height" BETWEEN 1 AND 2400),
	CONSTRAINT "photos_byte_size_in_range" CHECK ("photos"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "photos_alt_or_decorative" CHECK (("photos"."decorative" AND "photos"."alt_text" IS NULL) OR (
        NOT "photos"."decorative"
          AND "photos"."alt_text" IS NOT NULL
          AND char_length("photos"."alt_text") BETWEEN 1 AND 300
          AND "photos"."alt_text" ~ '[^[:space:]]'
      )),
	CONSTRAINT "photos_blur_data_url" CHECK ("photos"."blur_data_url" ~ '^data:image/jpeg.base64,[A-Za-z0-9+/]+={0,2}$' AND char_length("photos"."blur_data_url") <= 2048),
	CONSTRAINT "photos_rights_holder" CHECK ("photos"."rights_holder" IS NULL OR (char_length("photos"."rights_holder") BETWEEN 1 AND 200 AND "photos"."rights_holder" ~ '[^[:space:]]')),
	CONSTRAINT "photos_rights_license" CHECK ("photos"."rights_license" IS NULL OR (char_length("photos"."rights_license") BETWEEN 1 AND 200 AND "photos"."rights_license" ~ '[^[:space:]]')),
	CONSTRAINT "photos_rights_source_url" CHECK ("photos"."rights_source_url" IS NULL OR ("photos"."rights_source_url" ~ '^[Hh][Tt][Tt][Pp][Ss]?://((?![Xx][Nn]--)[A-Za-z0-9-]+\.)*(?![Xx][Nn]--)[A-Za-z][A-Za-z0-9-]*(:(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[0-9]{1,4}))?([/?#][!-~]*)?$' AND char_length("photos"."rights_source_url") <= 2048)),
	CONSTRAINT "photos_rights_licensed_complete" CHECK ("photos"."rights_basis" <> 'licensed' OR (
        "photos"."rights_holder" IS NOT NULL
          AND "photos"."rights_license" IS NOT NULL
          AND "photos"."rights_source_url" IS NOT NULL
      )),
	CONSTRAINT "photos_rights_unlicensed_bare" CHECK ("photos"."rights_basis" = 'licensed' OR ("photos"."rights_license" IS NULL AND "photos"."rights_source_url" IS NULL)),
	CONSTRAINT "photos_created_at_in_range" CHECK ("photos"."created_at" >= '1000-01-01 00:00:00+00' AND "photos"."created_at" < '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_experience_position_unique" ON "photos" USING btree ("experience_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_storage_key_unique" ON "photos" USING btree ("storage_key");