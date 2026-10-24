-- A slug that stops being live is recorded here, and a slug that is live again is no longer retired,
-- so a redirect from a retired slug can never point at the address it came from.
-- Experiences and hosts do not keep unique slugs (their addresses carry the ID), so the latest
-- retirement of a repeated slug wins.
CREATE FUNCTION retire_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND OLD.slug IS DISTINCT FROM NEW.slug THEN
		INSERT INTO slug_history (entity_kind, entity_id, slug)
		VALUES (TG_ARGV[0]::slug_entity_kind, OLD.id, OLD.slug)
		ON CONFLICT (entity_kind, slug)
		DO UPDATE SET entity_id = EXCLUDED.entity_id, retired_at = EXCLUDED.retired_at;
	END IF;
	DELETE FROM slug_history
	WHERE entity_kind = TG_ARGV[0]::slug_entity_kind AND slug = NEW.slug;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER categories_retire_slug AFTER INSERT OR UPDATE OF slug ON categories
	FOR EACH ROW EXECUTE FUNCTION retire_slug('category');--> statement-breakpoint
CREATE TRIGGER neighborhoods_retire_slug AFTER INSERT OR UPDATE OF slug ON neighborhoods
	FOR EACH ROW EXECUTE FUNCTION retire_slug('neighborhood');--> statement-breakpoint
CREATE TRIGGER experiences_retire_slug AFTER INSERT OR UPDATE OF slug ON experiences
	FOR EACH ROW EXECUTE FUNCTION retire_slug('experience');--> statement-breakpoint
CREATE TRIGGER hosts_retire_slug AFTER INSERT OR UPDATE OF slug ON hosts
	FOR EACH ROW EXECUTE FUNCTION retire_slug('host');--> statement-breakpoint
INSERT INTO cancellation_tiers (key, name, full_refund_hours_before, is_default) VALUES
	('flexible', 'Flexible', 24, true),
	('moderate', 'Moderate', 48, false),
	('strict', 'Strict', 168, false);
