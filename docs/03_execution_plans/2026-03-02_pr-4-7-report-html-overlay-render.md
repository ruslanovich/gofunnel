# Execution Plan: PR-4.7 — HTML render for report overlay (JSON -> readable page)

## Goal

- Отрисовывать отчёт в overlay на `/app` как структурированную HTML-страницу, а не как сырой `JSON.stringify` текст.
- Сохранить текущие API контракты и маршруты (`GET /api/files/:id/report` остаётся JSON).

## Non-goals

- Изменения backend/domain/report schema.
- Добавление новых endpoints или смена формата API ответа.

## Assumptions / research inputs

- Текущий overlay уже получает JSON отчёта и рендерит его в `<pre>`.
- External research (MCP Context7, MDN): безопасная вставка внешних данных через `createElement` + `textContent`; не использовать небезопасный `innerHTML` для untrusted payload.

## Steps

1. Заменить текстовый блок отчёта на контейнер HTML-view.
2. Добавить клиентский рекурсивный renderer для JSON (object/array/scalar) в overlay script.
3. Оставить sanitization (`raw_llm_output` удалить) и безопасный рендер через DOM APIs.
4. Добавить стили для report-view и обновить тесты (`server.test.ts`).

## Risks & mitigations

- Risk: XSS при рендере значений отчёта.
  - Mitigation: только `textContent` и `createElement`, без `innerHTML` данных.
- Risk: регрессия текущих overlay состояний loading/processing/error.
  - Mitigation: не трогать state-машину, менять только ветку успешного рендера отчёта.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- Проверка overlay success path: отчёт рендерится как HTML-блок и скрывает `raw_llm_output`.

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-7-report-html-overlay-render.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
