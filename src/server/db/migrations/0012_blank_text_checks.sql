ALTER TABLE "categories" DROP CONSTRAINT "categories_name_not_blank";--> statement-breakpoint
ALTER TABLE "experiences" DROP CONSTRAINT "experiences_name_not_blank";--> statement-breakpoint
ALTER TABLE "hosts" DROP CONSTRAINT "hosts_name_not_blank";--> statement-breakpoint
ALTER TABLE "hosts" DROP CONSTRAINT "hosts_time_zone_not_blank";--> statement-breakpoint
ALTER TABLE "neighborhoods" DROP CONSTRAINT "neighborhoods_name_not_blank";--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_alt_or_decorative";--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_rights_holder";--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_rights_license";--> statement-breakpoint
ALTER TABLE "cancellation_tiers" DROP CONSTRAINT "cancellation_tiers_key_not_blank";--> statement-breakpoint
ALTER TABLE "cancellation_tiers" DROP CONSTRAINT "cancellation_tiers_name_not_blank";--> statement-breakpoint
ALTER TABLE "legal_documents" DROP CONSTRAINT "legal_documents_title";--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_banner_text";--> statement-breakpoint
ALTER TABLE "collection_items" DROP CONSTRAINT "collection_items_note";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_title";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_summary";--> statement-breakpoint
ALTER TABLE "help_articles" DROP CONSTRAINT "help_articles_title";--> statement-breakpoint
ALTER TABLE "help_articles" DROP CONSTRAINT "help_articles_summary";--> statement-breakpoint
ALTER TABLE "home_modules" DROP CONSTRAINT "home_modules_heading";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_heading";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_meta_description";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_label_text";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_contact_phone_text";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_lead_guest_name_text";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_guardian_text";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_attribution_text";--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_payment_id_text";--> statement-breakpoint
ALTER TABLE "provider_events" DROP CONSTRAINT "provider_events_event_id_text";--> statement-breakpoint
ALTER TABLE "provider_events" DROP CONSTRAINT "provider_events_object_id_text";--> statement-breakpoint
ALTER TABLE "provider_events" DROP CONSTRAINT "provider_events_last_error_text";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_provider_refund_id_text";--> statement-breakpoint
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_provider_transfer_id_text";--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_not_blank" CHECK ("categories"."name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_name_not_blank" CHECK ("experiences"."name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_name_not_blank" CHECK ("hosts"."name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_time_zone_not_blank" CHECK ("hosts"."time_zone" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_name_not_blank" CHECK ("neighborhoods"."name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_alt_or_decorative" CHECK (("photos"."decorative" AND "photos"."alt_text" IS NULL) OR (
        NOT "photos"."decorative"
          AND "photos"."alt_text" IS NOT NULL
          AND char_length("photos"."alt_text") BETWEEN 1 AND 300
          AND "photos"."alt_text" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
      ));--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_rights_holder" CHECK ("photos"."rights_holder" IS NULL OR (char_length("photos"."rights_holder") BETWEEN 1 AND 200 AND "photos"."rights_holder" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'));--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_rights_license" CHECK ("photos"."rights_license" IS NULL OR (char_length("photos"."rights_license") BETWEEN 1 AND 200 AND "photos"."rights_license" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'));--> statement-breakpoint
ALTER TABLE "cancellation_tiers" ADD CONSTRAINT "cancellation_tiers_key_not_blank" CHECK ("cancellation_tiers"."key" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "cancellation_tiers" ADD CONSTRAINT "cancellation_tiers_name_not_blank" CHECK ("cancellation_tiers"."name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_title" CHECK ("legal_documents"."title" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("legal_documents"."title") <= 120);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_banner_text" CHECK ("settings"."banner_text" IS NULL OR ("settings"."banner_text" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("settings"."banner_text") <= 280));--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_note" CHECK ("collection_items"."note" IS NULL OR ("collection_items"."note" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("collection_items"."note") <= 280));--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_title" CHECK ("collections"."title" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("collections"."title") <= 120);--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_summary" CHECK ("collections"."summary" IS NULL OR ("collections"."summary" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("collections"."summary") <= 300));--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_title" CHECK ("help_articles"."title" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("help_articles"."title") <= 120);--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_summary" CHECK ("help_articles"."summary" IS NULL OR ("help_articles"."summary" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("help_articles"."summary") <= 300));--> statement-breakpoint
ALTER TABLE "home_modules" ADD CONSTRAINT "home_modules_heading" CHECK ("home_modules"."heading" IS NULL OR ("home_modules"."heading" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("home_modules"."heading") <= 120));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_heading" CHECK ("pages"."heading" IS NULL OR ("pages"."heading" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("pages"."heading") <= 120));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_meta_description" CHECK ("pages"."meta_description" IS NULL OR ("pages"."meta_description" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("pages"."meta_description") <= 200));--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_label_text" CHECK ("order_items"."label" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("order_items"."label") <= 80);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_phone_text" CHECK ("orders"."contact_phone" IS NULL OR ("orders"."contact_phone" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("orders"."contact_phone") <= 40));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lead_guest_name_text" CHECK ("orders"."lead_guest_name" IS NULL OR ("orders"."lead_guest_name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("orders"."lead_guest_name") <= 120));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_guardian_text" CHECK (("orders"."guardian_name" IS NULL OR ("orders"."guardian_name" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("orders"."guardian_name") <= 120))
        AND ("orders"."guardian_contact" IS NULL OR ("orders"."guardian_contact" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("orders"."guardian_contact") <= 254)));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_attribution_text" CHECK (("orders"."attribution_source" IS NULL OR ("orders"."attribution_source" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("orders"."attribution_source") <= 100))
        AND ("orders"."attribution_campaign" IS NULL OR ("orders"."attribution_campaign" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("orders"."attribution_campaign") <= 100))
        AND ("orders"."attribution_issue" IS NULL OR ("orders"."attribution_issue" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("orders"."attribution_issue") <= 100)));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_payment_id_text" CHECK ("payment_attempts"."provider_payment_id" IS NULL OR ("payment_attempts"."provider_payment_id" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("payment_attempts"."provider_payment_id") <= 255));--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_event_id_text" CHECK ("provider_events"."provider_event_id" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("provider_events"."provider_event_id") <= 255);--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_object_id_text" CHECK ("provider_events"."object_id" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("provider_events"."object_id") <= 255);--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_last_error_text" CHECK ("provider_events"."last_error" IS NULL OR ("provider_events"."last_error" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("provider_events"."last_error") <= 500));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_refund_id_text" CHECK ("refunds"."provider_refund_id" IS NULL OR ("refunds"."provider_refund_id" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("refunds"."provider_refund_id") <= 255));--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_provider_transfer_id_text" CHECK ("transfers"."provider_transfer_id" IS NULL OR ("transfers"."provider_transfer_id" ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND char_length("transfers"."provider_transfer_id") <= 255));