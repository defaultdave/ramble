-- Custom SQL migration: the rows and triggers drizzle-kit cannot generate. They live apart from
-- 0005 so regenerating that schema migration never drops them.
--
-- The one settings row, at the column defaults. The tax rate is the NYC combined sales tax rate,
-- pending Q-12.
INSERT INTO settings DEFAULT VALUES;--> statement-breakpoint
-- The settings row is never deleted or truncated: every settings read depends on it.
CREATE FUNCTION guard_settings_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'The settings row is never deleted' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER settings_keep_row BEFORE DELETE ON settings
	FOR EACH ROW EXECUTE FUNCTION guard_settings_row();--> statement-breakpoint
CREATE TRIGGER settings_keep_table BEFORE TRUNCATE ON settings
	FOR EACH STATEMENT EXECUTE FUNCTION guard_settings_row();--> statement-breakpoint
-- A legal version is written as a draft. Once published it is what a guest accepted, so it is final:
-- no edit, no delete, no change of key. A version publishes only above every version already
-- published for its document, under a lock per document.
CREATE FUNCTION guard_legal_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.status <> 'draft' THEN
			RAISE EXCEPTION 'A legal document version starts as a draft' USING ERRCODE = 'restrict_violation';
		END IF;
		RETURN NEW;
	END IF;
	IF OLD.status = 'published' THEN
		RAISE EXCEPTION 'A published legal document version is final' USING ERRCODE = 'restrict_violation';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	IF NEW.doc <> OLD.doc OR NEW.version <> OLD.version THEN
		RAISE EXCEPTION 'A legal document version keeps its document and number' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.status = 'published' THEN
		PERFORM pg_advisory_xact_lock(hashtext(NEW.doc));
		IF EXISTS (
			SELECT 1 FROM legal_documents
			WHERE doc = NEW.doc AND status = 'published' AND version > NEW.version
		) THEN
			RAISE EXCEPTION 'A newer version of this document is already published' USING ERRCODE = 'restrict_violation';
		END IF;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER legal_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON legal_documents
	FOR EACH ROW EXECUTE FUNCTION guard_legal_document();--> statement-breakpoint
-- An acceptance is a record: it names a published version when it is written and never changes after.
CREATE FUNCTION guard_legal_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NOT EXISTS (
			SELECT 1 FROM legal_documents WHERE id = NEW.legal_document_id AND status = 'published'
		) THEN
			RAISE EXCEPTION 'Only a published version can be accepted' USING ERRCODE = 'restrict_violation';
		END IF;
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'A legal acceptance is a record and never changes' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER legal_acceptances_guard_insert BEFORE INSERT ON legal_acceptances
	FOR EACH ROW EXECUTE FUNCTION guard_legal_acceptance();--> statement-breakpoint
CREATE TRIGGER legal_acceptances_guard_change BEFORE UPDATE OR DELETE ON legal_acceptances
	FOR EACH ROW EXECUTE FUNCTION guard_legal_acceptance();
