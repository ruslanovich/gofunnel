# Execution Plan: PR-4.2 — Login + Request Access (RU, v0-like forms, error UX)

## Goal

- Обновить UI/UX страниц `GET /login` и `GET /request-access` в стиле Epic 4 (v0-like card/forms) без изменения backend/API контрактов.
- Перевести все user-facing строки в scope этих страниц и связанных алертов на русский язык.
- Улучшить UX состояний формы: disabled/loading/success/error с безопасным plain-text рендером сообщений.

## Non-goals

- Изменение auth/access-request сервисов, доменной логики, CSRF, rate-limit механики, endpoint/route контрактов.
- Изменение `action`, `method`, `name`, `id` существующих полей форм.
- Добавление нового i18n-фреймворка.

## Assumptions / research inputs

- Текущая реализация UI — server-rendered HTML + inline script в `interfaces/http/server.ts`.
- Foundation из PR-4.1 уже добавлен в `interfaces/http/ui/*` (tokens/layout/components), поэтому PR-4.2 опирается на существующие helpers.
- External research (MCP Context7): `/nodejs/node` (`node:http` createServer/headers/status handling) подтверждает, что текущий подход с явным `statusCode`/headers/redirect в рамках `ServerResponse` корректен и не требует изменений backend-потока.

## Test-first plan

- Изменение UI-уровня, поэтому применяем UI-first с обязательным расширением regression тестов после правок.
- Добавить/обновить тесты в `interfaces/http/server.test.ts`:
  - HTML assertions для `/login` и `/request-access` (RU copy, card/form элементы, ссылки, status containers).
  - Script behavior assertions для `/request-access` (success/validation/rate-limit/general error) и `/login` (visual disabled + error mapping), без изменения API semantics.
- Negative cases checklist (по UX-отображению существующих backend-ответов):
  - [x] `400` validation
  - [x] `401/403` auth errors
  - [x] `429` rate limit
  - [x] unexpected/server error fallback

## Steps

1. Login page UX refresh
   - Обновить markup `/login`: card layout, RU labels/placeholders, secondary CTA на `/request-access`.
   - Добавить inline script для visual disabled submit и RU error alerts на основе существующих кодов ошибок.
   - Сохранить form contract (`method="post"`, `action="/api/auth/login"`, `name` полей).
2. Request access page UX refresh
   - Обновить markup `/request-access`: card layout, RU copy, hints, success block с возвратом на `/login`.
   - Обновить client script: field-level invalid style + общий alert, отдельный текст для `429`, general fallback.
   - Сохранить текущие поля/ids/endpoints, не менять honeypot/`client_ts`.
3. Verification
   - Обновить tests и проверить отсутствие регрессий API behavior.
   - Прогнать `./scripts/typecheck.sh` и `./scripts/test.sh`.

## Risks & mitigations

- Risk: случайная поломка существующих hooks/контрактов форм.
  - Mitigation: не менять `id`/`name`/`method`/`action`, закрепить HTML assertions тестами.
- Risk: небезопасный вывод backend сообщений.
  - Mitigation: выводить серверные `message/error_message/error_code` только через `textContent`, без `innerHTML`.
- Risk: смешение RU/EN копирайта.
  - Mitigation: добавить explicit RU assertions в page-level tests.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- Manual smoke:
  - `/login`: success redirect, invalid creds alert, disabled submit when empty.
  - `/request-access`: success UI + link to login, `429` dedicated message, general error fallback.

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-2-login-request-access-ru-v0.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
