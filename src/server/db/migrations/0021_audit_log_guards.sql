-- Custom SQL migration: what keeps the audit log insert-only (PRD-74, ADR 0002). It lives apart
-- from 0020 so regenerating that schema migration never drops it.
--
-- A row is never changed or removed, and the table is never emptied. The trigger fires for the
-- table owner too, so it is the real guard. The role is what the app connects as once connections
-- are split: it can add rows and read them, and nothing else.
CREATE FUNCTION guard_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'The audit log is insert-only' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_insert_only BEFORE UPDATE OR DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION guard_audit_log();--> statement-breakpoint
CREATE TRIGGER audit_log_keep_table BEFORE TRUNCATE ON audit_log
	FOR EACH STATEMENT EXECUTE FUNCTION guard_audit_log();--> statement-breakpoint
-- Roles belong to the cluster, not the schema or the Neon branch, so the role may already exist
-- (a second schema, a second branch, two migrations at once).
DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN
		CREATE ROLE audit_writer NOLOGIN;
	END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
	NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON audit_log FROM audit_writer;--> statement-breakpoint
GRANT INSERT, SELECT ON audit_log TO audit_writer;
