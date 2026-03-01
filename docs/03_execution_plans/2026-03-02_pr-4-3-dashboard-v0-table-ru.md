# Execution Plan: PR-4.3 — Dashboard table refresh (v0-like, RU, placeholders)

## Goal / scope

- Обновить страницу `GET /app` до v0-like структуры: шапка, CTA-зона загрузки, таблица обработанных файлов.
- Показать реальные данные только из текущего `GET /api/files`; неподдержанные колонки отрисовать как `—`/`Скоро`.
- Добавить UI-only affordances (поиск/фильтр/сортировка) без изменения API контрактов.
- Добавить корректные состояния: `loading`, `empty`, `error`, `success`.

## Non-goals

- Изменение API, domain logic, DB schema, worker/pipeline.
- Добавление новых backend полей для "богатых" колонок.
- Изменение маршрутов `/app` и form endpoints (`/api/files/upload`, `/api/auth/logout`).
- Рефактор/переизобретение details overlay API поведения (только визуальная интеграция).

## Assumptions / research inputs

- Текущий UI — server-rendered HTML + inline script в `interfaces/http/server.ts`.
- Реальные поля списка файлов: `original_filename`, `status`, `created_at`, `size_bytes` (из `GET /api/files`).
- Ошибки файла в list-контракте не отдаются; для failed-строк показываем UI fallback `Ошибка обработки`.
- External research (Context7):
  - `/nodejs/node` — сохраняем безопасный паттерн экранирования/рендера (без HTML-инъекций в пользовательские поля).
  - `/fastify/fastify-multipart` — текущие upload-limit/error подходы не меняем, UI только потребляет существующие коды/статусы.

## Steps (PR-sized)

1. Обновить markup `/app`: header/description, CTA-блок, контролы таблицы, расширенные колонки с placeholder.
2. Обновить inline script `/app`:
   - loading skeleton для таблицы;
   - empty state с RU-подсказкой;
   - error state + retry UI;
   - локальные поиск/фильтр/сортировка по уже загруженным элементам;
   - сохранение клика по строке и открытия текущего overlay.
3. Обновить UI-токены/классы для статусов, row states, skeleton и muted placeholders.
4. Обновить `interfaces/http/server.test.ts` под новую структуру/копирайт и ключевые состояния.

## Risks & mitigations

- Риск: регрессия overlay/row click после рефакторинга таблицы.
  - Mitigation: сохранить IDs/handler flow; отдельные тесты harness на открытие overlay.
- Риск: affordances выглядят "рабочими", но не поддержаны backend.
  - Mitigation: локальная обработка только по уже загруженному массиву, без новых запросов.
- Риск: несоответствие RU-copy.
  - Mitigation: все пользовательские строки на русском + тестовые ассёрты на RU-формулировки.

## Test plan

- Unit/integration:
  - `interfaces/http/server.test.ts`:
    - `/app` scaffold + RU copy + placeholder колонки;
    - empty state текст;
    - error + retry UX в inline script harness;
    - existing overlay сценарии без регрессии.
- Commands:
  - `./scripts/typecheck.sh`
  - `./scripts/test.sh`

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-3-dashboard-v0-table-ru.md` (этот файл)
- `docs/03_execution_plans/README.md` (добавить активный план)
- `docs/00_index/README.md` (добавить в recent planning artifacts)
