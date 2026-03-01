# Execution Plan: PR-4.5 — Admin UI refresh (access requests + users, RU, v0-like, no API changes)

## Goal

- Привести `GET /admin/access-requests` и `GET /admin/users` к единому v0-like UI (как `GET /app`) на текущем foundation.
- Сохранить существующие admin workflows без изменения контрактов: approve/reject/invite/update status.
- Перевести user-facing copy на RU и улучшить состояния UI (loading/empty/error/success) в рамках текущих endpoints.

## Non-goals

- Любые изменения backend/domain логики, RBAC, маршрутов, HTTP контрактов, action payload.
- Новые server-side фильтры, сортировки, поля, роли или бизнес-процессы админки.
- Новые API вызовы для локальных controls.

## Assumptions / research inputs

- Текущая админка server-rendered в `interfaces/http/server.ts` с inline scripts для действий.
- Доступные UI primitives уже есть в foundation: `gf-card`, `gf-control-row`, `gf-table`, `gf-badge`, `gf-alert`, `gf-btn`.
- External research (MCP Context7):
  - `/mdn/content` подтверждает корректный паттерн для UI-only affordances: submit interception + `fetch` с `URLSearchParams/FormData`, `button.disabled` в pending state и `aria-live` для объявлений статуса.

## Test-first plan

- Изменение UI/markup и inline client scripts: применяем UI-first подход, затем обновляем regression assertions.
- Обновить `interfaces/http/server.test.ts`:
  - `GET /admin/access-requests`: проверка RU copy, controls, table headers, invite/action элементы.
  - `GET /admin/users`: проверка RU copy, controls, table headers, inline actions.
- Контрактные/негативные сценарии admin API уже покрыты; сохраняем существующие тесты без изменения поведения.
- Negative cases checklist (в рамках существующих тестов):
  - [x] authz (`401/403`) для `/admin/*` и `/api/admin/*`
  - [x] validation (`400`) для PATCH status
  - [x] not found (`404`) для неизвестных id
  - [ ] revoked/expired (`410`) — не относится к scope PR-4.5
  - [x] rate limit (`429`) — покрыт для `POST /api/access-requests`, вне admin UI scope

## Steps

1. Admin access requests UI refresh
   - Scope: обновить markup/controls/status badges/alerts/кнопки на `GET /admin/access-requests`.
   - Expected output: единая v0-like структура header + controls + table + RU states.
   - Checks: существующие PATCH/POST actions работают с прежними payload.
2. Admin users UI refresh
   - Scope: обновить `GET /admin/users` по тому же визуальному шаблону + локальные фильтры/поиск.
   - Expected output: RU copy, badges, аккуратные action buttons, empty/error/success UX.
   - Checks: enable/disable flow без изменений endpoint/payload.
3. Regression tests and verification
   - Scope: обновить HTML assertions в `interfaces/http/server.test.ts`.
   - Expected output: тесты отражают новую структуру, при этом API/authz тесты проходят без изменений логики.
   - Checks: `./scripts/typecheck.sh` и `./scripts/test.sh`.

## Risks & mitigations

- Risk: визуальная правка случайно поменяет semantics admin action payload.
  - Mitigation: оставить те же endpoint, method, JSON body ключи; проверить существующими API tests.
- Risk: локальные filters могут скрывать строки и создавать ложное впечатление пустого списка.
  - Mitigation: явные empty states для двух кейсов: «данных нет» и «ничего не найдено».
- Risk: copy changes сломают brittle HTML assertions.
  - Mitigation: обновить тесты на новые стабильные селекторы/тексты.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- Manual smoke:
  - Admin: `/admin/access-requests` -> approve/reject/invite.
  - Admin: `/admin/users` -> disable/enable.
  - Non-admin: `/admin/*` и `/api/admin/*` остаются запрещены.

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-5-admin-access-requests-users-v0-ru.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
