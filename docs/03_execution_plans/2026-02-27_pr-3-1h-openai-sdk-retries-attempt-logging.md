# PR-3.1h: OpenAI SDK retries + retry-attempt logging

## Goal

- Включить SDK-ретраи OpenAI (`maxRetries=2`) для снижения доли `llm_network_error` при плавающих `ECONNRESET`.
- Добавить явную телеметрию попыток HTTP-запроса к LLM, чтобы видеть динамику ретраев в логах воркера.

## Non-goals

- Перепроектирование pipeline/очереди.
- Изменение backoff-политики воркера.
- Переход на streaming-режим или смена модели.

## Assumptions

- Обрыв TCP около 60 секунд может быть внешним (middlebox/provider edge), и SDK-ретраи помогут только при временных сбоях.
- OpenAI Node SDK поддерживает `maxRetries` и custom `fetch` для клиентской инструментализации попыток.
- Research inputs:
  - OpenAI Node SDK README (retries/timeout/fetch): https://github.com/openai/openai-node/blob/master/README.md
  - Context7 library: `/openai/openai-node`

## Test-first plan

- Update `infra/processing/llm_adapter.test.ts`:
  - `openai provider analyze uses structured output request and returns parsed JSON`
    - дополнить проверкой, что `createClient` получает `maxRetries=2`.
  - добавить тест на логирование retry-итераций на уровне provider callback:
    - контракт: provider эмитит события с номером попытки (`attempt`) при каждом HTTP attempt.
- Negative cases checklist:
  - [x] authz (`401/403`) — N/A для этого шага
  - [x] validation (`400`) — N/A для этого шага
  - [x] not found (`404`) — N/A для этого шага
  - [x] revoked/expired (`410`) — N/A для этого шага
  - [x] rate limit (`429`) — покрыто существующей классификацией, без изменения поведения
- Acceptance criteria -> tests mapping:
  - `SDK retries включены по умолчанию` -> `openai provider analyze uses structured output request and returns parsed JSON`
  - `Логи попыток видны` -> `openai provider emits http attempt telemetry`

## Steps (PR-sized)

1. Test updates
   - Scope: добавить/обновить unit tests для `maxRetries` и telemetry attempts.
   - Expected output: красные тесты до реализации.
   - Checks: `npx tsx --test infra/processing/llm_adapter.test.ts`
2. Provider implementation
   - Scope: включить `maxRetries=2`, добавить telemetry callback attempt-событий через custom fetch wrapper.
   - Expected output: зеленые unit tests.
   - Checks: `npx tsx --test infra/processing/llm_adapter.test.ts`, `npm run typecheck`
3. Worker wiring
   - Scope: подключить provider telemetry к существующему JSON-логированию воркера.
   - Expected output: в логах есть события `openai_http_attempt` с `attempt`.
   - Checks: `npm run typecheck`

## Test plan

- Автотесты:
  - `npx tsx --test infra/processing/llm_adapter.test.ts`
  - `npm run typecheck`
- Док-проверка:
  - `python3 scripts/docs_index_check.py`
- Manual smoke:
  - Запуск `npm run worker:start`, загрузка файла, проверка stderr-логов на `openai_http_attempt`.

## Risks & mitigations

- Risk: Увеличение количества API вызовов и стоимости при нестабильной сети.
  - Mitigation: ограничить `maxRetries=2`, наблюдать telemetry и корректировать.
- Risk: Логи станут шумными.
  - Mitigation: логировать компактно и только ключевые поля (`attempt`, `phase`, `model`, `schemaVersion`).

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-3-1h-openai-sdk-retries-attempt-logging.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
