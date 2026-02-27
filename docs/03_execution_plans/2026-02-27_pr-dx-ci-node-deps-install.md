# Execution Plan: DX CI Node Dependency Install

## Goal

- Починить CI-пайплайн: перед `typecheck` и `test` в GitHub Actions гарантированно поднимать Node runtime и устанавливать зависимости из lockfile.

## Non-goals

- Изменения продуктовой логики, API, UI, доменных контрактов.
- Изменения архитектурных границ или выбор новых библиотек.

## Assumptions / research inputs

- Local research:
  - `.github/workflows/ci.yml` запускает `./scripts/typecheck.sh` и `./scripts/test.sh`, но не содержит `actions/setup-node` и `npm ci`.
  - `package.json` уже содержит необходимые зависимости:
    - `argon2` в `dependencies`
    - `@types/node` в `devDependencies`
  - Ошибки CI:
    - tests: `ERR_MODULE_NOT_FOUND` для `argon2`
    - typecheck: `TS2688` для `node` types
- External research (Context7):
  - GitHub Actions docs (`/websites/github_en_actions`) рекомендуют pattern `actions/setup-node` + `npm ci` для Node CI.
  - npm docs (`/websites/npmjs`) фиксируют `npm ci` как clean/frozen install для CI по `package-lock.json`.
- Decision:
  - ADR не требуется: это не архитектурное решение, а инфраструктурная корректировка существующего CI workflow.

## Test-first plan

- Поведение продукта не меняется; добавление новых функциональных тестов не требуется.
- Проверки для PR:
  - `./scripts/typecheck.sh`
  - `./scripts/test.sh`
  - `python3 scripts/repo_lint.py`
  - `python3 scripts/docs_index_check.py`
  - `python3 scripts/architecture_lint.py`

## Steps (PR-sized)

1. Add Node setup and dependency install to CI
   - Scope:
     - Обновить `.github/workflows/ci.yml`:
       - добавить `actions/setup-node@v4` с `node-version: "20"` и `cache: "npm"`;
       - добавить шаг `npm ci` перед lint/typecheck/test/build.
   - Expected output:
     - CI окружение содержит `node_modules` до запуска скриптов.
     - Устраняются `Cannot find package 'argon2'` и `Cannot find type definition file for 'node'`.
   - Checks:
     - `./scripts/typecheck.sh`
     - `./scripts/test.sh`

2. Keep docs index in sync
   - Scope:
     - Добавить ссылку на этот execution plan в `docs/03_execution_plans/README.md` и `docs/00_index/README.md`.
   - Expected output:
     - План виден в навигации базы знаний.
   - Checks:
     - `python3 scripts/docs_index_check.py`

## Risks & mitigations

- Risk: drift между локальной версией Node и CI.
  - Mitigation: фиксировать CI на `node-version: "20"` и ориентироваться на ту же major-версию локально.
- Risk: флаки из-за случайного обновления dependency tree.
  - Mitigation: использовать `npm ci` (frozen install из lockfile), а не `npm install`.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- `python3 scripts/repo_lint.py`
- `python3 scripts/docs_index_check.py`
- `python3 scripts/architecture_lint.py`

## Docs to update

- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
- `docs/03_execution_plans/2026-02-27_pr-dx-ci-node-deps-install.md`
