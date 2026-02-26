# Execution Plan Template

Используйте имя файла: `YYYY-MM-DD_<slug>.md`

## Goal

- Какой результат должен быть достигнут

## Non-goals

- Что в этот план не входит

## Assumptions

- Технические и продуктовые допущения
- Ссылки на ADR / research notes / внешнюю документацию

## Test-first plan

- List of tests to add/update before implementation.
- For each test: what contract it asserts + expected status codes/side effects.
- Negative cases checklist:
  - [ ] authz (`401/403`)
  - [ ] validation (`400`)
  - [ ] not found (`404`)
  - [ ] revoked/expired (`410`)
  - [ ] rate limit (`429`)
- Acceptance criteria -> tests mapping:
  - `<criterion>` -> `<test name(s)>`

## Steps (PR-sized)

1. Step name
   - Scope:
   - Expected output:
   - Checks:
2. Step name
   - Scope:
   - Expected output:
   - Checks:

## Test plan

- Какие тесты/проверки выполняются по шагам
- Что проверяется вручную (если нужно)

## Risks & mitigations

- Risk:
  - Mitigation:

## Docs to update

- `docs/...`
- `AGENTS.md` / `ARCHITECTURE.md` / ADR / runbook (если применимо)
