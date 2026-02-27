# Execution Plan: PR-4.1 `/app` UI (upload + list + overlay + polling)

## Goal / scope

- Реализовать защищенную страницу `/app` для Epic 2, используя только существующие endpoints:
  - `POST /api/files/upload`
  - `GET /api/files`
  - `GET /api/files/:id`
- Собрать UI без новых backend API в рамках PR-4.1.

## Non-goals

- Любая обработка отчетов/LLM (Epic 3).
- Новые DB миграции и backend контракты.
- Realtime/websocket/subscription transport.

## Assumptions / research inputs

- Базовый transport/UI паттерн в проекте: server-rendered HTML + inline browser script (`interfaces/http/server.ts`).
- Auth guards уже реализованы на `/app` и `/api/files*`.
- External research (Context7, MDN):
  - `input[type=file][accept]` ограничивает выбор в picker, но не заменяет серверную валидацию.
  - `fetch` + `FormData` является стандартным способом multipart upload в браузере.
  - `413 Content Too Large` — ожидаемый код для oversize upload и должен иметь user-friendly UX.

## Steps (PR-sized)

1. Добавить минимальные тесты (UI smoke + upload/list regression).
2. Реализовать `/app` dashboard UI:
   - upload control (`.txt/.vtt`) + disabled state + `Uploading...`
   - files list (`limit=20`) + `Load more` по `next_cursor`
   - polling refresh первой страницы (интервал 5–10 секунд)
   - overlay по row click с деталями файла и placeholder Epic 3
   - client-side validation ошибок: unsupported type, `413`
3. Обновить документацию:
   - progress notes в Epic 2 плане
   - manual verification шаги в runbook

## Risks & mitigations

- Risk: polling может перезаписывать локально подгруженные дополнительные страницы.
  - Mitigation: polling обновляет только первую страницу и не конфликтует с owner-scope API контрактом.
- Risk: UX ошибки при несовпадении MIME/ext.
  - Mitigation: client-side проверка extension + server-side валидация как source of truth.

## Test plan

- `npm run test`
- `npm run typecheck`
- Manual smoke:
  - upload `.txt/.vtt`
  - invalid extension rejection без network upload
  - list first page + load more
  - overlay details + placeholder text
  - `413` UX message `File too large`

## Docs to update

- `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md` (progress notes)
- `docs/04_runbooks/yandex_object_storage.md` (manual verification)
