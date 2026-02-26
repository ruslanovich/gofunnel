# Execution Plan: PR-6.1 Share Route Skeleton + Token Validation

## Goal

- Реализовать только каркас `GET /share/<token>`:
  - обязательная аутентификация (redirect на `/login?next=...`)
  - валидация share token по `report_shares.token_hash`
  - минимальный read-only placeholder response без рендера отчета

## Non-goals

- Любая бизнес-логика report rendering/content loading.
- Любые изменения в storage/object-store интеграциях.
- Создание новых share токенов (admin/API) и аудит-аналитика beyond skeleton.

## Assumptions / research inputs

- Token hashing policy: `HMAC-SHA-256 + TOKEN_HASH_PEPPER` (ADR-0004).
- Session/redirect policy: existing `/app/*` guard + safe `next` semantics (ADR-0002).
- Context7 external check (Node.js official docs):
  - `crypto.createHmac(...).update(...).digest('hex')` usage for deterministic token hashing.
  - `node:http` route branching pattern is compatible with current transport style.

## Test-first scope

- Add integration tests first for:
  - unauthenticated `GET /share/<token>` -> `303` to `/login?next=%2Fshare%2F<token>`
  - authenticated + valid token -> `200` and placeholder content
  - revoked token -> `410`
  - invalid token -> `404`
  - expired token -> `404`

## Steps (PR-sized)

1. Tests for `/share/<token>` behavior
   - Extend in-memory harness with report-share repository fixture.
   - Add the five HTTP integration tests above.
2. App + infra share token validation
   - Add `app/shares/*` contracts/service with explicit outcomes: valid / revoked / not found-or-expired.
   - Add `infra/shares/postgres_report_share_repository.ts` lookup by `token_hash` only.
3. HTTP route skeleton
   - Add `GET /share/<token>` route in `interfaces/http/server.ts`.
   - Require session first; unauthenticated requests redirect to login preserving exact share URL in `next`.
   - Render minimal read-only placeholder (`Shared report placeholder`, resolved `report_ref`).
4. Docs updates
   - Update `SECURITY.md` (logged-in requirement, hash-only lookup, revoked/expired semantics).
   - Update progress notes in epic execution plan.

## Risks & mitigations

- Risk: accidental token leakage via logs/errors.
  - Mitigation: do not log plaintext token; use generic HTTP bodies for invalid token paths.
- Risk: status-code inconsistency for revoked/expired.
  - Mitigation: enforce single mapping in share service: revoked -> `410`, invalid/expired -> `404`.

## Test plan

- `./scripts/test.sh`
- `./scripts/typecheck.sh`

## Docs to update

- `SECURITY.md`
- `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md` (progress notes)
