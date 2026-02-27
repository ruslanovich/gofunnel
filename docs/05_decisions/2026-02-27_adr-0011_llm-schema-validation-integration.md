# ADR-0011: LLM Adapter + JSON Schema Validation Integration

## Context

- Epic 3 должен генерировать structured report через LLM и валидировать результат по JSON schema.
- Требования:
  - provider-agnostic adapter design,
  - строгая runtime валидация,
  - сохранение `raw_llm_output.json` при schema failure или debug mode.
- В репозитории уже есть `prompts/prompt.txt` с prompt + schema секцией; нужно перейти к управляемому versioned flow.
- External research (Context7, official docs):
  - Ajv strict mode and TS runtime validation patterns:
    - https://github.com/ajv-validator/ajv
  - OpenAI Node timeout/retry/error handling and structured output helpers:
    - https://github.com/openai/openai-node

## Options considered

### Option A: Provider-specific integration directly inside worker

- Description:
  - Worker напрямую использует конкретный provider SDK и ad-hoc JSON checks.
- Pros:
  - Быстрый старт для одного провайдера.
- Cons:
  - Жёсткая привязка к провайдеру.
  - Сложнее покрывать тестами и эволюционировать контракт.
  - Риск слабой валидации при ad-hoc parsing.

### Option B: Provider-agnostic adapter + Ajv strict validator

- Description:
  - Чёткий интерфейс LLM adapter и отдельный schema validation слой (Ajv).
- Pros:
  - Замена провайдера без переписывания worker pipeline.
  - Явный тестируемый контракт для `raw_output -> validated_report`.
  - Строгая runtime валидация по версии schema.
- Cons:
  - Нужны дополнительные abstraction и тестовые фикстуры.

## Decision

- Выбранный вариант:
  - `Option B` — provider-agnostic adapter + Ajv strict validation.
- Почему выбран:
  - Соответствует архитектурному правилу `app` не зависит от provider details напрямую.
  - Уменьшает risk vendor lock-in и повышает предсказуемость worker behavior.
- Область действия:
  - Epic 3 report generation path.

### Integration contract

- LLM adapter contract (infra):
  - input: transcript text + prompt template + schema + request metadata
  - output: `raw_text` + `provider_meta` (request id/model/token usage when available)
- Runtime validation:
  - Ajv v8 with strict schema behavior (`strict` enabled, `additionalProperties: false` in schema contract, no permissive coercion by default).
  - Schema compiled once at startup and reused.
- Failure behavior:
  - invalid JSON or schema mismatch:
    - сохранить `raw_llm_output.json` в S3,
    - пометить file/job как `failed`,
    - записать `error_code` (`schema_validation_failed` / `llm_output_invalid_json`).
  - debug mode:
    - сохранять raw output даже при success.
- Timeout/retry layering:
  - provider client timeout (например, OpenAI `timeout`) + bounded provider retries.
  - outer job retries governed by ADR-0010, чтобы не получить unbounded nested retries.

## Consequences

- Плюсы после принятия решения
  - Строгий и воспроизводимый pipeline генерации отчетов.
  - Лучшая тестируемость через fixture-driven unit tests.
  - Прозрачный incident-debugging благодаря raw output capture.
- Минусы / долг / ограничения
  - Нужно поддерживать compatibility между prompt и schema versions.
  - Возможно двойное влияние retries (provider + job), требует аккуратной настройки.
- Что нужно мониторить в следующих PR
  - долю schema validation failures.
  - latency/timeout profile LLM вызовов.

## Rollback plan

- Триггеры для пересмотра
  - Ajv strict режим блокирует допустимые эволюции схемы без value.
  - Требуется иная structured-output стратегия под нового провайдера.
- Как откатываемся
  - Новый ADR с обновлением validator strategy (например JTD/alternate validator) при сохранении adapter boundary.
- Какие артефакты/доки нужно обновить при откате
  - `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`
  - `SECURITY.md`
  - `RELIABILITY.md`
