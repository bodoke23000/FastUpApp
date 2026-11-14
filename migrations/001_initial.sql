CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS records (
  kind text NOT NULL,
  id text NOT NULL,
  site_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind,id)
);
CREATE INDEX IF NOT EXISTS records_site_kind ON records(site_id,kind);
CREATE UNIQUE INDEX IF NOT EXISTS unique_asset_code ON records(site_id,lower(data->>'code')) WHERE kind='assets';
CREATE UNIQUE INDEX IF NOT EXISTS unique_part_code ON records(site_id,lower(data->>'code')) WHERE kind='parts';
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
  profile jsonb NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES accounts(id),
  csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS action_receipts (
  user_id text NOT NULL REFERENCES accounts(id), operation_id text NOT NULL,
  request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY, site_id text NOT NULL, actor_id text NOT NULL,
  operation text NOT NULL, subject_id text, occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_site_time ON audit_events(site_id,received_at);
CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY, site_id text NOT NULL, order_id text, asset_id text,
  name text NOT NULL, mime text NOT NULL, bytes bytea NOT NULL,
  author_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(order_id IS NOT NULL OR asset_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS integration_outbox (
  id text PRIMARY KEY, site_id text NOT NULL, event jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0, delivered_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text
);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
