# Execution Plan: PR-4.4 — File details overlay (v0-like modal, RU states, safe errors)

## Goal

- Привести details overlay на `GET /app` к v0-like modal/card структуре без изменения API-контрактов, маршрутов и polling-логики.
- Обеспечить человекочитаемые RU-состояния overlay: `loading`, `processing`, `success`, `failed`, `not found`.
- Сохранить безопасный рендер `error_code`/`error_message` только как plain text.

## Non-goals

- Изменение backend/domain логики, статусов файла, интервалов polling и условий его остановки.
- Изменение механики открытия overlay (текущие click handlers/идентификаторы/селекторы).
- Добавление новых endpoint или отдельной страницы деталей файла.

## Assumptions / research inputs

- Текущий UI реализован как server-rendered HTML + inline script в `interfaces/http/server.ts`.
- Текущие overlay API остаются прежними: `GET /api/files/:id`, `GET /api/files/:id/report`.
- External research (MCP Context7):
  - `/nodejs/node` (`timers`) подтверждает корректный паттерн: poll callback от `setTimeout` должен отменяться через `clearTimeout` при закрытии overlay, чтобы исключить фоновые вызовы после закрытия.

## Test-first plan

- Изменение относится к UI/верстке и клиентскому сценарию overlay; применяем UI-first с обязательным расширением regression тестов после правок.
- Обновить тесты в `interfaces/http/server.test.ts`:
  - HTML assertions новой структуры overlay и RU-копирайта.
  - Script behavior assertions: loading/processing/success/failed/not-found.
  - Закрытие overlay через кнопку, `Esc`, backdrop и проверка, что poll timer cleanup работает.
- Negative cases checklist (в рамках существующих API ответов):
  - [x] `404` file not found
  - [x] `409` report not ready
  - [x] `5xx` fallback ошибки загрузки метаданных/отчета

## Steps

1. Overlay markup + styling refresh
   - Обновить HTML структуру overlay в `interfaces/http/server.ts` под card/modal.
   - Добавить/обновить UI классы в `interfaces/http/ui/tokens.ts` для секций, header/footer, безопасного читаемого контента ошибок.
2. Overlay script RU states + safe rendering
   - Перестроить рендер состояния через отдельные секции (`Метаданные`, `Статус`, `Ошибка`) с RU-copy.
   - Сохранить polling flow/interval и текущие id/selectors открытия.
   - Убедиться, что серверные поля выводятся только через `textContent`.
3. Regression tests + checks
   - Обновить `interfaces/http/server.test.ts` под новый UI и сценарии закрытия/cleanup.
   - Прогнать `./scripts/typecheck.sh` и `./scripts/test.sh`.

## Risks & mitigations

- Risk: регрессия в открытии overlay по клику строки таблицы.
  - Mitigation: сохранить существующий open handler и id узлов, расширить script-harness тесты.
- Risk: утечка poll timer после закрытия overlay.
  - Mitigation: централизованный `stopOverlayPolling()` в `closeOverlay()` и проверка тестом, что после закрытия таймер не вызывает повторные fetch.
- Risk: небезопасный вывод `error_message`.
  - Mitigation: только `textContent`, без `innerHTML` для данных API.

## Test plan

- `./scripts/typecheck.sh`
- `./scripts/test.sh`
- Manual smoke:
  - `/app` -> клик по строке -> overlay.
  - Закрытие overlay: `Закрыть`, `Esc`, backdrop.
  - Состояния: processing/failed/success/not-found.

## Docs to update

- `docs/03_execution_plans/2026-03-02_pr-4-4-file-details-overlay-v0-ru.md`
- `docs/03_execution_plans/README.md`
- `docs/00_index/README.md`
