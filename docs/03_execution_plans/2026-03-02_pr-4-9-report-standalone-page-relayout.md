# Execution Plan: PR-4.9 — Report standalone HTML page relayout (share + app route)

## Goal

- Вынести standalone HTML renderer отчёта в отдельный модуль и применить его в HTTP endpoints отчёта.
- Довести структуру/визуал страницы отчёта до эталона `report_relayout.html` (карточки, TOC, details, печать, expand/collapse).
- Сохранить текущие API/domain contracts: `GET /api/files/:id/report` остаётся JSON без изменений.

## Non-goals

- Изменения app/domain/infra контрактов, DB schema и worker pipeline.
- Изменение формата JSON отчёта.
- Переписывание всей `/app` overlay state-машины.

## Assumptions / research inputs

- На текущий момент `/share/:token` и `/files/:id/report` уже отдают standalone HTML через `render_report_page.ts`; основной remaining scope — schema-aware relayout до эталона `report_relayout.html`.
- External research (MCP Context7):
  - MDN `/mdn/content`: для untrusted строк использовать `createElement` + `textContent`; избегать `innerHTML`.
  - Node.js `/nodejs/node`: для HTML-ответа использовать `Content-Type: text/html; charset=utf-8`.

## Steps

1. Добавить новый модуль `interfaces/http/report_ui/render_report_page.ts`:
   - `renderReportDocument(...) => string` (полный `<!doctype html>` документ).
   - helpers: `escapeHtml`, `renderText`, `renderList`, `renderMaybe`.
   - layout: header/topbar/toolbar, TOC `#meta/#passport/#deal/#pilot/#product`, section cards, details/summary, print styles, footer.
2. Реализовать адаптер JSON -> section model:
   - маппинг известных секций (`meta`, `passport`, `deal_track`, `pilot_poc`, `product_track`);
   - fallback на missing values (`не указано`/`не зафиксировано`);
   - unknown blocks через collapsed `Raw JSON`.
3. Интегрировать renderer в HTTP endpoints:
   - `/share/:token` — отдавать standalone report HTML вместо placeholder;
   - добавить auth-protected HTML route отчёта по `fileId` для app-view (без изменения JSON endpoint).
4. Обновить тесты:
   - проверка `<!doctype html>`, TOC anchors, toolbar + `window.print`, `<details>`;
   - XSS guard: payload со `<script>` отображается как escaped text;
   - share route больше не placeholder.

## Risks & mitigations

- Risk: XSS в HTML template renderer.
  - Mitigation: централизованный `escapeHtml` для всех строк из отчёта + тест на `<script>`.
- Risk: недоступный отчёт по share `reportRef` (вариативные данные/legacy refs).
  - Mitigation: graceful fallback с meta/reportRef и отсутствующими полями без падения endpoint.
- Risk: регрессия существующих JSON API tests.
  - Mitigation: не менять `/api/files/:id/report` flow, добавить только HTML transport ветки.

## Test plan

- `./scripts/typecheck.sh`
- `npx tsx --test interfaces/http/server.test.ts`
- `python3 scripts/docs_index_check.py`

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-9-report-standalone-page-relayout.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
