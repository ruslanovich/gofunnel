# ADR-0006: Upload Transport Strategy (Node HTTP now, Next.js later)

## Context

- Epic 2 требует `POST /api/files/upload` (multipart), `GET /api/files`, `GET /api/files/:id`.
- Текущий продакшн-код в репозитории использует `node:http` transport (`interfaces/http/server.ts`) с ручным роутингом.
- Текущие body helpers поддерживают только:
  - `application/json`
  - `application/x-www-form-urlencoded`
  - и ограничивают body до `16KB`.
- Для upload нужна обработка multipart и файлов значительно больше `16KB`.
- При этом ожидается дальнейшая миграция на Next.js App Router.
- Research inputs:
  - Node `http` — low-level API, multipart parsing не встроен:
    - https://github.com/nodejs/node/blob/main/doc/api/http.md
  - Next.js Route Handlers используют `request.formData()`:
    - https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/03-file-conventions/route.mdx
  - Streaming multipart parser (busboy):
    - https://github.com/mscdex/busboy
- Связанный план:
  - `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md`

## Options considered

### Option A: Реализовать upload в текущем `node:http` transport (минимальный срез)

- Description:
  - Добавить multipart endpoint в существующий server и parser для multipart stream.
- Pros:
  - Минимальные изменения в текущем runtime.
  - Позволяет закрыть Epic 2 без параллельной миграции всего transport слоя.
  - Уменьшает риск scope creep.
- Cons:
  - Добавляет временный transport-specific код, который позже надо перенести/заменить.

### Option B: Сначала мигрировать transport на Next.js App Router, потом делать upload

- Description:
  - Отложить функционал Epic 2 до полной transport-миграции.
- Pros:
  - Сразу конечная target-архитектура для endpoint.
- Cons:
  - Значительное увеличение объема PR и задержка бизнес-фичи.
  - Высокий риск смешать migration concerns и feature concerns.

### Option C: Два параллельных upload endpoint (Node + Next) на время перехода

- Description:
  - Поддерживать два runtime endpoint одновременно.
- Pros:
  - Можно поэтапно переключать клиентов.
- Cons:
  - Дублирование логики, риск расхождения контрактов и security поведения.
  - Избыточно для MVP.

## Decision

- Выбранный вариант:
  - `Option A` сейчас; `Option B` как последующий шаг после Epic 2.
- Почему выбран:
  - Закрывает продуктовую цель Epic 2 с минимальным архитектурным риском.
  - Позволяет сохранить фокус PR на одном feature set без большого re-platforming.
- Область действия:
  - Только Epic 2 file upload/list/read API и `/app` UI для файлов.

### Migration-safe contract rules

- Stable API contracts (не меняем при миграции transport):
  - `POST /api/files/upload` (multipart, owner auth required)
  - `GET /api/files`
  - `GET /api/files/:id`
- Business logic переносится в `app/*` и `infra/*`; transport слой только:
  - auth/session extraction
  - request parsing
  - status code mapping
- Для multipart в текущем Node transport:
  - используем streaming parser (`busboy`), не буферизуем весь payload в память.
  - применяем лимиты по размеру/типу до записи в S3.
- Для будущей Next.js миграции:
  - Route Handlers повторяют тот же API contract и response shape.
  - storage/repository interfaces остаются теми же.

## Consequences

- Плюсы после принятия решения
  - Feature delivery без блокировки на платформенную миграцию.
  - API contract фиксируется заранее и не зависит от transport-реализации.
- Минусы / долг / ограничения
  - Появляется migration debt: повторная адаптация parsing/auth mapping в Next.js.
  - Нужно дисциплинированно держать business rules вне transport-слоя.
- Что нужно мониторить в следующих PR
  - Upload memory usage и backpressure.
  - Консистентность HTTP статусов между Node transport и будущими Next routes.

## Rollback plan

- Триггеры для пересмотра
  - Upload в Node transport становится нестабилен или слишком сложен в поддержке.
  - Приоритет transport migration становится выше feature roadmap.
- Как откатываемся
  - Новый ADR на ускоренную миграцию upload endpoints в Next.js.
  - Сохраняем API contract; меняем только transport adapter.
- Какие артефакты обновляем
  - `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md`
  - `SECURITY.md`
  - `RELIABILITY.md`
