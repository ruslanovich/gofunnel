# Architecture Boundaries

## Purpose

Этот файл фиксирует границы модулей/слоев, которые позже будут проверяться автоматикой.

## Planned Layers

- `interfaces` / transport layer
- `app` / orchestration layer
- `domain` / business logic layer
- `infra` / external integrations

## Dependency Rules (initial)

- `interfaces` -> `app`
- `app` -> `domain`
- `infra` implements contracts for `app`/`domain`
- `domain` must not import from `infra` or `interfaces`

## TODO (after stack selection)

- Add actual module/package paths
- Add import/dependency enforcement tooling
- Add exceptions list (if any) with justification

## Current concrete paths (PR-1.1)

- `interfaces/cli/*` — CLI entry points (`db_migrate`, `bootstrap_admin`)
- `interfaces/http/*` — minimal HTTP transport for auth pages/API/guards (PR-2.1)
- `app/auth/*` — auth orchestration (login/logout/session validation/redirect policy)
- `domain/auth/*` — auth domain types
- `infra/db/*` — Postgres client + migration runner + SQL migrations
- `infra/auth/*` — Postgres-backed auth repository
- `infra/security/*` — password hashing (`Argon2id`) and token HMAC helpers
