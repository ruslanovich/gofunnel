# Execution Plan: DX Harness Typecheck Wiring

## Goal

- Подключить реальный TypeScript typecheck в `./scripts/typecheck.sh`, чтобы репозиторный harness выполнял `npm run typecheck` и корректно падал при ошибках.

## Non-goals

- Любые изменения продуктовой логики, HTTP endpoints, UI.
- Изменение контрактов API или доменных правил.

## Assumptions / research inputs

- Local research:
  - `package.json` уже содержит `"typecheck": "tsc --noEmit"`.
  - `scripts/typecheck.sh` сейчас заглушка.
  - `scripts/test.sh` запускает тесты напрямую, без typecheck.
- External research (Context7, npm docs):
  - `npm run <script>` возвращает ошибку, если скрипт отсутствует (по умолчанию `if-present=false`).
  - Ошибка внутри запускаемого скрипта прокидывается в exit code `npm run`, что подходит для CI/harness.

## Test-first plan

- Поведенческий контракт продукта не меняется; добавление функциональных тестов не требуется.
- Проверки для PR: запуск `./scripts/typecheck.sh`, `./scripts/test.sh`, `python3 scripts/repo_lint.py`, `python3 scripts/docs_index_check.py`.

## Steps (PR-sized)

1. Wire typecheck harness script
   - Scope:
     - Обновить `scripts/typecheck.sh` с запуском `npm run typecheck` и понятным сообщением при отсутствии `npm`.
   - Expected output:
     - Скрипт возвращает non-zero при ошибке typecheck/отсутствии `npm`.
   - Checks:
     - `./scripts/typecheck.sh`
2. Keep test harness consistent
   - Scope:
     - Убедиться, что `scripts/test.sh` вызывает `scripts/typecheck.sh` последовательно перед тестами.
   - Expected output:
     - Единый вход в проверки через `./scripts/test.sh`.
   - Checks:
     - `./scripts/test.sh`
3. Update docs wording
   - Scope:
     - Уточнить в `CONTRIBUTING.md` команду typecheck.
   - Expected output:
     - Вкладчики видят canonical команду `./scripts/typecheck.sh`.
   - Checks:
     - `python3 scripts/repo_lint.py`
     - `python3 scripts/docs_index_check.py`

## Risks & mitigations

- Risk: CI/локальный запуск без установленного Node/npm.
  - Mitigation: явная проверка `npm` в `scripts/typecheck.sh` с понятным текстом ошибки.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- `python3 scripts/repo_lint.py`
- `python3 scripts/docs_index_check.py`

## Docs to update

- `CONTRIBUTING.md`
- `docs/03_execution_plans/2026-02-27_pr-dx-typecheck-harness.md`
