# PR-3.1i: LLM transport root-cause diagnostics (undici/fetch)

## Goal

- Снять недвусмысленные признаки первопричины LLM transport ошибок: логировать точные коды/типы ошибок на уровне fetch/undici (`UND_ERR_*`, `ECONNRESET`, `AbortError` и nested cause chain).
- Убрать маскирование первопричины верхним таймаутом адаптера на время диагностики.
- Включать OpenAI SDK debug логирование для одного прогона через env.

## Non-goals

- Изменение бизнес-логики отчета или схемы.
- Изменение retry/backoff политики воркера.

## Assumptions / research inputs

- Local research:
  - В `infra/processing/llm_adapter.ts` есть верхний `withTimeout(...)`, который может возвращать `llm_timeout`, скрывая low-level cause.
  - В `infra/processing/openai_provider.ts` уже есть transport telemetry по attempt, но нет fetch-level error event с undici-specific codes.
- External research:
  - OpenAI SDK timeout реализован через `AbortController` в `fetchWithTimeout`.
  - Undici ошибки имеют коды вида `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_ABORTED`, `UND_ERR_SOCKET`.

## Test-first plan

- Update `infra/processing/llm_adapter.test.ts` before implementation:
  - `llm adapter can disable outer timeout via env`: provider отвечает позже request timeout, но при `LLM_DISABLE_OUTER_TIMEOUT=true` ошибка outer-timeout не возникает.
  - `openai provider emits http transport error diagnostics`: provider эмитит event с кодами из error/cause chain.
- Negative cases checklist:
  - [x] authz (`401/403`) — N/A
  - [x] validation (`400`) — N/A
  - [x] not found (`404`) — N/A
  - [x] revoked/expired (`410`) — N/A
  - [x] rate limit (`429`) — N/A

## Steps (PR-sized)

1. Tests first
   - Scope: добавить тесты на outer-timeout flag и fetch-level error diagnostics events.
   - Checks: `npx tsx --test infra/processing/llm_adapter.test.ts`
2. Implement diagnostics + controls
   - Scope:
     - add fetch error telemetry event with detailed error/cause chain;
     - add env switch to disable outer adapter timeout;
     - add worker env option to pass OpenAI log level.
   - Checks: `npx tsx --test infra/processing/llm_adapter.test.ts`, `npm run typecheck`
3. Ops run configuration
   - Scope: set one-run env values in `.env.local`, restart services, verify logs.
   - Checks: manual run + worker log evidence.

## Test plan

- `npx tsx --test infra/processing/llm_adapter.test.ts`
- `npm run typecheck`
- `python3 scripts/docs_index_check.py`
- Manual smoke:
  - worker logs include `openai_http_error` with cause codes;
  - no `llm_timeout` from outer adapter when disabled.

## Risks & mitigations

- Risk: noisy logs.
  - Mitigation: compact fields + truncation.
- Risk: disabling outer timeout may increase wait on stuck calls.
  - Mitigation: keep provider timeout enabled and use flag only for diagnostics run.

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-3-1i-llm-transport-root-cause-diagnostics.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
