# Execution Plan: Epic 4 — UI refresh (RU) по v0-референсу, без backend changes

## Goal

- Обновить визуальный слой и UX существующих страниц `gofunnel` до v0-like уровня, используя референс-репозиторий [gofunnel-v0-design-system](https://github.com/ruslanovich/gofunnel-v0-design-system) только как дизайн/поведенческий ориентир.
- Сохранить текущие backend API contracts, маршруты и доменную логику без изменений.
- Перевести user-facing UI copy на русский язык.

## Non-goals

- Изменение DB schema, worker, бизнес-логики, API контрактов.
- Переименование/ломка существующих маршрутов.
- Миграция на отдельный frontend app или перенос v0 кода.
- Добавление новых endpoint ради недостающих колонок таблицы.

## Assumptions / research inputs

- Текущий стек UI в `gofunnel`: server-rendered HTML + inline JS (`interfaces/http/server.ts`), без отдельного SPA frontend.
- v0-референс: Next.js + компонентный подход (app shell, table, overlay, status badges, tokens), который используется как визуальный/UX ориентир, а не как источник кода.
- MCP `context7` в текущей сессии недоступен; external-часть исследования выполнена по исходникам v0-репозитория.

### Cross-check текущих routes/pages и контрактов (без допущений о новых endpoint)

- Login page: `GET /login`.
- Request access page: `GET /request-access`.
- Dashboard/files: `GET /app`.
- File details UX: в текущем состоянии через overlay внутри `/app` + API:
  - `GET /api/files/:id`
  - `GET /api/files/:id/report`
  - отдельного HTML-route страницы деталей файла сейчас нет.
- Admin pages:
  - `GET /admin/access-requests`
  - `GET /admin/users`
  - `GET /admin` сейчас placeholder.
- Placeholder-потоки:
  - `GET /share/:token` (shared report placeholder)
  - `GET /app/*` и `GET /admin/*` fallback placeholder.

### Mapping: v0 page/component -> gofunnel route/page -> data source

| v0 reference | gofunnel target | Data source (existing only) | Notes |
|---|---|---|---|
| `LoginForm` | `GET /login` | `POST /api/auth/login` | RU copy, существующий flow auth/redirect сохраняется |
| Login footer CTA (request access) | `GET /request-access` | `POST /api/access-requests` | anti-spam/honeypot/rate-limit остается без изменений |
| `AppShell` + `DashboardView` | `GET /app` | `GET /api/files`, `POST /api/files/upload`, `POST /api/auth/logout` | layout, cards, table style, upload zone адаптируются |
| `FileRegistryTable` | таблица на `/app` | `GET /api/files` | неподдерживаемые v0-колонки выводятся как `—`/«Скоро» |
| `ReportOverlay` | overlay на `/app` | `GET /api/files/:id`, `GET /api/files/:id/report` | без нового HTML-route |
| v0 status badges/tokens | `/app`, `/admin/*`, `/request-access`, `/login` | UI-only | единый визуальный язык |
| (аналог по стилю) admin tables | `/admin/access-requests`, `/admin/users` | `GET/PATCH /api/admin/access-requests/*`, `GET/PATCH /api/admin/users/*`, `POST /api/admin/invites` | без изменения API/ролей |

### Data mapping strategy for dashboard columns (real vs placeholder)

- Реальные поля (из `GET /api/files`):
  - `original_filename` -> `Файл`
  - `created_at` -> `Загружен`
  - `status` -> `Статус`
  - `size_bytes` -> `Размер`
- Поля из v0, не поддержанные текущим API (показывать `—` и/или «Скоро»):
  - `Клиент`, `Этап сделки`, `Длительность`, `Участники`, `Риск`, `Пробелы/Гэпы`, `Следующие шаги`.

## Test-first plan

- Изменения Epic 4 в основном UI-layer; допускается UI-first с обязательной smoke/regression проверкой после каждого PR.
- Для каждого PR обновляем/добавляем минимум:
  - HTML rendering assertions в `interfaces/http/server.test.ts`;
  - client-side behavior assertions для критичных скриптов (submit/polling/error messages) там, где уже есть harness.
- Negative cases checklist (не расширяем backend-поведение, но проверяем отсутствие регрессии):
  - [x] authz (`401/403`) — существующие тесты должны продолжать проходить
  - [x] validation (`400`) — существующие API errors не меняются, RU отображение безопасно
  - [x] not found (`404`) — существующие сценарии `/api/files/:id`, admin routes
  - [x] revoked/expired (`410`) — share token flow (`/share/:token`) без регрессии
  - [x] rate limit (`429`) — access request flow без регрессии

## Steps (PR-sized)

### PR title: PR-4.1 — UI foundation: shared layout, tokens, base components (server-rendered)

- Goals:
  - Вынести общий каркас страницы (container, header patterns, base typography, surface styles).
  - Добавить дизайн-токены (цвета/отступы/радиусы/тени/status colors) и базовые utility-классы.
  - Подготовить общие helper-функции рендера для повторного использования.
- Out of scope:
  - Полный редизайн конкретных страниц и бизнес-flow.
- Files/paths likely touched:
  - `interfaces/http/server.ts`
  - `interfaces/http/server.test.ts`
  - (опционально) `interfaces/http/ui/*.ts`
- UI states covered:
  - success (базовая отрисовка), empty skeleton placeholders для будущих страниц.
- RU copy notes:
  - Технические подписи и глобальные labels переводятся на RU.
- DoD:
  - Общий UI layer применим к login/request-access/app/admin без разрыва маршрутов.
  - Все существующие тесты проходят.
- Verification checklist:
  - `./scripts/test.sh`
  - `./scripts/typecheck.sh`
  - Ручная проверка: `/login`, `/request-access`, `/app`, `/admin/access-requests`, `/admin/users` визуально используют единый стиль.

### PR title: PR-4.2 — Login + Request Access: v0-like forms, RU copy, error UX

- Goals:
  - Привести `/login` и `/request-access` к v0-like форме/карточке/типографике.
  - Полный RU copy на страницах и в client status messages.
  - Безопасный показ ошибок (`error_code`/`error_message`) в виде plain text.
- Out of scope:
  - Изменение auth/access-request backend логики и антиспама.
- Files/paths likely touched:
  - `interfaces/http/server.ts`
  - `interfaces/http/server.test.ts`
- UI states covered:
  - loading (`Отправка...`/disabled button), success, validation error, server/network error.
- RU copy notes:
  - Никаких англоязычных user-facing строк на этих страницах.
- DoD:
  - `/login` и `/request-access` визуально соответствуют новому стилю, копирайт RU-only.
  - Redirect/login и access-request submit работают без контрактных изменений.
- Verification checklist:
  - Успешный login + redirect `next`.
  - Ошибка login (`401`) отображается корректно.
  - Успешная заявка доступа (`200`).
  - Rate-limit (`429`) отображается дружелюбно на RU.

### PR title: PR-4.3 — Dashboard table refresh: v0-like layout, placeholders for unsupported columns

- Goals:
  - Обновить `/app` layout (header, upload zone, stats row, таблица) в v0-like стиле.
  - Добавить columns mapping: реальные поля + placeholder `—`/«Скоро» для неподдерживаемых.
  - Добавить affordances сортировки/фильтра как UI-only элементы (без обещания серверной фильтрации).
- Out of scope:
  - Новые API endpoints/поля.
  - Изменения upload/processing backend behavior.
- Files/paths likely touched:
  - `interfaces/http/server.ts`
  - `interfaces/http/server.test.ts`
- UI states covered:
  - loading (list/skeleton/spinner), empty state, error state, success state.
- RU copy notes:
  - Статусы, подписи колонок и подсказки полностью на RU.
- DoD:
  - Таблица визуально ближе к v0, существующая пагинация/refresh/upload остаются рабочими.
  - Неподдержанные колонки явно маркированы как placeholder.
- Verification checklist:
  - Upload `.txt/.vtt` успешен.
  - Invalid type и `413` показывают RU-сообщения.
  - `Load more`, `Refresh`, polling без регрессии.
  - Empty list состояние оформлено и читаемо.

### PR title: PR-4.4 — File details overlay refresh: RU states + safe error rendering

- Goals:
  - Переработать overlay деталей файла в v0-like modal/card структуру.
  - Явные RU-состояния: loading/processing/success/error/not found.
  - Безопасно показывать `error_code`/`error_message` и processing metadata.
- Out of scope:
  - Новый route для file details page.
  - Изменение логики poll interval/backend статусов.
- Files/paths likely touched:
  - `interfaces/http/server.ts`
  - `interfaces/http/server.test.ts`
- UI states covered:
  - loading, processing polling, success (report), failed, not found.
- RU copy notes:
  - Все сообщения overlay на RU, включая fallback ошибки.
- DoD:
  - Overlay стабильно открывается из таблицы `/app`; текущие API contracts используются без изменений.
  - Строки ошибок безопасны (plain text, no HTML injection).
- Verification checklist:
  - Открытие деталей для `processing` и автопереходы polling.
  - Ошибка `report_not_ready` и `failed` сценарии.
  - Закрытие overlay (Esc/click outside/button) без утечек polling timer.

### PR title: PR-4.5 — Admin pages refresh: access requests + users, unified RU UI

- Goals:
  - Привести `/admin/access-requests` и `/admin/users` к единому визуальному стилю Epic 4.
  - Упорядочить таблицы/действия/статусные сообщения на RU.
  - Сохранить существующие admin API flows (status update, invite creation, enable/disable user).
- Out of scope:
  - Изменение RBAC/permission logic.
  - Новые admin endpoints.
- Files/paths likely touched:
  - `interfaces/http/server.ts`
  - `interfaces/http/server.test.ts`
- UI states covered:
  - loading действий (disable buttons), success feedback, empty table state, API error state.
- RU copy notes:
  - Заголовки/фильтры/действия/уведомления переведены на RU.
- DoD:
  - Обе admin страницы визуально консистентны с dashboard/login.
  - Все admin операции работают на существующих endpoint.
- Verification checklist:
  - Non-admin на `/admin/*` продолжает получать `403`.
  - Update статуса access request, create invite, copy link.
  - Enable/disable user flow и последующая проверка сессии.

### PR title: PR-4.6 — Placeholders consistency + final regression + docs closeout

- Goals:
  - Визуально унифицировать существующие placeholder pages (`/admin`, `/app/*`, `/share/:token`) в стиле Epic 4.
  - Финальный RU copy pass по всем затронутым страницам.
  - Закрыть документацию и чеклисты по Epic 4.
- Out of scope:
  - Реализация новых фич для placeholder-потоков.
- Files/paths likely touched:
  - `interfaces/http/server.ts`
  - `interfaces/http/server.test.ts`
  - `docs/03_execution_plans/*`
  - `docs/05_decisions/*`
  - `docs/00_index/README.md`
- UI states covered:
  - placeholder success/empty/error copy consistency.
- RU copy notes:
  - Финальная проверка отсутствия английских user-facing строк в scope Epic 4.
- DoD:
  - Placeholder-потоки остаются функциональными и визуально согласованными.
  - Документация по Epic 4 завершена и индексирована.
- Verification checklist:
  - Smoke-run всех маршрутов scope Epic 4.
  - `./scripts/test.sh`, `./scripts/typecheck.sh`, `python3 scripts/docs_index_check.py`.

## Risks & mitigations

- Risk: UI-рефакторинг в одном файле (`interfaces/http/server.ts`) усложнит review.
  - Mitigation: дробить PR по зонам ответственности, держать small diff и локальные helper extraction.
- Risk: скрытая регрессия в auth/admin flow из-за копирайта/markup changes.
  - Mitigation: не менять form actions/API URLs; закрепить тестами и manual smoke.
- Risk: пользователь может ожидать реальные v0-колонки без backend данных.
  - Mitigation: явно маркировать `—`/«Скоро», не симулировать отсутствующие данные.
- Risk: смешение RU/EN после частичного релиза.
  - Mitigation: per-PR RU copy checklist + финальный PR-4.6 copy audit.

## Test plan (epic-level)

- Авто:
  - `./scripts/test.sh`
  - `./scripts/typecheck.sh`
- Доки/структура:
  - `python3 scripts/docs_index_check.py`
- Manual smoke matrix:
  - Auth: `/login` success/fail/redirect.
  - Access request: success/validation/rate-limit UX.
  - Dashboard: upload/list/load-more/polling/overlay details.
  - Admin: access request status update, invite creation, users status toggle.
  - Placeholders: `/admin`, `/app/*`, `/share/:token` визуально консистентны.

## Docs to update

- `docs/05_decisions/2026-03-02_adr-0012_epic-4-ui-refresh-v0-integration.md`
- `docs/03_execution_plans/2026-03-02_epic-4-ui-refresh-v0-reference-ru.md`
- `docs/00_index/README.md`
- `docs/03_execution_plans/README.md`
- `docs/05_decisions/README.md`

