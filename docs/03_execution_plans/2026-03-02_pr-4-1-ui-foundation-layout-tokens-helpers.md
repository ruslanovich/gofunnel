# Execution Plan: PR-4.1 — UI foundation (layout + tokens + shared helpers)

## Goal

- Подготовить UI-фундамент для Epic 4 в текущем server-rendered стеке без изменения backend/API поведения.
- Ввести общий layout-паттерн, базовые дизайн-токены и минимальные reusable helper-функции для карточек/кнопок/alerts/empty state.
- Применить foundation к страницам `/login`, `/request-access`, `/app`, `/admin/access-requests`, `/admin/users`.

## Non-goals

- Изменение доменной логики, БД, воркеров, API контрактов и существующих маршрутов.
- Полный редизайн всех страниц Epic 4 (детальный контент будет в PR-4.2+).
- Добавление новых endpoint или требований к новым данным.

## Assumptions / research inputs

- Текущая UI-архитектура: server-rendered HTML + inline browser script в `interfaces/http/server.ts`.
- В репозитории уже зафиксированы Epic 4 и ADR-0012:
  - `docs/03_execution_plans/2026-03-02_epic-4-ui-refresh-v0-reference-ru.md`
  - `docs/05_decisions/2026-03-02_adr-0012_epic-4-ui-refresh-v0-integration.md`
- MCP `context7` в текущей сессии недоступен (`resources=[]`), поэтому external research ограничен локальным анализом кода и UI-референсом.

## Test-first plan

- Изменение относится к visual/layout слою, поэтому применяем UI-first с обязательными regression/smoke тестами после правок.
- Обновить тестовые ассерты HTML в `interfaces/http/server.test.ts` для новых RU-строк и общего layout/foundation.
- Зафиксировать, что ключевые идентификаторы и hooks форм/скриптов не изменены (`id`, `action`, URL endpoints).
- Negative cases checklist:
  - [x] authz (`401/403`) — существующие тесты должны остаться зелеными
  - [x] validation (`400`) — существующие API-потоки не меняются
  - [x] not found (`404`) — существующие сценарии не меняются
  - [x] revoked/expired (`410`) — share flow не меняется
  - [x] rate limit (`429`) — access request flow без изменения логики

## Steps (PR-sized)

1. UI foundation extraction
   - Scope: добавить `interfaces/http/ui/*` с токенами и helper-функциями.
   - Expected output: единый CSS token layer + reusable layout/components helpers.
   - Checks: typecheck, статический просмотр generated HTML.
2. Page integration
   - Scope: применить foundation в `/login`, `/request-access`, `/app`, `/admin/access-requests`, `/admin/users`.
   - Expected output: консистентный container/header/card/button/alert стиль без изменения form/API поведения.
   - Checks: regression тесты на страницы и JS hooks (`id`, маршруты, action).
3. Verification + repo hygiene
   - Scope: прогнать test/typecheck/lint/scripts и проверить, что `.tmp/gofunnel-v0-design-system/` не попадает в индекс.
   - Expected output: чистый результат проверок, без лишнего мусора в staged changes.
   - Checks: `./scripts/test.sh`, `./scripts/typecheck.sh`, `./scripts/lint.sh`, `python3 scripts/repo_lint.py`, `python3 scripts/docs_index_check.py`, `python3 scripts/architecture_lint.py`.

## Test plan

- Авто:
  - `./scripts/test.sh`
  - `./scripts/typecheck.sh`
  - `./scripts/lint.sh`
  - `python3 scripts/repo_lint.py`
  - `python3 scripts/docs_index_check.py`
  - `python3 scripts/architecture_lint.py`
- Manual smoke:
  - `/login`: поля и submit работают как раньше.
  - `/request-access`: форма видима, submit и сообщения работают как раньше.
  - `/app`: upload/list/overlay доступны и работают без изменений endpoint.
  - `/admin/access-requests`, `/admin/users`: таблицы и действия работают как раньше.

## Risks & mitigations

- Risk: случайно сломать JS hooks при смене markup.
  - Mitigation: не менять существующие `id`, `name`, `action`, endpoint URL и data-атрибуты.
- Risk: скрытый behavioral drift через изменения текстов/статусов.
  - Mitigation: менять только presentation copy и CSS-классы; API статусы/коды оставить прежними.
- Risk: стили затронут незапланированные страницы.
  - Mitigation: токены и utility классы нейтральные, page-specific styling через явные классы.

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-1-ui-foundation-layout-tokens-helpers.md`
- `docs/03_execution_plans/2026-03-02_epic-4-ui-refresh-v0-reference-ru.md` (progress note, если требуется)
- `.gitignore` (исключение `.tmp/gofunnel-v0-design-system/`)
