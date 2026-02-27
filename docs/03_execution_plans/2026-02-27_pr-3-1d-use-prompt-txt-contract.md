# Execution Plan: PR-3.1d Use prompt.txt Contract (instruction + schema)

## Goal / scope

- Сделать источником активного LLM-контракта содержимое `prompts/prompt.txt`:
  - текстовую инструкцию (prompt)
  - Structured Outputs JSON schema
- Переключить активные версии prompt/schema на новый контракт.
- Гарантировать, что strict normalizer применяется к пользовательской схеме перед отправкой в OpenAI.

## Non-goals

- Изменения UI/API маршрутов.
- Изменение retry/backoff политики worker.
- Изменение бизнес-логики анализа помимо смены контракта prompt/schema.

## Assumptions / research inputs

- Архитектурный выбор не меняется (ADR-0011 остаётся валидным), новый ADR не нужен.
- External research (Context7):
  - `/openai/openai-node` structured outputs request shape with `text.format.{type,name,schema,strict}`
  - `/ajv-validator/ajv` guidance for draft-specific Ajv initialization (`ajv/dist/2019`/draft-aware setup)

## Steps (PR-sized)

1. Test-first updates
   - Update tests for active default versions (`v2`) in `infra/processing/llm_adapter.test.ts`.
   - Add normalizer test asserting behavior on `schemas/report/v2.json`.

2. Contract extraction + activation
   - Extract `transcript_analysis` to `prompts/report/v2.txt`.
   - Extract `transcript_analysis_so` to `schemas/report/v2.json`.
   - Switch active versions to `v2` in `app/processing/report_contract.ts`.

3. Validator/runtime compatibility checks
   - Ensure schema validator can load/compile `v2` schema for runtime usage.
   - Keep strict normalizer wiring unchanged; verify on `v2` through tests.

4. Docs/index updates
   - Add this plan into `docs/00_index/README.md`.

## Risks & mitigations

- Risk: Large schema may fail strict validation toolchain.
- Mitigation: add explicit tests for v2 schema load/normalization and run full test suite.

## Test plan

- `npx tsx --test infra/processing/llm_adapter.test.ts`
- `npx tsx --test infra/processing/schema_normalizer.test.ts`
- `npx tsx --test infra/processing/report_schema_validator.test.ts`
- `./scripts/test.sh`

## Docs to update

- `docs/00_index/README.md`
