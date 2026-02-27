# ADR-0008: Job Queue Choice for Epic 3 (pg-boss vs custom jobs table)

## Context

- Epic 3 требует асинхронную обработку после upload:
  - `uploaded -> queued -> processing -> succeeded|failed`
  - retries/backoff, concurrency control, owner-safe processing и наблюдаемость.
- Текущий стек репозитория:
  - Node.js + TypeScript
  - Postgres migrations и собственные repository adapters
  - Node HTTP transport (`interfaces/http/server.ts`) и `/app` polling UI.
- Нужно выбрать между:
  - `pg-boss` (готовая очередь на Postgres)
  - custom `jobs` table + `SELECT ... FOR UPDATE SKIP LOCKED`.
- External research (Context7, official docs):
  - pg-boss queue options (`retryLimit`, `retryDelay`, `retryBackoff`, `deadLetter`, stats):
    - https://github.com/timgit/pg-boss
  - PostgreSQL locking semantics and queue suitability of `SKIP LOCKED`:
    - https://www.postgresql.org/docs/current/sql-select
    - https://www.postgresql.org/docs/current/explicit-locking

## Options considered

### Option A: pg-boss

- Description:
  - Использовать `pg-boss` как готовый job queue слой поверх Postgres.
- Pros:
  - Встроенные retries/backoff/dead-letter/scheduling.
  - Готовые worker APIs и queue stats.
  - Меньше прикладного кода для orchestration очереди.
- Cons:
  - Новая инфраструктурная dependency + отдельная модель управления queue entities.
  - Debugging обычно через mix pg-boss internals + наши таблицы.
  - Часть queue semantics становится менее прозрачной для текущего minimalist SQL-first подхода.

### Option B: Custom `jobs` table + `FOR UPDATE SKIP LOCKED`

- Description:
  - Реализовать минимальную очередь в нашей схеме Postgres:
    - таблица jobs,
    - claim query с `FOR UPDATE SKIP LOCKED`,
    - собственная retry/backoff политика.
- Pros:
  - Полный контроль над состояниями, полями ошибок, попытками и отладочными данными.
  - Единый SQL-first стиль, согласованный с текущими `infra/*` adapters и миграциями.
  - Минимальный operational footprint: только приложение + текущий Postgres.
- Cons:
  - Нужно реализовать queue semantics самостоятельно (claim/retry/poison handling).
  - Ошибки в конкурентности возможны без строгого test-first покрытия.

## Decision

- Выбранный вариант:
  - `Option B` — custom `jobs` table + `FOR UPDATE SKIP LOCKED`.
- Почему выбран:
  - Для Epic 3 нужен один тип job и прозрачная диагностика по каждому `file_id`.
  - В текущем репозитории уже закреплён SQL-first подход (миграции + репозитории), и custom queue лучше встраивается в существующие слои без нового framework-like runtime.
  - `SKIP LOCKED` является официально поддержанным паттерном именно для queue-like consumers в Postgres docs.
- Область действия:
  - Epic 3 processing worker для генерации report artifacts.

### Selection criteria result

- Simplicity: `custom jobs` выигрывает для single-queue MVP и текущей архитектуры.
- Retries/backoff: достигается через явную policy в приложении (ADR-0010).
- Concurrency control: `SKIP LOCKED` + bounded worker concurrency.
- Visibility/debuggability: highest (state and attempt history в наших таблицах).
- Operational footprint: минимальный (без отдельного queue runtime/dependency layer).

## Consequences

- Плюсы после принятия решения
  - Очередь полностью наблюдаема и контролируема через Postgres.
  - Легко связывать jobs и files statuses без промежуточных abstraction leaks.
  - Проще писать точные интеграционные тесты на retry/failure transitions.
- Минусы / долг / ограничения
  - Нужно аккуратно реализовать idempotency и конкурентный claim path.
  - Нет out-of-box возможностей pg-boss (cron, DLQ abstractions, built-in metrics).
- Что нужно мониторить в следующих PR
  - stuck jobs (`processing` слишком долго), retry storms, repeated fatal errors.
  - lock contention и query plan стабильность для claim query.

## Rollback plan

- Триггеры для пересмотра
  - Появление нескольких queue types/schedules, где custom layer начинает быстро усложняться.
  - Недостаточная операционная наблюдаемость/управляемость при росте нагрузки.
- Как откатываемся
  - Новый ADR для миграции на `pg-boss` с адаптером поверх текущего worker контракта.
  - Сохраняем app-level processing contract (job payload + file status transitions), меняем только queue adapter.
- Какие артефакты/доки нужно обновить при откате
  - `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`
  - `RELIABILITY.md`
  - `SECURITY.md`
