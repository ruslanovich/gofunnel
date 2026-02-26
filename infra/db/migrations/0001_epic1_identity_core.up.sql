DO $$
BEGIN
  IF to_regprocedure('gen_random_uuid()') IS NOT NULL THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION USING
        MESSAGE = 'gen_random_uuid() is unavailable and CREATE EXTENSION pgcrypto failed due to insufficient privilege',
        HINT = 'Pre-install pgcrypto (or use a DB/user with permission) before running infra/db/migrations/0001_epic1_identity_core.up.sql.';
    WHEN undefined_file THEN
      RAISE EXCEPTION USING
        MESSAGE = 'gen_random_uuid() is unavailable and pgcrypto extension files are not installed on the Postgres server',
        HINT = 'Install PostgreSQL contrib/pgcrypto packages or upgrade to a version exposing core gen_random_uuid().';
  END;

  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'gen_random_uuid() is unavailable after pgcrypto installation attempt',
      HINT = 'Verify pgcrypto installation and extension availability in the target database.';
  END IF;
END
$$;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  display_name TEXT,
  disabled_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_lowercase_chk CHECK (email = lower(email)),
  CONSTRAINT users_email_shape_chk CHECK (position('@' IN email) > 1),
  CONSTRAINT users_role_chk CHECK (role IN ('user', 'admin')),
  CONSTRAINT users_status_chk CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_disabled_state_chk CHECK (
    (status = 'disabled' AND disabled_at IS NOT NULL)
    OR (status = 'active' AND disabled_at IS NULL)
  )
);

CREATE UNIQUE INDEX users_email_lower_uidx ON users (lower(email));
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_role_idx ON users (role);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  hash_version TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  last_seen_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  CONSTRAINT sessions_token_hash_len_chk CHECK (char_length(session_token_hash) = 64),
  CONSTRAINT sessions_hash_version_chk CHECK (hash_version <> ''),
  CONSTRAINT sessions_expiry_after_create_chk CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX sessions_token_hash_uidx ON sessions (session_token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX sessions_active_lookup_idx ON sessions (user_id, expires_at)
WHERE invalidated_at IS NULL;

CREATE TABLE access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  full_name TEXT,
  company TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  handled_by_user_id UUID REFERENCES users (id) ON DELETE RESTRICT,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT access_requests_email_lowercase_chk CHECK (email = lower(email)),
  CONSTRAINT access_requests_email_shape_chk CHECK (position('@' IN email) > 1),
  CONSTRAINT access_requests_status_chk CHECK (
    status IN ('new', 'contacted', 'approved', 'rejected')
  ),
  CONSTRAINT access_requests_handled_pair_chk CHECK (
    (handled_at IS NULL AND handled_by_user_id IS NULL)
    OR (handled_at IS NOT NULL AND handled_by_user_id IS NOT NULL)
  )
);

CREATE INDEX access_requests_email_created_idx
  ON access_requests (email, created_at DESC);
CREATE INDEX access_requests_status_created_idx
  ON access_requests (status, created_at DESC);

CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  hash_version TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
  created_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  used_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT invites_email_lowercase_chk CHECK (email = lower(email)),
  CONSTRAINT invites_email_shape_chk CHECK (position('@' IN email) > 1),
  CONSTRAINT invites_token_hash_len_chk CHECK (char_length(token_hash) = 64),
  CONSTRAINT invites_hash_version_chk CHECK (hash_version <> ''),
  CONSTRAINT invites_expiry_after_create_chk CHECK (expires_at > created_at),
  CONSTRAINT invites_used_after_create_chk CHECK (used_at IS NULL OR used_at >= created_at),
  CONSTRAINT invites_revoked_after_create_chk CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE UNIQUE INDEX invites_token_hash_uidx ON invites (token_hash);
CREATE INDEX invites_email_idx ON invites (email);
CREATE INDEX invites_expires_at_idx ON invites (expires_at);
CREATE INDEX invites_active_window_idx ON invites (expires_at, created_at DESC)
WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE report_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_ref TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  hash_version TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
  created_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  CONSTRAINT report_shares_report_ref_not_blank_chk CHECK (btrim(report_ref) <> ''),
  CONSTRAINT report_shares_token_hash_len_chk CHECK (char_length(token_hash) = 64),
  CONSTRAINT report_shares_hash_version_chk CHECK (hash_version <> ''),
  CONSTRAINT report_shares_expiry_after_create_chk CHECK (
    expires_at IS NULL OR expires_at > created_at
  ),
  CONSTRAINT report_shares_revoked_after_create_chk CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE UNIQUE INDEX report_shares_token_hash_uidx ON report_shares (token_hash);
CREATE INDEX report_shares_report_ref_idx ON report_shares (report_ref);
CREATE INDEX report_shares_expires_at_idx ON report_shares (expires_at);
CREATE INDEX report_shares_active_window_idx ON report_shares (created_at DESC)
WHERE revoked_at IS NULL;
