# Execution Plan: PR-4.1b Overlay polling + processing metadata

## Goal

- Улучшить UX overlay в `/app` для несостоявшегося yet report:
  - авто-polling статуса после открытия файла;
  - отображение диагностики обработки (`attempt`, `last_error`, `next_run_at`) прямо в overlay.
- Применить оперативный фикс локального окружения: увеличить `WORKER_LLM_TIMEOUT_MS` и перезапустить worker.

## Non-goals

- Изменение retry/backoff алгоритма worker.
- Изменение лимитов `max_attempts` или DB schema migrations.
- Realtime/WebSocket.

## Assumptions

- Worker retry loop уже работает штатно; проблема UX — отсутствие автообновления overlay.
- `/api/files/:id` можно расширить безопасными processing metadata полями.
- External research (Context7 `/mdn/content`): для polling предпочтителен управляемый цикл (`setTimeout`) и отмена pending работы (clearTimeout/AbortController pattern).

## Test-first plan

- Add/update tests before implementation:
  - `interfaces/http/server.test.ts`:
    - `files details` payload includes processing metadata fields.
    - app overlay: processing state shows metadata and transitions via polling to terminal state.
- Negative cases checklist:
  - [ ] authz (`401/403`) — уже покрыто, не меняется
  - [x] validation (`400`) — API contract regression coverage for file details endpoint
  - [ ] not found (`404`) — уже покрыто, не меняется
  - [ ] revoked/expired (`410`) — N/A
  - [ ] rate limit (`429`) — N/A
- Acceptance criteria -> tests mapping:
  - `overlay auto-refreshes without reopen` -> new dashboard script harness test
  - `attempt/last_error/next_run_at visible` -> new dashboard script harness test + file details API test

## Steps (PR-sized)

1. API contract extension for file details
   - Scope: добавить processing metadata в `FileDetailsItem` и serialization `/api/files/:id`.

2. UI polling behavior in overlay
   - Scope: реализовать polling while processing/queued и terminal state switch without reopening overlay.

3. Tests + verification
   - Scope: обновить unit/integration tests for API payload and dashboard script polling.

4. Ops step
   - Scope: set `WORKER_LLM_TIMEOUT_MS=180000` in local env + restart worker process.

## Test plan

- `npx tsx --test interfaces/http/server.test.ts`
- `npm run typecheck`

## Risks & mitigations

- Risk: overlapping overlay polling requests causing stale UI.
  - Mitigation: single active poll timer + request token guard.
- Risk: leaking internal errors to UI.
  - Mitigation: sanitize error messages before response/render.

## Docs to update

- `docs/03_execution_plans/2026-02-27_pr-4-1b-overlay-polling-processing-metadata.md`
- `docs/00_index/README.md`
- `docs/03_execution_plans/README.md`
