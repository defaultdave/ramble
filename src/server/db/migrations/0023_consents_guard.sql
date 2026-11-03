-- Custom SQL migration: what keeps consents append-only (PRD-74, ADR 0002). It lives apart from
-- 0010 so regenerating that schema migration never drops it.
--
-- A consent is a record of what a guest agreed to and when, so a change is a new row (a withdrawal
-- is a row with status withdrawn) and an existing row is never changed or removed. The table is
-- never emptied. The trigger fires for the table owner too, so it is the real guard.
CREATE FUNCTION guard_consents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Consents are append-only' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON consents
	FOR EACH ROW EXECUTE FUNCTION guard_consents();--> statement-breakpoint
CREATE TRIGGER consents_keep_table BEFORE TRUNCATE ON consents
	FOR EACH STATEMENT EXECUTE FUNCTION guard_consents();
