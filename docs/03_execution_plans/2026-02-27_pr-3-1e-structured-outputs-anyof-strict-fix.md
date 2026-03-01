# Execution Plan: PR-3.1e Structured Outputs anyOf strict fix

## Goal

- Устранить `400 Invalid schema for response_format 'report_v2'` от OpenAI Structured Outputs strict.
- Сделать нормализатор схемы совместимым с anyOf-ветками, где используются `required`-only фрагменты.

## Non-goals

- Изменение продуктового контракта `schemas/report/v2.json`.
- Изменение Ajv-валидации финального отчета в pipeline.
- Изменение worker/API/UI поведения за пределами отправки schema в OpenAI provider.

## Assumptions

- Это локальное infra-изменение без нового ADR (в рамках ADR-0011).
- Для strict Structured Outputs каждый object-schema узел должен быть strict-compatible.
- External research: OpenAI Structured Outputs docs (Context7 `/websites/platform_openai`) подтверждают requirement по `additionalProperties: false` для object-узлов и strict subset ограничения для `anyOf`.

## Test-first plan

- Add/update tests before implementation:
  - `infra/processing/schema_normalizer.test.ts`:
    - добавить регрессию: normalizer не должен оставлять strict-incompatible `required`-only ветки внутри `anyOf` для `v2` schema.
- Negative cases checklist:
  - [ ] authz (`401/403`) — N/A (не auth flow)
  - [x] validation (`400`) — покрывается регрессией на schema normalization для OpenAI strict
  - [ ] not found (`404`) — N/A
  - [ ] revoked/expired (`410`) — N/A
  - [ ] rate limit (`429`) — N/A
- Acceptance criteria -> tests mapping:
  - `OpenAI strict schema no longer includes incompatible anyOf fragments` -> `schema_normalizer.test.ts` (new regression test)

## Steps (PR-sized)

1. Test-first regression
   - Scope: добавить тест на `v2` schema `Evidence.anyOf` после normalizer.
   - Expected output: тест падает на текущем коде.
   - Checks: `npx tsx --test infra/processing/schema_normalizer.test.ts`.

2. Normalizer fix
   - Scope: фильтрация strict-incompatible composition fragments (`anyOf/oneOf/allOf`) и cleanup пустых массивов.
   - Expected output: normalized schema проходит тест и не содержит problematic fragments.
   - Checks: `npx tsx --test infra/processing/schema_normalizer.test.ts`.

3. Verification
   - Scope: smoke проверка провайдера/типов.
   - Expected output: существующие LLM adapter/provider тесты зелёные.
   - Checks: `npx tsx --test infra/processing/llm_adapter.test.ts`, `npm run typecheck`.

## Test plan

- `npx tsx --test infra/processing/schema_normalizer.test.ts`
- `npx tsx --test infra/processing/llm_adapter.test.ts`
- `npm run typecheck`

## Risks & mitigations

- Risk: удалить нужные schema constraints из composition keywords.
  - Mitigation: удалять только required-only fragments (без schema shape keywords), остальные ветки оставлять без изменений.

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-3-1e-structured-outputs-anyof-strict-fix.md`
