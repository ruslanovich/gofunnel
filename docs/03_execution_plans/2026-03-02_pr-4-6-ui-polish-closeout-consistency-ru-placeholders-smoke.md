# Execution Plan: PR-4.6 — UI polish & closeout (consistency, RU audit, placeholders, smoke matrix)

## Goal

- Закрыть Epic 4 финальным pass по UI в scope: `/login`, `/request-access`, `/app` (+ overlay), `/admin/access-requests`, `/admin/users`, placeholder-пути (`/share/:token`, fallback `/app/*`, `/admin/*`).
- Довести консистентность компонентов и copy: единые badges/alerts/buttons/table controls, единый RU словарь статусов и ошибок.
- Собрать финальную smoke matrix по Epic 4 и проиндексировать документацию.

## Non-goals

- Любые backend/API/domain изменения: контракты, роуты, статусы, бизнес-логика, polling behavior.
- Добавление новых запросов из UI.
- Реализация функционала placeholder-flow (только унификация вида и copy).

## Assumptions / research inputs

- Текущий UI: server-rendered HTML + inline scripts в `interfaces/http/server.ts` и базовые primitives в `interfaces/http/ui/*`.
- Уже внедрён foundation Epic 4 (`tokens`, `layout`, `components`) и v0-like структура страниц.
- External research (MCP Context7, MDN):
  - `/mdn/content`: `aria-live="polite"` подходит для status-обновлений без агрессивных прерываний.
  - `/mdn/content`: `button.disabled` и submit interception через `fetch + FormData/URLSearchParams` — корректный паттерн для pending/duplicate-submit защиты.

## Test-first plan

- Изменение относится к UI/layout/copy; применяем UI-first с обновлением regression тестов после правок.
- Обновить `interfaces/http/server.test.ts` на новые RU строки/табличные headers/placeholder-copy.
- Негативные сценарии backend-поведения не расширяем, но сохраняем без регрессии существующими тестами:
  - [x] `401/403` auth/admin guards
  - [x] `400` validation
  - [x] `404` not-found
  - [x] `410` revoked share
  - [x] `429` access-request rate-limit

## Steps

1. RU-copy audit + centralized dictionary
   - Добавить маленький RU copy-словарь в UI-модуль.
   - Убрать остатки English user-facing строк в scope (labels/placeholders/headers/errors/empty states).
   - Выровнять формулировки: `Повторить`, `Не удалось ...`, словари статусов.

2. UI consistency refactor
   - Укрупнить shared helpers для badge/alert/button/table usage.
   - Выровнять table/header controls/hover-selected behavior и визуальные отступы.
   - Сократить дубли «почти одинаковых» блоков рендера.

3. Placeholder consistency
   - Привести placeholder-страницы к единому нейтральному шаблону:
     - заголовок,
     - краткое описание,
     - действие «Вернуться в приложение».
   - Без обещаний сроков и без включения нового функционала.

4. Tests + docs closeout
   - Обновить/добавить assertions в `interfaces/http/server.test.ts`.
   - Добавить финальный документ `Epic 4 smoke matrix`.
   - Проиндексировать в `docs/00_index/README.md` и `docs/03_execution_plans/README.md`.

## Risks & mitigations

- Risk: copy-polish затронет brittle HTML assertions.
  - Mitigation: обновить тесты на стабильные маркеры (`id`, ключевые RU-фразы).
- Risk: рефактор helper-функций случайно изменит action behavior.
  - Mitigation: не менять endpoints/method/body, прогнать полный `server.test.ts`.
- Risk: placeholder унификация ухудшит навигацию.
  - Mitigation: везде добавить явное действие возврата в `/app`.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- `python3 scripts/docs_index_check.py`
- Manual smoke matrix (в отдельном документе):
  - `/login` success + invalid + general error
  - `/request-access` success + `429` + validation
  - `/app` empty + list + retry + overlay open/close
  - overlay RU states + close paths
  - `/admin/access-requests` list + actions + local filter
  - `/admin/users` list + enable/disable + local filter
  - placeholders style + back-to-app action

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-6-ui-polish-closeout-consistency-ru-placeholders-smoke.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
- `docs/04_runbooks/` (новый smoke matrix документ Epic 4)
