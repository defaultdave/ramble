-- Custom SQL migration: what keeps the ledger append-only (PRD-74, ADR 0002). It lives apart from
-- 0014 so regenerating that schema migration never drops it.
--
-- A row is never changed or removed, and the table is never emptied. The trigger fires for the
-- table owner too, so it is the real guard; the role below is the pattern the audit log and the
-- reporting role follow once connections are split.
CREATE FUNCTION guard_ledger_entries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'The ledger is append-only' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
	FOR EACH ROW EXECUTE FUNCTION guard_ledger_entries();--> statement-breakpoint
CREATE TRIGGER ledger_entries_keep_table BEFORE TRUNCATE ON ledger_entries
	FOR EACH STATEMENT EXECUTE FUNCTION guard_ledger_entries();--> statement-breakpoint
-- Roles belong to the cluster, not the schema or the Neon branch, so the role may already exist
-- (a second schema, a second branch, two migrations at once).
DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_writer') THEN
		CREATE ROLE ledger_writer NOLOGIN;
	END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
	NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON ledger_entries FROM ledger_writer;--> statement-breakpoint
GRANT INSERT, SELECT ON ledger_entries TO ledger_writer;
