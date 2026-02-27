# ADR-0010: Retry and Backoff Policy for Processing Jobs

## Context

- Epic 3 worker выполняет цепочку: S3 read -> LLM call -> schema validate -> S3 write -> DB update.
- Нужно формально зафиксировать:
  - max attempts,
  - backoff schedule,
  - retriable vs fatal errors,
  - конечные state transitions.
- External research (Context7, official docs):
  - pg-boss retry model (`retryLimit`, `retryDelay`, `retryBackoff`) как reference-pattern для policy design:
    - https://github.com/timgit/pg-boss
  - OpenAI Node defaults/timeouts/retries and typed errors:
    - https://github.com/openai/openai-node
  - Postgres row locking semantics for safe concurrent workers:
    - https://www.postgresql.org/docs/current/sql-select

## Options considered

### Option A: Fixed retry interval

- Description:
  - Повторять jobs через постоянный delay.
- Pros:
  - Простая реализация и predictability.
- Cons:
  - Плохое поведение при внешней деградации (thundering herd).
  - Нет адаптации к длительным инцидентам у провайдера.

### Option B: Exponential backoff with jitter

- Description:
  - Повторять с экспоненциальной задержкой + случайный jitter.
- Pros:
  - Меньше конкурентного давления на провайдеры/БД/S3 в ошибочных периодах.
  - Стандартный production-паттерн для transient errors.
- Cons:
  - Сложнее анализировать точные timestamps ретраев без хороших логов.

## Decision

- Выбранный вариант:
  - `Option B` — exponential backoff with jitter.
- Почему выбран:
  - Лучшая устойчивость для transient LLM/network/storage ошибок.
  - Минимизирует retry bursts при одновременных сбоях.
- Область действия:
  - Все Epic 3 processing jobs.

### Fixed policy

- Max attempts:
  - `4` total attempts (initial + 3 retries), что удовлетворяет требованию `>=3`.
- Backoff schedule (before next retry):
  - attempt 2: `30s ±20% jitter`
  - attempt 3: `120s ±20% jitter`
  - attempt 4: `480s ±20% jitter`
- Retriable errors:
  - LLM provider transient: timeout, network/connectivity, HTTP `429`, HTTP `5xx`.
  - Temporary S3/DB connectivity errors.
  - Worker crash/interruption before terminal state write.
- Fatal errors (no retry):
  - Schema validation failure of model output.
  - Invalid/unparseable JSON output from LLM after normalization.
  - Input invariants violation (missing object, unsupported extension, corrupted required metadata).
  - Provider permanent request errors (`4xx`, except `429`).
- Terminal behavior:
  - On retriable + attempts remaining: job back to `queued`, set `next_run_at`.
  - On retriable + attempts exhausted: `failed`.
  - On fatal: immediate `failed`.

## Consequences

- Плюсы после принятия решения
  - Предсказуемая и устойчивая retry модель для MVP.
  - Явная классификация ошибок упрощает debugging и alerting.
- Минусы / долг / ограничения
  - Нужна аккуратная нормализация provider-specific ошибок в единый error taxonomy.
  - Без manual requeue endpoint повтор возможен только через новую обработку/админ-операцию.
- Что нужно мониторить в следующих PR
  - retry rate, final failure rate, среднее время до `succeeded`.
  - долю schema failures и raw-output captures.

## Rollback plan

- Триггеры для пересмотра
  - Слишком длинный time-to-success из-за backoff.
  - Избыточное количество ненужных retries.
- Как откатываемся
  - Новый ADR с обновлением attempt count/backoff кривой и error classification.
  - Миграции не требуются, если модель jobs остаётся прежней.
- Какие артефакты/доки нужно обновить при откате
  - `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`
  - `RELIABILITY.md`
