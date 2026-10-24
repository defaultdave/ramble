-- A slug that changes is written to slug_history, so no code path can rename without recording it.
--
-- Category and neighborhood slugs are unique while live. A retired one names one entity, and it is
-- removed when any category (or neighborhood) takes the slug, on insert or update, so a redirect
-- from a retired slug can never point at the address it came from.
--
-- Experience and host slugs repeat across entities because their addresses carry the ID. Each entity
-- keeps its own retired slugs, another entity taking the slug does not touch them, and a row is
-- removed only when the same entity takes its own old slug back.
CREATE FUNCTION retire_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	kind slug_entity_kind := TG_ARGV[0]::slug_entity_kind;
BEGIN
	IF kind IN ('category', 'neighborhood') THEN
		IF TG_OP = 'UPDATE' AND OLD.slug IS DISTINCT FROM NEW.slug THEN
			INSERT INTO slug_history (entity_kind, entity_id, slug)
			VALUES (kind, OLD.id, OLD.slug)
			ON CONFLICT (entity_kind, slug) WHERE entity_kind IN ('category', 'neighborhood')
			DO UPDATE SET entity_id = EXCLUDED.entity_id, retired_at = EXCLUDED.retired_at;
		END IF;
		DELETE FROM slug_history WHERE entity_kind = kind AND slug = NEW.slug;
	ELSIF TG_OP = 'UPDATE' AND OLD.slug IS DISTINCT FROM NEW.slug THEN
		INSERT INTO slug_history (entity_kind, entity_id, slug)
		VALUES (kind, OLD.id, OLD.slug)
		ON CONFLICT (entity_kind, entity_id, slug) DO UPDATE SET retired_at = EXCLUDED.retired_at;
		DELETE FROM slug_history WHERE entity_kind = kind AND entity_id = NEW.id AND slug = NEW.slug;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER categories_retire_slug AFTER INSERT OR UPDATE OF slug ON categories
	FOR EACH ROW EXECUTE FUNCTION retire_slug('category');--> statement-breakpoint
CREATE TRIGGER neighborhoods_retire_slug AFTER INSERT OR UPDATE OF slug ON neighborhoods
	FOR EACH ROW EXECUTE FUNCTION retire_slug('neighborhood');--> statement-breakpoint
CREATE TRIGGER experiences_retire_slug AFTER UPDATE OF slug ON experiences
	FOR EACH ROW EXECUTE FUNCTION retire_slug('experience');--> statement-breakpoint
CREATE TRIGGER hosts_retire_slug AFTER UPDATE OF slug ON hosts
	FOR EACH ROW EXECUTE FUNCTION retire_slug('host');--> statement-breakpoint
INSERT INTO cancellation_tiers (key, name, full_refund_hours_before, is_default) VALUES
	('flexible', 'Flexible', 24, true),
	('moderate', 'Moderate', 48, false),
	('strict', 'Strict', 168, false);
