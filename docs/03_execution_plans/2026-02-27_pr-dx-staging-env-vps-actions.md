# Execution Plan: DX Staging env + VPS deploy/smoke via GitHub Actions

## Goal

- Развести локальный и staging-профили окружения так, чтобы:
  - локально можно стабильно работать с короткими транскриптами через `.env.local`;
  - полноразмерные прогоны выполнялись на VPS (Yandex Cloud Kazakhstan) через GitHub Actions и `env.staging`.

## Non-goals

- Изменение продуктовой логики обработки отчетов/очереди/LLM.
- Изменение retry/backoff политики воркера.
- Перенос приложения в Docker/Kubernetes.

## Assumptions / research inputs

- Local research:
  - `dotenv/config` уже используется в runtime (`infra/db/client.ts`, `interfaces/http/config.ts`), значит выбор env-файла можно централизованно переключать через `DOTENV_CONFIG_PATH`.
  - Текущий CI содержит только общий `ci.yml`; отдельного workflow для deploy/smoke на VPS нет.
  - В проекте уже есть runbook-подход для ops-процедур (`docs/04_runbooks/*`), поэтому staging deploy/smoke стоит оформить отдельным runbook.
- External research (Context7):
  - GitHub Actions (`/websites/github_en_actions`): `workflow_dispatch` + `jobs.<job>.environment` + environment-scoped secrets — стандартный паттерн для deploy job.
  - Dotenv (`/motdotla/dotenv`): `DOTENV_CONFIG_PATH` официально поддерживается в preload-режиме и подходит для запуска с нестандартным env-файлом.
- Decision:
  - ADR не требуется: архитектурные границы/слои не меняются, меняется только DX/ops wiring.

## Test-first plan

- Поведение продукта не меняется; функциональные API-тесты не добавляются.
- Проверки для PR:
  - `npm run typecheck`
  - `python3 scripts/docs_index_check.py`
  - `python3 scripts/architecture_lint.py`
  - `python3 scripts/repo_lint.py`

## Steps (PR-sized)

1. Add env profile artifacts + scripts
   - Scope:
     - Добавить `env.staging.example`.
     - Добавить npm scripts для явного запуска с `.env.local` и `env.staging` (`http`, `worker`, `db:migrate`, `db:migrate:status`).
   - Expected output:
     - Локальный запуск и staging запуск стандартизированы через скрипты.
   - Checks:
     - локальный smoke запуска команд без выполнения долгих операций.

2. Add staging VPS workflow
   - Scope:
     - Добавить workflow manual trigger для деплоя на VPS по SSH.
     - Использовать `environment: staging` и environment secrets.
     - На VPS: синхронизация кода, запись `env.staging`, `npm ci`, миграции, опциональный restart/smoke command.
   - Expected output:
     - Реплицируемый deploy/smoke pipeline для Yandex Cloud KZ staging host.
   - Checks:
     - валидация YAML + dry run логики команд.

3. Add runbook + doc index updates
   - Scope:
     - Новый runbook по настройке secrets и запуску staging workflow.
     - Обновить индексы документации execution plans/runbooks.
   - Expected output:
     - Операционная процедура задокументирована и discoverable.
   - Checks:
     - `python3 scripts/docs_index_check.py`.

## Risks & mitigations

- Risk: секреты staging окружения утекут в логи workflow.
  - Mitigation: хранить `env.staging` как GitHub Environment Secret, не печатать содержимое, отключить shell tracing.
- Risk: разные процессы управления на VPS (systemd/pm2/manual) потребуют разной restart-команды.
  - Mitigation: сделать restart/smoke команды параметризуемыми (input workflow + optional env secret).
- Risk: drift между локальным и staging env.
  - Mitigation: держать `env.staging.example` и `.env.example` как источники структуры переменных.

## Test plan

- `npm run typecheck`
- `python3 scripts/docs_index_check.py`
- `python3 scripts/repo_lint.py`
- `python3 scripts/architecture_lint.py`

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-dx-staging-env-vps-actions.md`
- `docs/03_execution_plans/README.md`
- `docs/04_runbooks/README.md`
- `docs/04_runbooks/staging_vps_github_actions.md`
- `docs/00_index/README.md`
