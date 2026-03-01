# Execution Plan: PR-3.1g OpenAI network error diagnostics

## Goal

- Повысить диагностичность `llm_network_error`/`llm_timeout` в worker pipeline.
- Сохранять в `error_message` компактный сетевой контекст (например `code=ECONNRESET`, `cause_code=ETIMEDOUT`) вместо только общего `Connection error.`.

## Non-goals

- Изменение retry/backoff политики.
- Изменение статусов job/file или лимитов попыток.
- Изменение API контрактов report payload.

## Assumptions

- Ошибки OpenAI transport слоя классифицируются в `infra/processing/openai_provider.ts`.
- OpenAI Node SDK пробрасывает сетевые ошибки как `APIConnectionError` / `APIConnectionTimeoutError` и/или с кодами (`ECONNRESET`, `ETIMEDOUT`, ...).
- External research: OpenAI Node docs (Context7 `/openai/openai-node`) подтверждают отдельные connection error классы.

## Test-first plan

- Add tests before implementation:
  - `infra/processing/llm_adapter.test.ts`:
    - provider классификация network error включает диагностический код в `errorSummary`.
- Negative cases checklist:
  - [ ] authz (`401/403`) — N/A
  - [x] validation (`400`) — N/A (изменение диагностики, не payload validation)
  - [ ] not found (`404`) — N/A
  - [ ] revoked/expired (`410`) — N/A
  - [ ] rate limit (`429`) — N/A
- Acceptance criteria -> tests mapping:
  - `network error contains code context` -> new `llm_adapter.test.ts` assertion

## Steps (PR-sized)

1. Test-first regression
   - Scope: добавить тест на диагностический суффикс в summary сетевой ошибки.

2. Implementation
   - Scope: обновить `sanitizeSummary` и ветки `APIConnectionError/APIConnectionTimeoutError` в OpenAI provider.

3. Verification
   - Checks: `npx tsx --test infra/processing/llm_adapter.test.ts` + `npm run typecheck`.

## Test plan

- `npx tsx --test infra/processing/llm_adapter.test.ts`
- `npm run typecheck`

## Risks & mitigations

- Risk: слишком многословные сообщения ошибок.
  - Mitigation: compact формат + existing 280-char limit.
- Risk: утечка лишних деталей ошибки в UI.
  - Mitigation: включать только технич. коды/метки (без payload/body).

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-3-1g-openai-network-error-diagnostics.md`
- `docs/00_index/README.md`
- `docs/03_execution_plans/README.md`
