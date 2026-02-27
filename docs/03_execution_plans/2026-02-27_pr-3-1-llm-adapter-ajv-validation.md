# Execution Plan: PR-3.1 LLM Adapter + Ajv Validation Layer

## Goal

- Добавить provider-agnostic LLM adapter abstraction и strict JSON schema validation слой (Ajv) с версиями prompt/schema и unit tests на фикстурах.

## Non-goals

- Интеграция в worker loop и job claiming.
- Запись `report.json`/`raw_llm_output.json` в S3.
- UI/API изменения для чтения/отображения отчета.

## Assumptions

- Scope ограничен Epic 3 step `PR-3.1` из `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`.
- Архитектурный выбор уже зафиксирован в `docs/05_decisions/2026-02-27_adr-0011_llm-schema-validation-integration.md`.
- External research (official docs via Context7):
  - Ajv strict compile/validation/errors: `/ajv-validator/ajv`
  - OpenAI Node timeout/retry/error classes: `/openai/openai-node`

## Test-first plan

- Добавить тесты validator-а на фикстурах до реализации:
  - valid JSON -> success.
  - invalid JSON -> `schema_validation_failed` + concise summary.
- Добавить тесты LLM adapter-а с fake provider (без сети):
  - success path (`rawText` + `parsedJson`).
  - retriable/fatal error classification.
  - timeout mapping hook coverage.
- Negative cases checklist:
  - [ ] authz (`401/403`) not in scope этого PR
  - [x] validation (`400`) represented as schema validation failure in processing layer
  - [ ] not found (`404`) not in scope этого PR
  - [ ] revoked/expired (`410`) not in scope этого PR
  - [ ] rate limit (`429`) mapped as retriable classification in adapter tests
- Acceptance criteria -> tests mapping:
  - strict schema gate -> `report_schema_validator.test.ts`
  - provider abstraction + error mapping -> `llm_adapter.test.ts`

## Steps (PR-sized)

1. Add test fixtures + failing unit tests
   - Scope:
     - `schemas/report/v1.json`, `prompts/report/v1.txt`, fixtures.
     - Validator and adapter tests before implementation.
   - Expected output:
     - Tests encode expected contracts for pass/fail/error taxonomy.
   - Checks:
     - `npm run test` (expected red before implementation).

2. Implement adapter + validation modules
   - Scope:
     - LLM adapter interface, env config, provider registry with fake/no-network path.
     - Ajv strict validator with single compile and sanitized errors.
     - Prompt/schema version resolver constants for MVP.
   - Expected output:
     - Passing tests for adapter and validator.
   - Checks:
     - `npm run test`
     - `npm run typecheck`

3. Update docs and epic progress notes
   - Scope:
     - `SECURITY.md`, `RELIABILITY.md`, Epic 3 execution plan progress note.
   - Expected output:
     - Security/reliability behavior documented for raw output and schema failures.
   - Checks:
     - `python3 scripts/docs_index_check.py`

## Test plan

- Automated:
  - `npm run test`
  - `npm run typecheck`
- Docs consistency:
  - `python3 scripts/docs_index_check.py`

## Risks & mitigations

- Risk:
  - Overly verbose validator errors leak sensitive fragments.
  - Mitigation:
    - sanitize and truncate error summary; never include full raw output in logs.
- Risk:
  - Ambiguous retriable classification for provider errors.
  - Mitigation:
    - explicit classifier hook in adapter contract + unit tests for baseline taxonomy.

## Docs to update

- `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`
- `SECURITY.md`
- `RELIABILITY.md`
