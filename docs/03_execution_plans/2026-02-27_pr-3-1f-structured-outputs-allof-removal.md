# Execution Plan: PR-3.1f Structured Outputs allOf removal for report_v2

## Goal

- Устранить `400 Invalid schema ... 'allOf' is not permitted` для `report_v2` в OpenAI Structured Outputs strict.
- Сохранить бизнес-семантику `missing_questions.items.status` (только `missing|not_discussed`) без использования `allOf`.

## Non-goals

- Изменение общей структуры report payload.
- Изменение worker retry/backoff/pipeline.
- Миграции БД или API изменений.

## Assumptions

- OpenAI Structured Outputs поддерживает subset JSON Schema; `allOf` в текущем strict request отклоняется провайдером.
- Ajv-валидация итогового отчета должна остаться эквивалентной текущей логике.

## Test-first plan

- Add tests before implementation:
  - `infra/processing/schema_normalizer.test.ts`: нормализованная `v2` schema не содержит `allOf`.
  - `infra/processing/report_schema_validator.test.ts`: `missing_questions[].status="present"` невалиден для `v2`.
- Negative cases checklist:
  - [ ] authz (`401/403`) — N/A
  - [x] validation (`400`) — покрывается schema/validator regression
  - [ ] not found (`404`) — N/A
  - [ ] revoked/expired (`410`) — N/A
  - [ ] rate limit (`429`) — N/A
- Acceptance criteria -> tests mapping:
  - `OpenAI strict input schema has no allOf` -> `schema_normalizer.test.ts`
  - `missing_questions status restriction preserved` -> `report_schema_validator.test.ts`

## Steps (PR-sized)

1. Test-first regressions
   - Scope: добавить 2 теста на отсутствие `allOf` и на валидацию restricted status.
   - Checks: `npx tsx --test infra/processing/schema_normalizer.test.ts infra/processing/report_schema_validator.test.ts`

2. Schema refactor
   - Scope: заменить `allOf` в `schemas/report/v2.json` на `$defs/MissingQuestionField` без allOf.
   - Expected output: contract semantically equivalent for validator, strict-compatible for provider.

3. Prompt contract sync
   - Scope: обновить schema-фрагмент в `prompts/prompt.txt` синхронно с `v2.json`.

4. Verification
   - Checks: `npx tsx --test infra/processing/schema_normalizer.test.ts infra/processing/report_schema_validator.test.ts infra/processing/llm_adapter.test.ts && npm run typecheck`

## Test plan

- `npx tsx --test infra/processing/schema_normalizer.test.ts`
- `npx tsx --test infra/processing/report_schema_validator.test.ts`
- `npx tsx --test infra/processing/llm_adapter.test.ts`
- `npm run typecheck`

## Risks & mitigations

- Risk: потеря ограничения по `missing_questions.status`.
  - Mitigation: отдельный валидаторный тест на запрет `present`.

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-3-1f-structured-outputs-allof-removal.md`
