# Execution Plan: PR-3.1b OpenAI Provider Default (gpt-5-mini)

## Goal

- Добавить production-ready OpenAI provider в существующий `llm_adapter` контракт и сделать `openai` провайдером по умолчанию вне тестовой среды.

## Non-goals

- Изменения pipeline контрактов (`report_pipeline_processor`, worker state machine).
- UI/API изменения.
- Реальные network-вызовы в тестах.

## Assumptions

- Scope ограничен follow-up шагом к Epic 3 PR-3.1.
- Архитектурная граница provider-agnostic adapter остаётся неизменной (ADR-0011).
- Классификация retriable/fatal ошибок должна соответствовать ADR-0010.
- External research (Context7, official docs):
  - OpenAI Node SDK structured outputs + parse helpers: `/openai/openai-node` (`helpers.md`)
  - OpenAI Node SDK timeout/retry/error classes: `/openai/openai-node` (`README.md`)

## Test-first plan

- Update/add tests before implementation in `infra/processing/llm_adapter.test.ts`:
  - provider selection defaults:
    - non-test + unset `LLM_PROVIDER` -> `openai`
    - test + unset `LLM_PROVIDER` -> `fake`
    - production + `LLM_PROVIDER=fake` -> fail fast
    - production + openai + missing key -> fail fast
  - OpenAI error classification mapping:
    - `429` -> retriable
    - `5xx` -> retriable
    - timeout/network -> retriable
    - other `4xx` -> non-retriable
- Negative cases checklist:
  - [ ] authz (`401/403`) not in scope
  - [x] validation (`400`) classification covered as non-retriable provider error
  - [ ] not found (`404`) endpoint semantics not in scope
  - [ ] revoked/expired (`410`) endpoint semantics not in scope
  - [x] rate limit (`429`) retriable classification covered
- Acceptance criteria -> tests mapping:
  - default provider behavior -> config selection tests
  - production fail-fast guardrails -> config validation tests
  - retry taxonomy compliance -> provider classifier tests

## Steps (PR-sized)

1. Add/adjust failing tests for provider selection and error classification
   - Scope:
     - `infra/processing/llm_adapter.test.ts`
   - Expected output:
     - tests describe new config policy and retry taxonomy without network.
   - Checks:
     - `npx tsx --test infra/processing/llm_adapter.test.ts`

2. Implement OpenAI provider and config defaults
   - Scope:
     - `infra/processing/llm_adapter.ts`
     - new provider module in `infra/processing/`
     - `interfaces/cli/worker_start.ts` provider registry
   - Expected output:
     - openai provider available by key `openai`
     - non-test default provider is `openai`
     - production guardrails enforced
     - structured JSON output path integrated with fallback.
   - Checks:
     - `npm run typecheck`
     - `npx tsx --test infra/processing/llm_adapter.test.ts`

3. Update operational docs and env examples
   - Scope:
     - `.env.example`
     - `RELIABILITY.md`
     - `SECURITY.md`
   - Expected output:
     - env keys and retry/security notes aligned with implementation.
   - Checks:
     - `python3 scripts/docs_index_check.py`

## Test plan

- Automated:
  - `npx tsx --test infra/processing/llm_adapter.test.ts`
  - `npm run typecheck`
- Optional full suite if env is ready:
  - `./scripts/test.sh`

## Risks & mitigations

- Risk:
  - Nested retries (SDK + worker) can amplify delays.
  - Mitigation:
    - disable SDK auto-retries (`maxRetries: 0`) and keep retry policy centralized in worker (ADR-0010).
- Risk:
  - Structured output parsing regressions on model/version changes.
  - Mitigation:
    - keep raw text for diagnostics and preserve downstream Ajv validation gate.

## Docs to update

- `RELIABILITY.md`
- `SECURITY.md`
- `.env.example`
