# Execution Plan: Epic 1 Identity / Onboarding / Admin / Share (logged-in)

## Goal

- Реализовать Epic 1:
  - Public `/request-access`
  - Admin `/admin/*` (ручной онбординг и управление заявками/пользователями)
  - Private `/app/*` (только logged-in)
  - Share `/share/<token>` (только logged-in, read-only доступ по share token)
  - Invite-based onboarding без SMTP (одноразовый invite link + TTL)
  - Login/logout + session expiry + disable user invalidation
  - Anti-spam для `POST /api/access-requests`

## Non-goals

- SMTP/email delivery и автоматические письма
- OAuth/social login/SSO
- External captcha/Cloudflare/зарубежные anti-bot SaaS
- Полноценная report rendering business logic beyond share-route skeleton/validation
- Глобальный rate-limit framework для всех endpoints (только Epic 1 scope)

## Assumptions

- Стек для Epic 1: Next.js (App Router) + Postgres (из условий epic и research).
- До начала кодинга зафиксированы ADR:
  - `docs/05_decisions/2026-02-26_adr-0001_auth-library.md`
  - `docs/05_decisions/2026-02-26_adr-0002_session-strategy.md`
  - `docs/05_decisions/2026-02-26_adr-0003_rate-limit-storage.md`
  - `docs/05_decisions/2026-02-26_adr-0004_token-hashing.md`
- External research notes:
  - `docs/06_reference/2026-02-26_epic-1-identity-auth-research-notes.md`
- Local research result:
  - Репозиторий содержит только harness/docs/scripts, без существующего auth/db scaffolding; PR-1.1 включает bootstrap минимального runtime/DB scaffolding.

## Implementation notes fixed for Epic 1 (to avoid ambiguity)

- Honeypot behavior:
  - `silent drop` (возвращаем generic success-like response, заявку не сохраняем, пишем reason в logs/metrics).
- Time gate behavior (submit слишком быстро, порог стартово `3s`):
  - `silent drop` с тем же внешним ответом, что и обычный success.
- Rate limit exceeded (IP/email):
  - `429` с generic сообщением без лишних деталей.
- Anti-duplicate email < 24h:
  - не создаем новую запись; возвращаем generic success-like ответ (idempotent UX, без email enumeration signal).
- Share revoked:
  - вернуть `410 Gone` (если удобно технически; fallback `404` допускается только при явно зафиксированной причине в PR).

## Steps (PR-sized)

1. PR-0.1 ADRs + research notes (current planning PR)
   - Что меняем:
     - Добавляем MCP-based research notes.
     - Фиксируем ADR-0001..0004.
     - Создаем execution plan Epic 1.
     - Обновляем docs index/README и `SECURITY.md`/`RELIABILITY.md` (decision-level notes).
   - Как тестируем:
     - `python3 scripts/repo_lint.py`
     - `python3 scripts/docs_index_check.py`
     - `python3 scripts/architecture_lint.py`
   - Какие доки обновляем:
     - `docs/00_index/README.md`
     - `docs/03_execution_plans/README.md`
     - `docs/05_decisions/README.md`
     - `docs/06_reference/README.md`
     - `SECURITY.md`
     - `RELIABILITY.md`

2. PR-1.1 DB migrations + admin bootstrap
   - Что меняем:
     - Bootstrap минимальный Next.js + Postgres runtime/scaffolding (если отсутствует).
     - Добавляем migration framework/scripts и первую миграцию таблиц:
       - `users`, `sessions`, `access_requests`, `invites`, `report_shares`
     - Добавляем enum/check constraints, timestamps, базовые индексы.
     - Добавляем admin bootstrap mechanism (seed/script/env-based creation первого admin).
   - Как тестируем:
     - Прогон миграций на чистой БД.
     - Smoke test admin bootstrap.
     - `./scripts/test.sh` (или объяснение заглушки), `./scripts/lint.sh`, `./scripts/typecheck.sh`, `./scripts/build.sh`.
   - Какие доки обновляем:
     - `docs/02_architecture/boundaries.md` (если появляются папки/слои)
     - `SECURITY.md` (admin bootstrap secrets handling)
     - `RELIABILITY.md` (migration/recovery note)
     - plan progress section (append status)

3. PR-2.1 login/logout + guards
   - Что меняем:
     - `/login`, `POST /api/auth/login`, `POST /api/auth/logout`
     - Session cookie creation/validation/deletion (Postgres-backed)
     - Guards for `/app/*` and `/admin/*`
     - Redirect-after-login support for protected routes (including preserved `next` parameter)
     - Disabled user/session expiry invalidation behavior
   - Как тестируем:
     - Unit/integration tests: login success/failure, logout, expired session, disabled user.
     - E2E/manual checks:
       - без сессии `/app` -> `/login`
       - non-admin blocked from `/admin/*`
   - Какие доки обновляем:
     - `SECURITY.md` (cookie flags, CSRF, session TTL/invalidation)
     - `RELIABILITY.md` (auth logs/observability expectations)
     - relevant ADR consequences if implementation deviates

4. PR-3.1 request-access + endpoint
   - Что меняем:
     - Public page `/request-access` + form
     - `POST /api/access-requests` базовое сохранение заявки
     - `access_requests` statuses default + validation
   - Как тестируем:
     - Integration tests for valid request creation
     - Admin visibility smoke (temporary API/query or seeded check)
   - Какие доки обновляем:
     - `docs/01_product/` spec (if created in implementation step)
     - `SECURITY.md` (public endpoint handling basics)
     - plan progress notes

5. PR-3.2 антиспам (honeypot / rate limit / duplicate / time gate)
   - Что меняем:
     - Honeypot field validation + silent-drop behavior
     - Time gate check (`>= 3s`)
     - Postgres-backed IP/email rate limit state
     - Anti-duplicate email within 24h (generic success-like response)
     - Structured logging/metrics labels for anti-spam outcomes
   - Как тестируем:
     - Integration tests for honeypot/time gate/rate-limit/duplicate branches
     - Clock-controlled tests for 24h duplicate window
   - Какие доки обновляем:
     - `SECURITY.md` (anti-spam controls)
     - `RELIABILITY.md` (rate-limit storage cleanup/observability)
     - runbook if operational cleanup job is introduced

6. PR-4.1 admin access-requests UI/API
   - Что меняем:
     - `/admin/access-requests` list UI
     - Admin API/handlers for status transition (`new|contacted|approved|rejected`)
     - `handled_by` population and audit fields
   - Как тестируем:
     - AuthZ tests (admin-only)
     - Status transition tests
     - Manual UI smoke
   - Какие доки обновляем:
     - product spec / admin workflow notes
     - `SECURITY.md` (admin authz notes)
     - plan progress notes

7. PR-4.2 admin users UI/API
   - Что меняем:
     - `/admin/users` list UI
     - Enable/disable user actions
     - Ensure disabled user existing sessions become invalid on next validation
   - Как тестируем:
     - AuthZ tests (admin-only)
     - Disable/enable flow tests
     - Session invalidation tests after disable
   - Какие доки обновляем:
     - `SECURITY.md` (disable semantics)
     - `RELIABILITY.md` (admin action logging)
     - plan progress notes

8. PR-5.1 create invite
   - Что меняем:
     - Admin action/button "Create invite"
     - Invite generation (random token, hashed storage, TTL, created_by)
     - Response payload with `invite_link` for manual copy
   - Как тестируем:
     - Invite creation tests (hash stored, plaintext not stored)
     - TTL field and admin-only authz tests
   - Какие доки обновляем:
     - `SECURITY.md` (token hashing + invite TTL)
     - ADR-0004 consequences (if implementation detail refined)
     - plan progress notes

9. PR-5.2 accept invite
   - Что меняем:
     - `/invite/<token>` page and acceptance form
     - Password set flow + user creation/activation + login session issuance
     - One-time semantics (`used_at`) + TTL enforcement
   - Как тестируем:
     - Invite happy path
     - Reuse blocked (1-time only)
     - Expired invite blocked
     - User becomes logged in after successful invite acceptance
   - Какие доки обновляем:
     - `SECURITY.md` (password hashing, invite validation)
     - `RELIABILITY.md` (audit/logging for invite usage)
     - plan progress notes

10. PR-6.1 share route skeleton + token validation
   - Что меняем:
     - `/share/<token>` route skeleton
     - Share token lookup/validation (hashed token, revoked/expires checks)
     - Auth requirement: if not logged in -> `/login` -> return to exact `/share/<token>`
     - Read-only response/skeleton state (no edit actions)
   - Как тестируем:
     - Без сессии `/share/<token>` -> redirect to `/login`, then return to same share URL after login
     - Revoked share -> `410` (or documented fallback `404`)
     - Invalid/expired token path tests
   - Какие доки обновляем:
     - `SECURITY.md` (share token semantics)
     - `RELIABILITY.md` (share access logs)
     - product spec / plan progress notes

## Test plan

- For planning PR (PR-0.1):
  - Run docs/structure checks (`repo_lint`, `docs_index_check`, `architecture_lint`).
- For implementation PRs:
  - Each PR includes at least one automated test (unit/integration/e2e) for changed user flow, or explicit rationale if not needed.
  - Maintain a small acceptance test matrix covering Epic 1 mandatory criteria:
    - `/app` redirect without session
    - admin-only protection
    - invite one-time + TTL
    - access request visible in admin + anti-spam branches
    - `/share/<token>` login redirect + revoked behavior

## Risks & mitigations

- Risk:
  - Scope creep (framework bootstrap + auth + admin UI in one pass)
  - Mitigation:
    - Strict PR-sized steps above; no cross-step opportunistic features.
- Risk:
  - Security regressions in custom auth
  - Mitigation:
    - ADR-driven controls, explicit tests for expiry/disable/CSRF-sensitive endpoints, `SECURITY.md` updates per PR.
- Risk:
  - DB schema churn in early PRs
  - Mitigation:
    - Keep PR-1.1 limited to minimum tables/constraints needed by Epic 1 and evolve via incremental migrations.

## Docs to update

- `docs/00_index/README.md` (link new artifacts when added)
- `docs/03_execution_plans/README.md` (list current plan)
- `docs/05_decisions/README.md` (list ADRs)
- `docs/06_reference/README.md` (research notes)
- `SECURITY.md`
- `RELIABILITY.md`
- `docs/01_product/*` (если создается/уточняется product spec по Epic 1)

## Progress notes

- 2026-02-26: PR-1.1 started/implemented (DB migrations + admin bootstrap only)
  - Added first SQL migration + rollback for `users`, `sessions`, `access_requests`, `invites`, `report_shares`
  - Added minimal Postgres migration runner (`up/down/status`) and `bootstrap_admin` CLI (`Argon2id`, idempotent)
  - Added local runbook for migrations/bootstrap + smoke test commands
  - Explicitly deferred UI/API/auth endpoint implementation to later PRs per plan scope
- 2026-02-26: PR-1.2 hardening (DB only)
  - Hardened migration preflight for `gen_random_uuid()` / `pgcrypto` with explicit error hints
  - Switched `users` uniqueness enforcement to case-insensitive unique index on `lower(email)`
  - Standardized token hash pepper env name to `TOKEN_HASH_PEPPER`
- 2026-02-26: PR-2.1 implemented (login/logout + sessions + guards)
  - Added minimal HTTP transport/pages for `/login`, `/app`, `/admin` and auth endpoints `/api/auth/login`, `/api/auth/logout`
  - Implemented Postgres-backed session repository + auth service (login, logout, session validation, disabled user / expiry invalidation)
  - Added route guards for `/app/*` and `/admin/*` with safe `next` redirect preservation (relative-path only, no open redirect via `//`)
  - Added CSRF MVP enforcement for state-changing `/api/*` requests via `Origin` / fallback `Referer` validation and documented it in `SECURITY.md`
  - Added automated tests covering login success/failure, disabled-user block, logout, expired session rejection, admin guard, unauthenticated redirect
  - Note: implementation uses a minimal Node HTTP transport (`interfaces/http/*`) for PR-2.1; Next.js integration remains a future transport choice
- 2026-02-26: PR-3.1 implemented (public request-access + basic access request endpoint)
  - Added public `GET /request-access` page with form (required `email`, optional `name` / `company` / `note`) and client-side submit to `POST /api/access-requests`
  - Added `AccessRequestService` + Postgres repository to validate email format and persist `access_requests` rows with DB default status `new`
  - Added endpoint tests for successful creation (including normalized/trimmed persisted fields) and invalid-email rejection
- 2026-02-26: PR-5.1 implemented (admin create invite from access-requests UI)
  - Added `POST /api/admin/invites` (admin-only) with body `{ email, access_request_id? }`
  - Implemented invite generation with opaque random token, HMAC-SHA256 `token_hash` storage (`TOKEN_HASH_PEPPER`), `created_by_user_id`, and `expires_at = now + 7 days`
  - Added active-user guard (`409 user_exists`) and invite email validation (`400 invalid_email`)
  - Linked invite creation with optional access request approval (`status=approved`, `handled_by_user_id`, `handled_at`, idempotent when already approved)
  - Updated `/admin/access-requests` row UI with inline `Create invite` action and returned `invite_link` display + `Copy` button (no new pages)
  - Added server tests for admin success path, non-admin forbidden, TTL enforcement, and linked access-request approval semantics
- 2026-02-26: PR-4.2 implemented (admin users UI/API only; no invites)
  - Added admin users list page `GET /admin/users` with table columns `created_at`, `email`, `role`, `status`, `last_login_at` and inline enable/disable actions
  - Added admin users API: `GET /api/admin/users`, `PATCH /api/admin/users/:id` (`status=active|disabled`) with `400 invalid_status` / `404 not_found`
  - Persisted user status changes to `users.status`; `disabled_at` is set/cleared when the column exists
  - Added tests for admin/non-admin AuthZ, invalid status, unknown user, and disable-triggered session invalidation on next `/app` request
  - Explicitly deferred invites/share work to later PRs per plan scope
  - Documented public endpoint baseline controls in `SECURITY.md` and explicitly deferred anti-spam controls to PR-3.2
- 2026-02-26: PR-3.2 implemented (anti-spam only for `POST /api/access-requests`)
  - Added honeypot (`website`) silent-drop and client time gate (`client_ts`, `< 3s` => silent-drop) with uniform generic success response
  - Added Postgres-backed rate limiting for IP/email via hourly buckets + lazy cleanup of old buckets (every 100th request, retention 14 days)
  - Added 24h duplicate suppression for same normalized email (`new|contacted|approved`) with generic success (no new row)
  - Added structured anti-spam outcome logs with stable reason codes and kept `429` generic for rate-limit only
  - Added integration tests for honeypot, time gate, duplicate suppression, rate limit, invalid email 400 regression, and old-bucket-ignore behavior
- 2026-02-26: PR-4.1 implemented (admin access-requests list + status transitions only)
  - Added admin page `GET /admin/access-requests` with server-rendered table (`created_at`, `email`, `name`, `company`, `note`, `status`) and simple status filter via query param
  - Added admin API `GET /api/admin/access-requests` and `PATCH /api/admin/access-requests/:id` with admin-only authz and status validation (`400 invalid_status`, `404 not_found`)
  - Implemented status transition handling to populate `handled_by_user_id` + `handled_at` when status changes
  - Added HTTP integration tests for admin list/patch authz, successful transition, invalid status, and unknown id
  - Explicitly kept PR scope limited: no admin users page, no invites, no share functionality
- 2026-02-27: PR-5.2 implemented (accept invite only)
  - Added `GET /invite/<token>` page with minimal set-password form and client-side submit to accept API
  - Added `POST /api/auth/accept-invite` with JSON body `{ token, password }` and unified invalid-token response (`400 invalid_or_expired_token`)
  - Implemented invite acceptance in app/infra layers with password min-length validation (`>=12`), Argon2id hashing, user creation (`role=user`, `status=active`), and session issuance for auto-login
  - Added transactional one-time consume semantics for invites (`used_at IS NULL`, `revoked_at IS NULL`, `expires_at > now`) to prevent double-use under concurrent requests
  - Added tests for happy path, token reuse block, expired/invalid token rejection, existing-user `409`, and deterministic concurrent-attempt contract (exactly one success)
  - Explicitly kept PR scope limited: no request-access changes, no admin-users changes, no share/new admin features
- 2026-02-27: PR-6.1 implemented (share route skeleton + token validation only)
  - Added `GET /share/<token>` route skeleton with auth-required behavior: unauthenticated requests redirect to `/login?next=<exact_share_path>`
  - Implemented share lookup/validation in app+infra layers via `report_shares.token_hash` (HMAC-SHA256 with `TOKEN_HASH_PEPPER`), without plaintext token storage
  - Enforced status mapping: revoked token -> `410 Gone`; invalid or expired token -> `404 Not Found`
  - Added minimal read-only share placeholder response (`Shared report placeholder` + resolved `report_ref`) with no edit actions
  - Added integration tests for unauth redirect, authenticated valid token `200`, revoked `410`, invalid `404`, and expired `404`
