# ADR-0007: Pagination Strategy for Files List (Epic 2)

## Context

- Epic 2 добавляет `GET /api/files` для списка файлов текущего пользователя.
- Нужен MVP-подход, который:
  - прост в реализации,
  - не создаёт технический тупик при росте данных,
  - стабилен при новых вставках (новые загрузки).
- List ordering для UX ожидается по `created_at DESC` (новые сверху).
- Связанный план:
  - `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md`

## Options considered

### Option A: Page-based pagination (`page`, `page_size`, SQL OFFSET/LIMIT)

- Description:
  - Классическая постраничная пагинация по номеру страницы.
- Pros:
  - Очень простая API-модель и UI-интеграция.
  - Легко объяснять и дебажить.
- Cons:
  - `OFFSET` становится дорогим на больших смещениях.
  - Нестабильные страницы при конкурентных вставках (новых upload).
  - Сложнее обеспечить consistency при polling.

### Option B: Cursor-based keyset pagination (`cursor`, `limit`)

- Description:
  - Используем курсор на основе сортировочного ключа (`created_at`, `id`) и `WHERE` для следующей страницы.
- Pros:
  - Стабильная и предсказуемая производительность.
  - Устойчиво к новым вставкам между запросами.
  - Лучше масштабируется без смены API-контракта.
- Cons:
  - Нужен cursor encode/decode и немного более сложный контракт.
  - Нет "прыжка на страницу N" в MVP (обычно и не нужен).

## Decision

- Выбранный вариант:
  - `Option B` — cursor-based keyset pagination.
- Почему выбран:
  - Это чуть сложнее page-based, но существенно уменьшает риск переработки API при росте данных.
  - Для MVP UI (`/app` list + polling) достаточно forward-only модели.
- Область действия:
  - Только `GET /api/files` в Epic 2.

### Fixed API shape for Epic 2

- Request:
  - `GET /api/files?limit=<1..100>&cursor=<opaque?>`
- Ordering:
  - `ORDER BY created_at DESC, id DESC`
- Response:
  - `{ items: FileListItem[], next_cursor: string | null }`
- Cursor payload:
  - Opaque base64url-encoded marker of last row keys (`created_at`, `id`).
- Security:
  - Pagination всегда внутри owner scope (только файлы текущего пользователя).

## Consequences

- Плюсы после принятия решения
  - Производительность и UX-предсказуемость лучше при росте количества файлов.
  - Меньший шанс API-breaking изменений в Epic 3+.
- Минусы / долг / ограничения
  - Потребуется аккуратная валидация cursor input (`400 invalid_cursor`).
  - Сложнее ручные ad-hoc запросы по сравнению с `page=N`.
- Что нужно мониторить в следующих PR
  - Корректность курсора при одинаковых timestamp (tie-breaker по `id` обязателен).
  - Регрессии в polling UI.

## Rollback plan

- Триггеры для пересмотра
  - MVP UI требует строгой навигации "страница N" с total count.
  - Появятся аналитические требования, где page-based проще.
- Как откатываемся
  - Добавляем совместимый page-based фасад поверх текущего query слоя (без удаления cursor API).
  - Не ломаем существующий cursor contract для клиентов.
- Какие артефакты обновляем
  - `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md`
  - `docs/01_product/*` (если фиксируем новые UX-правила)
