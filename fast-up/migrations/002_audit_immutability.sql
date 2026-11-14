CREATE OR REPLACE FUNCTION fastup_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION fastup_audit_immutable();
INSERT INTO schema_migrations(version) VALUES(2);
