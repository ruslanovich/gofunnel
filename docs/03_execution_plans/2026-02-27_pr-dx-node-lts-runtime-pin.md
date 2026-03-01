# Execution Plan: DX Node LTS Runtime Pin

## Goal

- Зафиксировать единый Node LTS runtime для локальной разработки и CI, чтобы исключить дрейф версий (локально Node 25, CI Node 20) и снизить риск сетевых/HTTP артефактов от нестабильной ветки runtime.
- Обеспечить воспроизводимый запуск `http` и `worker` на LTS.

## Non-goals

- Изменение бизнес-логики pipeline, retry-policy воркера или схем отчета.
- Изменение provider API-контрактов.

## Assumptions / research inputs

- Local research:
  - CI сейчас фиксирован на `node-version: "20"` в `.github/workflows/ci.yml`.
  - Локально активен `node v25.1.0` и `undici 7.16.0`.
  - В репозитории нет `.nvmrc`/`.node-version`.
- External research:
  - Node.js official releases page: текущая LTS-линейка — v24 (`Active LTS`) (source: https://nodejs.org/en/about/previous-releases).
  - `actions/setup-node` поддерживает `node-version-file` для `.nvmrc` (source: https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md).
- Decision:
  - ADR не нужен: это DX/CI pinning без изменения архитектурных границ.

## Test-first plan

- Продуктовое поведение не меняется, новые функциональные тесты не требуются.
- Проверки после изменений:
  - `npm run typecheck`
  - `npx tsx --test infra/processing/llm_adapter.test.ts`
  - `python3 scripts/docs_index_check.py`

## Steps (PR-sized)

1. Pin runtime in repo
   - Scope:
     - добавить `.nvmrc` с Node 24 LTS;
     - добавить `engines.node` в `package.json`;
     - перевести CI на `node-version-file: '.nvmrc'`.
   - Expected output:
     - единая версия runtime задается из одного файла.
   - Checks:
     - `npm run typecheck`

2. Validate runtime and app boot under LTS
   - Scope:
     - установить `node@24` локально (если отсутствует);
     - запустить `http:start` и `worker:start` под Node 24.
   - Expected output:
     - процессы стартуют под LTS runtime.
   - Checks:
     - `node -v` в LTS shell;
     - smoke `curl http://localhost:3000/`.

3. Update docs index
   - Scope:
     - добавить plan в `docs/03_execution_plans/README.md` и `docs/00_index/README.md`.
   - Expected output:
     - навигация docs не ломается.
   - Checks:
     - `python3 scripts/docs_index_check.py`

## Risks & mitigations

- Risk: несовместимость нативных модулей после смены major runtime.
  - Mitigation: переустановка зависимостей под LTS (`npm ci`) и smoke запуск.
- Risk: изменение LTS-линейки со временем.
  - Mitigation: использовать `node-version-file` как единый pin и обновлять целенаправленно.

## Test plan

- `npm run typecheck`
- `npx tsx --test infra/processing/llm_adapter.test.ts`
- `python3 scripts/docs_index_check.py`
- Manual smoke: `http:start` + `worker:start` + `curl /`

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-dx-node-lts-runtime-pin.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
