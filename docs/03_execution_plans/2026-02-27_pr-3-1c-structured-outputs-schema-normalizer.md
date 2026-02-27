# Execution Plan: PR-3.1c Structured Outputs Schema Normalizer (strict compatibility)

## Goal / scope

- Устранить 400 от OpenAI Structured Outputs strict из-за неполного `required` в object schema.
- Добавить рекурсивный normalizer JSON Schema и использовать его перед отправкой `text.format` в OpenAI Responses API.
- Добавить unit-тесты normalizer и регрессию для `nextSteps.items.properties.dueDate`.
- Обновить reliability documentation (короткая operational note).

## Non-goals

- Изменения worker/pipeline/UI/API контрактов.
- Изменение бизнес-валидации Ajv или семантики report payload.
- Резолв `$ref` (только normalize узлов внутри `$defs`/`definitions`).

## Assumptions / research inputs

- Архитектурно это локальное infra-изменение, без нового ADR (рамка ADR-0011 сохраняется).
- OpenAI Structured Outputs strict ожидает object keys в `required`; optional значения должны быть выражены nullable-типами в самой схеме.
- External research (Context7): `/openai/openai-node` examples for structured outputs/strict JSON schema request shape.

## Steps (PR-sized)

1. Test-first: добавить тесты для schema normalizer
   - New file: `infra/processing/schema_normalizer.test.ts`
   - Проверки:
     - Для всех object nodes с `properties`: `required` покрывает все ключи properties.
     - Для тех же узлов `additionalProperties === false`.
     - Regression: `nextSteps.items.required` включает `dueDate`.

2. Реализация normalizer + wiring в OpenAI provider
   - New file: `infra/processing/schema_normalizer.ts`
   - Update: `infra/processing/openai_provider.ts`
   - Правила: рекурсия по `properties`, `items`, `prefixItems`, `oneOf/anyOf/allOf`, `$defs/definitions`; без мутаций типов/enum/format/minmax.

3. Документация
   - Update: `RELIABILITY.md`
   - Короткая заметка о strict-ограничении и nullable-optional policy.

## Risks & mitigations

- Risk: Непреднамеренное изменение схемы за пределами strict-совместимости.
- Mitigation: покрыть тестом инварианты по `properties`/`required` и точечную регрессию `dueDate`.

## Test plan

- `npx tsx --test infra/processing/schema_normalizer.test.ts`
- `npx tsx --test infra/processing/llm_adapter.test.ts`
- `npm run typecheck`

## Docs to update

- `RELIABILITY.md`
