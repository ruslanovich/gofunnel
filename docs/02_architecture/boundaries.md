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
