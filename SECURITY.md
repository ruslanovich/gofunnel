# SECURITY.md

## Базовые принципы безопасности

- Секреты не хранятся в репозитории.
- Доступы выдаются по принципу наименьших привилегий.
- Зависимости должны обновляться и проверяться регулярно.
- Любые решения по authn/authz фиксируются в ADR.

## Что будет добавлено позже (после выбора стека)

- Политика хранения секретов и `.env`-файлов
- Dependency scanning / SCA
- SAST / линтеры безопасности
- Процесс disclosure / triage уязвимостей

## Placeholder: области контроля

- `authn` / `authz`
- secrets management
- dependency hygiene
- audit logging

## Epic 1 (planned controls, decision-level)

- ADRs:
  - `docs/05_decisions/2026-02-26_adr-0001_auth-library.md`
  - `docs/05_decisions/2026-02-26_adr-0002_session-strategy.md`
  - `docs/05_decisions/2026-02-26_adr-0003_rate-limit-storage.md`
  - `docs/05_decisions/2026-02-26_adr-0004_token-hashing.md`
- Planned controls for implementation PRs:
  - Server-side sessions in Postgres with `httpOnly` cookies, TTL, and invalidation on logout / disabled user.
  - Password hashing with `Argon2id` (bcrypt fallback only if platform constraints).
  - Invite/share tokens stored as hash only (HMAC-SHA-256 + pepper), never plaintext in DB/logs.
  - CSRF considerations for state-changing POST endpoints (origin checks + cookie settings; explicit implementation details documented in auth PRs).
  - Access request anti-spam: honeypot, time gate, IP/email rate limits, anti-duplicate window.

## PR-1.1 implemented controls (schema + admin bootstrap)

- `bootstrap_admin` stores only `users.password_hash` (`Argon2id`) and never prints password/hash in logs.
- CLI supports password input via stdin to reduce shell history/process-list exposure.
- `invites`, `report_shares`, and `sessions` schema store hash columns only (`token_hash` / `session_token_hash`) with HMAC hash-version field (`hmac-sha256-v1`), no plaintext token columns.
- Token hash utility reads pepper from `TOKEN_HASH_PEPPER` env and does not log plaintext tokens.
- TTL fields are encoded in schema defaults:
  - `sessions.expires_at` default `now() + 14 days`
  - `invites.expires_at` default `now() + 7 days`
  - `report_shares.expires_at` nullable + `revoked_at`

## CSRF

MVP strategy for Epic 1 auth/admin POST endpoints (PR-2.1):

- Session cookie flags:
  - `HttpOnly`
  - `SameSite=Lax`
  - `Path=/`
  - `Secure` only in production (`NODE_ENV=production`)
- For state-changing API requests (`POST|PUT|PATCH|DELETE` under `/api/*`), server requires same-site header validation:
  - prefer `Origin` exact match to configured site origin (`APP_ORIGIN`)
  - if `Origin` is absent, allow only when `Referer` starts with the configured site origin
  - otherwise request is rejected (`403`)
- This covers current endpoints:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `POST /api/access-requests`
- Requirement extends to future admin state-changing endpoints in subsequent PRs.

## PR-2.1 implemented controls (login/logout + sessions + guards)

- Login creates server-side session row in Postgres (`sessions`) with opaque cookie token (plaintext only in cookie, hash in DB).
- Logout deletes current session row by `session_token_hash` and clears cookie.
- Session validation treats session as invalid when:
  - `sessions.expires_at <= now`
  - `sessions.invalidated_at IS NOT NULL`
  - joined `users.status = 'disabled'`
- Successful session validation updates `sessions.last_seen_at`.
- Route guards enforce:
  - `/app/*` => authenticated session required
  - `/admin/*` => authenticated session + `role=admin`
- Redirect target preservation uses `next` parameter with open-redirect prevention:
  - only relative paths starting with `/`
  - values starting with `//` (absolute-host form) are rejected

## PR-3.1 implemented controls (public access request page + endpoint)

- Added public page `GET /request-access` with form fields:
  - required `email`
  - optional `name`, `company`, `note`
- Added `POST /api/access-requests` basic handling (no anti-spam in PR-3.1):
  - server-side email format validation before DB write
  - persistence to `access_requests` with DB default status `new`
  - generic success response message on accepted requests (no account/email enumeration semantics)
- Endpoint remains under the existing CSRF same-origin checks for state-changing `/api/*` requests (`Origin` / `Referer` validation).
- Explicitly deferred to PR-3.2:
  - honeypot
  - time gate
  - IP/email rate limiting
  - duplicate-window suppression

## PR-3.2 implemented controls (access request anti-spam)

- `POST /api/access-requests` now applies anti-spam controls before persistence:
  - honeypot field `website` -> silent drop with the same generic success payload
  - time gate via `client_ts` with minimum delay `>= 3s` -> silent drop with the same generic success payload
  - Postgres-backed rate limit (hourly buckets) for IP and email -> `429` with generic message (no detailed reason in response)
  - duplicate suppression for the same normalized email within 24h when existing status is `new|contacted|approved` -> generic success, no new row
- No email enumeration:
  - success payload is uniform for created requests, honeypot/time-gate drops, and duplicate suppression
  - only explicit rate-limit rejections use `429`, still with a generic message
- IP handling for access-request anti-spam:
  - IP source is `X-Forwarded-For` first value, fallback `socket.remoteAddress`
  - raw IP is not persisted in access-request anti-spam storage
  - rate-limit storage keeps only HMAC-SHA-256 hashes (`TOKEN_HASH_PEPPER`) for rate-limit keys, including IP-derived keys
- Structured anti-spam outcome logs are emitted with stable reason codes (`honeypot`, `time_gate`, `duplicate_24h`, `rate_limited_ip`, `rate_limited_email`) without logging raw IP values.

## PR-4.1 implemented controls (admin access requests UI/API)

- Admin-only authorization is enforced for both UI and API surfaces:
  - `/admin/*` requires authenticated session with `role=admin` (non-admin => `403 admin_only`, unauthenticated => login redirect)
  - `/api/admin/*` requires authenticated session with `role=admin` (non-admin => `403 admin_only`, unauthenticated => `401 auth_required`)
- Added admin access request endpoints:
  - `GET /api/admin/access-requests?status=<optional>`
  - `PATCH /api/admin/access-requests/:id` with status transitions limited to `new|contacted|approved|rejected`
- Server-side validation for admin access request mutations:
  - invalid status values are rejected with `400` (`invalid_status`)
  - unknown access request ids are rejected with `404` (`not_found`)
- Status transition audit field semantics:
  - when status changes, server persists `handled_by_user_id` as current admin user id
  - when status changes, server persists `handled_at` timestamp server-side (no client-provided timestamp)

## PR-4.2 implemented controls (admin users enable/disable)

- Admin-only authorization applies to admin user management surfaces:
  - `GET /api/admin/users`
  - `PATCH /api/admin/users/:id`
  - `GET /admin/users`
- Server-side validation for admin user status mutations:
  - only `active|disabled` statuses are accepted
  - invalid status values return `400` (`invalid_status`)
  - unknown user ids return `404` (`not_found`)
- Disable/enable persistence semantics:
  - user status is persisted in `users.status`
  - `users.disabled_at` is set/cleared when the column exists in the target schema
- Session invalidation semantics for disabled users:
  - existing session cookies are not trusted blindly; each validation joins the current `users` row
  - if `users.status = 'disabled'`, the user is treated as unauthenticated on the next request (e.g. `/app/*` redirects to login)

## PR-5.1 implemented controls (admin create invite)

- Added admin-only invite creation endpoint:
  - `POST /api/admin/invites` with body `{ email, access_request_id? }`
  - unauthenticated requests to `/api/admin/*` remain `401 auth_required`
  - non-admin requests to `/api/admin/*` remain `403 admin_only`
- Email handling and validation:
  - server normalizes invite email (`trim` + lowercase) before checks/write
  - invalid email input is rejected with `400` (`invalid_email`)
  - if normalized email belongs to an existing `active` user, request is rejected with `409` (`user_exists`)
- Token handling and storage:
  - invite token is generated as cryptographically strong opaque random value (`crypto.randomBytes(32)`)
  - token is returned only once in API response as part of `invite_link`
  - DB stores only `invites.token_hash` (HMAC-SHA256 via `TOKEN_HASH_PEPPER`) and never stores plaintext token
  - plaintext invite token is not logged by service/repository code paths
- Invite TTL and audit fields:
  - `expires_at` is set to `created_at + 7 days`
  - `created_by_user_id` is set from current admin session
  - invite rows are created with one-time semantics fields untouched (`used_at` remains `NULL` until future accept flow)
- Access request linkage behavior:
  - when `access_request_id` is provided, the target request is moved to `approved`
  - `handled_by_user_id` / `handled_at` are set if status changes or if handled fields were missing
  - if the request is already approved with handled fields present, operation remains idempotent

## PR-5.2 implemented controls (accept invite)

- Added invite acceptance surfaces:
  - `GET /invite/<token>` renders minimal "Set password" form
  - `POST /api/auth/accept-invite` accepts JSON body `{ token, password }`
- Logged-in behavior on invite page:
  - current MVP allows opening and submitting a valid invite even if user already has an active session
  - successful invite acceptance issues a new session cookie and replaces the previous session cookie in browser context
- Password policy and hashing:
  - minimum password length for invite acceptance is `12` characters
  - server hashes accepted password with `Argon2id` before persistence to `users.password_hash`
  - plaintext password is never stored
- Token handling:
  - invite lookup uses `token_hash` only (`HMAC-SHA256` with `TOKEN_HASH_PEPPER`), never plaintext token storage
  - plaintext invite token is not logged by accept-invite flow code paths
- One-time semantics and race safety:
  - acceptance uses transactional logic in Postgres
  - invite is atomically claimed via conditional update (`used_at IS NULL`, `revoked_at IS NULL`, `expires_at > now`) and proceeds only when row is returned
  - if invite is invalid/expired/reused/revoked, endpoint returns `400` with `invalid_or_expired_token` (without revealing exact reason)
  - duplicate acceptance under concurrent requests is blocked (only first successful claim can continue)
- User creation/session issuance on success:
  - new `users` row is created with invite email, `role='user'`, `status='active'`
  - invite is marked as used (`used_at`) and linked to created user (`used_by_user_id`)
  - server creates auth session and sets `httpOnly` session cookie; client redirects to `/app`
- Existing-user collision handling:
  - if user already exists for invite email during acceptance, endpoint returns `409` with `user_exists`
  - transaction rollback ensures invite is not consumed in this conflict branch
- CSRF:
  - `POST /api/auth/accept-invite` is covered by the same state-changing `/api/*` Origin/Referer validation policy defined above.

## PR-6.1 implemented controls (share route skeleton + token validation)

- Added protected share surface:
  - `GET /share/<token>` requires authenticated session
  - unauthenticated request is redirected to `/login?next=/share/<token>` via existing safe `next` policy
- Share token handling:
  - lookup is performed by `report_shares.token_hash` only (`HMAC-SHA256` with `TOKEN_HASH_PEPPER`)
  - plaintext share token is never persisted and is not logged by share-validation code paths
- Share validity semantics:
  - `revoked_at IS NOT NULL` => `410 Gone`
  - missing token match => `404 Not Found`
  - expired token (`expires_at <= now`) => `404 Not Found`
  - optional TTL remains supported (`expires_at IS NULL` means no expiry)
- Current route output is intentionally read-only placeholder:
  - page shows only `Shared report placeholder` and resolved `report_ref`
  - no edit actions are exposed

## Epic 2 PR-1.1 implemented controls (files schema only)

- Added `files` metadata table in Postgres with strict checks:
  - `extension` is limited to `txt|vtt`
  - `status` is limited to `uploaded|queued|processing|succeeded|failed`
  - `size_bytes` must be positive (`> 0`)
- Ownership boundary is encoded at schema level:
  - `files.user_id` references `users(id)` and supports owner-scoped query paths with dedicated indexes
  - list path index: `(user_id, created_at DESC, id DESC)`
  - owner lookup index: `(user_id, id)`
- Storage boundary remains explicit:
  - Postgres stores metadata only (`storage_bucket`, `storage_key_original`, file attributes/status/error fields)
  - file content bytes are not stored in Postgres and are intended to stay in S3-compatible object storage.

## Epic 2 PR-2.1 implemented controls (S3 adapter + env contract)

- Added server-side S3 adapter using AWS SDK v3 `S3Client` for Yandex Object Storage compatibility.
- Runtime now fails fast when any required S3 env variable is missing:
  - `S3_ENDPOINT`
  - `S3_REGION`
  - `S3_BUCKET`
  - `S3_ACCESS_KEY_ID`
  - `S3_SECRET_ACCESS_KEY`
- S3 credentials remain server-side only:
  - credentials are loaded from server environment during adapter construction
  - no browser/client exposure path is introduced in PR-2.1 (no presigned URL flow yet)
  - no credentials are persisted to Postgres or repository files.

## Epic 2 PR-3.1 implemented controls (upload endpoint only)

- Added authenticated upload API endpoint:
  - `POST /api/files/upload` requires a valid session (`401 auth_required` otherwise)
  - `user_id` binding is server-side only, taken from session context and never from request body
- Input validation and file-type controls:
  - accepted transport is `multipart/form-data` with field name `file`
  - only `.txt` and `.vtt` extensions are accepted (server derives extension from filename, not from client MIME)
  - upload size is capped by server constant `FILE_UPLOAD_MAX_BYTES = 10MB` (oversize => `413 file_too_large`)
- Storage and metadata boundaries:
  - object key is deterministic and owner-scoped: `users/<userId>/files/<fileId>/original.<ext>`
  - Postgres `files` row stores metadata (`storage_bucket`, `storage_key_original`, filename/ext/mime/size/status/error fields)
  - raw file bytes are sent to S3-compatible storage; plaintext credentials are never returned to clients
- Logging policy for upload failures:
  - structured orphan log event is emitted only when compensation delete fails:
    - `event=orphan_s3_object`
    - fields: `userId`, `fileId`, `key`
  - no S3 secrets or credential values are logged by upload path code.

## Epic 2 PR-3.2 implemented controls (files list endpoint only)

- Added authenticated list API endpoint:
  - `GET /api/files` requires a valid session (`401 auth_required` otherwise)
  - owner binding is server-side only via current session user id
- Owner isolation for list reads:
  - list query is always scoped by `files.user_id = <session.user.id>`
  - rows of other users are never included in list response
- Cursor pagination boundary:
  - keyset ordering is fixed: `created_at DESC, id DESC`
  - cursor is treated as opaque API token and validated server-side
  - invalid cursor token returns `400` with `invalid_cursor`
- Response minimization:
  - list returns only MVP metadata fields (`id`, `original_filename`, `extension`, `size_bytes`, `status`, `created_at`, `updated_at`)
  - storage internals (`storage_bucket`, `storage_key_original`) are intentionally excluded from list payload
  - no S3 credentials/secrets are exposed by list endpoint.

## Epic 2 PR-3.3 implemented controls (file details endpoint only)

- Added authenticated file-details API endpoint:
  - `GET /api/files/:id` requires a valid session (`401 auth_required` otherwise)
  - `:id` must be canonical UUID, otherwise endpoint returns `400` with `invalid_id`
- Owner-only access with existence masking:
  - lookup is always owner-scoped by `(files.id, files.user_id=<session.user.id>)`
  - missing file and non-owned file are both returned as `404 Not Found` (no existence disclosure across users)
- Response minimization and error hygiene:
  - endpoint returns only MVP metadata fields:
    - `id`, `original_filename`, `extension`, `size_bytes`, `status`, `created_at`, `updated_at`, `error_code`, `error_message`
  - storage internals (`storage_bucket`, `storage_key_original`) remain excluded from response
  - `error_message` in response is sanitized (whitespace-collapsed + bounded length); for non-`failed` statuses, `error_code/error_message` are `null`
  - no S3 credentials/secrets are exposed by details endpoint.

## Epic 3 PR-1.1 implemented controls (queue schema + report metadata)

- Added internal-only table `processing_jobs` for scheduling/worker coordination:
  - table is not exposed through public HTTP APIs or UI payloads
  - it stores lock/attempt/error metadata required for reliable worker operation, not user-facing status
- Ownership boundary for report access remains unchanged:
  - report retrieval contract stays owner-scoped (`/api/files/:id/report` in a later Epic 3 PR)
  - non-owner report access must stay masked as `404` (no existence disclosure)
- Added report metadata columns in `files` without moving artifact bytes into Postgres:
  - only storage keys/versions/timestamps/attempt counters are persisted
  - report body and raw LLM output remain in S3 object storage under owner-scoped keys

## Epic 3 PR-3.1 implemented controls (LLM adapter + schema validation only)

- Added server-side LLM adapter boundary with explicit secret handling:
  - provider credentials are loaded only from env (`LLM_API_KEY`) and never hardcoded
  - provider/model selection is env-driven (`LLM_PROVIDER`, `LLM_MODEL`) with secure defaults for non-test runtime
  - production boot guardrails reject `LLM_PROVIDER=fake` and reject missing `LLM_API_KEY`
- Raw LLM output sensitivity policy for this stage:
  - adapter returns `rawText` for internal processing only
  - API keys, full transcript text, and full raw LLM output are forbidden in runtime logs
  - full raw output must not be written to application logs
  - diagnostic surfaces should use sanitized summaries/error codes instead of full payload dumps
- Added strict schema-validation gate before report acceptance:
  - validator emits bounded, sanitized error metadata for logs

## Epic 3 PR-3.2 implemented controls (worker pipeline integration)

- Processing artifacts stay storage-scoped and owner-partitioned:
  - original transcript key: `users/<userId>/files/<fileId>/original.<ext>`
  - report artifact key: `users/<userId>/files/<fileId>/report.json`
  - raw invalid-model-output key: `users/<userId>/files/<fileId>/raw_llm_output.json`
- Raw LLM output handling:
  - on schema validation failure, worker persists raw output artifact for diagnostics and finalizes job/file as failed with `schema_validation_failed`
  - raw payload is stored in S3 only; it is not copied into Postgres large text fields
  - runtime logs remain sanitized and bounded; full raw payload is not emitted to logs
- Report success boundary:
  - `files.status='succeeded'` is finalized only after `report.json` write and metadata update (`storage_key_report`, `prompt_version`, `schema_version`)
  - this prevents exposing successful status when report artifact is missing
- Orphan risk control after partial failure:
  - if report write succeeds but DB metadata update fails, worker executes best-effort report delete
  - on cleanup failure, structured `orphan_report_object` event is emitted for operational cleanup

## Epic 3 PR-3.3 implemented controls (owner-only report endpoint)

- Added authenticated report retrieval endpoint:
  - `GET /api/files/:id/report` requires valid session (`401 auth_required` otherwise)
  - `:id` must be canonical UUID, otherwise endpoint returns `400 invalid_id`
- Owner-only access with existence masking:
  - owner-scoped lookup is enforced by `(files.id, files.user_id=<session.user.id>)`
  - missing and non-owned files both return `404 Not Found` (no cross-tenant existence disclosure)
- Report readiness boundary:
  - for owner-owned file, if `files.status != 'succeeded'` or `storage_key_report` is absent, endpoint returns `409 { "error": "report_not_ready" }`
  - this prevents exposing partial/unfinished processing artifacts as completed report content
- Sensitive content handling:
  - endpoint returns report payload as JSON (`application/json`) without embedding report content into logs
  - on fetch failure from storage, response is sanitized to `500 { "error": "report_fetch_failed" }`
  - structured error log includes `fileId` and sanitized error metadata only (no report body)
