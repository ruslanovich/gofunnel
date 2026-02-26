# Execution Plan: PR-5.2 Accept Invite Only

## Goal

- Реализовать только accept-invite flow:
  - `GET /invite/<token>` (минимальная страница установки пароля)
  - `POST /api/auth/accept-invite` (create user + mark invite used + auto-login)

## Non-goals

- Любые изменения в request-access flow.
- Любые новые/дополнительные admin features (кроме уже существующего create-invite из PR-5.1).
- Share (`/share/<token>`) и связанные фичи.

## Assumptions

- Базовая auth/session инфраструктура из PR-2.1 и invite creation из PR-5.1 уже внедрены.
- Hash-only политика token storage и Argon2id policy зафиксированы в:
  - `docs/05_decisions/2026-02-26_adr-0004_token-hashing.md`
- Session strategy зафиксирована в:
  - `docs/05_decisions/2026-02-26_adr-0002_session-strategy.md`
- External research (Context7, перед кодом):
  - `node-postgres` transaction pattern (`BEGIN/COMMIT/ROLLBACK` через один `client`)
  - Argon2 reference подтверждает Argon2id как целевой variant для password hashing

## Test-first plan

- Add/extend HTTP integration tests first:
  - `GET /invite/<token>` renders set-password form with token.
  - Happy path: valid invite + valid password => user row created, invite marked used, session cookie set, `/app` доступен.
  - Reuse blocked: second acceptance with same token => `400 invalid_or_expired_token`.
  - Expired invite blocked => `400 invalid_or_expired_token`.
  - Invalid token blocked => `400 invalid_or_expired_token`.
  - User exists => `409 user_exists`.
  - Deterministic race/atomic contract test: two parallel accept attempts for same token => exactly one success.
- Negative cases checklist:
  - [ ] authz (`401/403`)
  - [x] validation (`400`)
  - [ ] not found (`404`)
  - [x] revoked/expired (`410`) -> for invite acceptance используется `400 invalid_or_expired_token` по требованиям PR-5.2
  - [ ] rate limit (`429`)

## Steps (PR-sized)

1. Accept-invite backend + page + tests
   - Scope:
     - Extend invite app/repository contracts for acceptance flow.
     - Add transactional invite consumption with one-time semantics and TTL checks.
     - Add password policy min-length validation and Argon2id hashing.
     - Add `/invite/<token>` page + `/api/auth/accept-invite` endpoint with session issuance.
   - Expected output:
     - Token accepted exactly once, user created with role/status defaults, session created, redirect to `/app`.
   - Checks:
     - `./scripts/test.sh`

## Test plan

- Automated:
  - `./scripts/test.sh`
- Manual smoke:
  - Open invite URL, submit password, verify redirect to `/app`.
  - Repeat same invite -> error path.

## Risks & mitigations

- Risk:
  - Invite race under concurrent submits could create inconsistent state.
  - Mitigation:
    - Single transactional path with conditional `UPDATE ... RETURNING` and rollback on user conflict.
- Risk:
  - Scope creep into admin/request-access/share.
  - Mitigation:
    - Restrict changes to invite acceptance surface and existing auth/session primitives only.

## Docs to update

- `SECURITY.md`
- `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md` (progress notes)
