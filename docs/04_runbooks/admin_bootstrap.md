# Admin Bootstrap + DB Migrations (PR-1.1)

Runbook for the first local setup of Epic 1 auth tables and the initial admin user.

## Scope

- Applies SQL migrations for PR-1.1 (`users`, `sessions`, `access_requests`, `invites`, `report_shares`)
- Supports rollback of the latest migration(s)
- Bootstraps the first admin user with `Argon2id` password hash (password hash only, no plaintext password in DB)

## Prerequisites

- Local Postgres is running
- `DATABASE_URL` points to a writable database
- Node.js + npm installed

## Local commands (exact)

1. Install dependencies:

```bash
npm install
```

2. Apply migrations:

```bash
DATABASE_URL="postgres://user:password@localhost:5432/app_db" npm run db:migrate
```

3. Check migration status (optional):

```bash
DATABASE_URL="postgres://user:password@localhost:5432/app_db" npm run db:migrate:status
```

4. Bootstrap first admin (safe password input via stdin, avoids command history args):

```bash
printf '%s' 'ReplaceWithStrongPassword123!' | DATABASE_URL="postgres://user:password@localhost:5432/app_db" npm run bootstrap:admin -- --email admin@example.com --password-stdin
```

5. Verify admin row exists (smoke check):

```bash
psql "postgres://user:password@localhost:5432/app_db" -c "SELECT email, role, status, password_hash IS NOT NULL AS has_password_hash FROM users WHERE email = 'admin@example.com';"
```

## Rollback

Rollback the latest migration:

```bash
DATABASE_URL="postgres://user:password@localhost:5432/app_db" npm run db:rollback
```

Rollback multiple migrations (example: 2):

```bash
DATABASE_URL="postgres://user:password@localhost:5432/app_db" npm run db:rollback -- --steps=2
```

## Notes / safety

- `bootstrap_admin` is idempotent for an existing admin email: rerun returns `noop` and does not log secrets.
- If the email already exists as a non-admin user, bootstrap exits with an error (no automatic privilege escalation).
- `TOKEN_HASH_PEPPER` is required for invite/share/session token hashing in subsequent PRs (HMAC-SHA-256 strategy per ADR-0004), but is not used by `bootstrap_admin`.
- Migration `0001` first checks whether `gen_random_uuid()` is already available. If not, it attempts `CREATE EXTENSION pgcrypto`; on missing privileges or missing extension files it fails with an explicit error message and hint.
