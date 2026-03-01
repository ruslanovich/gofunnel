# Execution Plan: PR-4.8 — Report overlay visual relayout (day theme)

## Goal

- Довести визуализацию отчёта в overlay `/app` до аккуратного карточного вида по референсу `report_relayout.html`.
- Сохранить текущую светлую тему приложения и существующие API-контракты.

## Non-goals

- Изменения backend/API/domain/report schema.
- Новые роуты, новые запросы, изменение поведения polling/submit/admin actions.

## Assumptions / research inputs

- Отчёт уже приходит JSON из `GET /api/files/:id/report`.
- Текущий рендер безопасный (DOM API, без `innerHTML` для untrusted payload).
- External research (MCP Context7, MDN `/mdn/content`):
  - `createElement` + `textContent` — безопасный путь рендера внешних данных.
  - `details/summary` подходит для disclosure-секций и многоуровневой структуры.

## Steps

1. Добавить UI copy-словарь для отчётных секций/полей/enum-значений.
2. Пересобрать report renderer в `interfaces/http/server.ts`:
   - header summary,
   - section cards,
   - key-value rows,
   - chips для scalar arrays,
   - disclosure blocks для вложенных структур.
3. Обновить `interfaces/http/ui/tokens.ts` под day-theme relayout без изменения общей дизайн-системы.
4. Прогнать тесты и smoke-проверку overlay report path.

## Risks & mitigations

- Risk: XSS в рендере отчёта.
  - Mitigation: только `createElement`/`textContent`, без `innerHTML` данных отчёта.
- Risk: регрессия существующих overlay state paths.
  - Mitigation: не менять state-машину; менять только ветку визуального рендера `succeeded`.
- Risk: brittle UI assertions в тестах.
  - Mitigation: проверять стабильные инварианты (контент + class markers), без привязки к точному DOM-layout.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- `python3 scripts/docs_index_check.py`

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-8-report-overlay-visual-relayout-day-theme.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
