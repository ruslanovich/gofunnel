# Execution Plan: Epic 3 Processing & Reports (LLM + schema validation + worker/jobs + report viewer)

## Goal

- Реализовать Epic 3 end-to-end после upload:
  - создаём job и переводим файл в `queued`
  - worker обрабатывает очередь (`queued -> processing -> succeeded|failed`)
  - worker читает оригинал из S3, вызывает LLM (prompt + JSON schema), валидирует ответ
  - пишет `report.json` и при необходимости `raw_llm_output.json` в S3
  - обновляет metadata/status в Postgres
  - `/app` показывает обновления статуса и открывает полный report в overlay
  - owner-only report retrieval (`404` для non-owner)

## Non-goals

- Realtime subscriptions/websocket.
- Multi-provider routing policy beyond initial adapter.
- Full report sharing UX rewrite (Epic 1 share route остаётся отдельно).
- Масштабные UI redesign изменения за пределами overlay report rendering.

## Assumptions

- Repo orientation выполнен:
  - `AGENTS.md`, `docs/00_index/README.md`, `ARCHITECTURE.md`.
- Локальные точки интеграции (Epic 2 baseline):
  - S3 adapter: `infra/storage/s3_client.ts`
  - files repository: `infra/files/postgres_file_repository.ts`
  - file contracts/services: `app/files/contracts.ts`, `app/files/service.ts`
  - auth/session guards and transport: `interfaces/http/server.ts`
  - `/app` overlay placeholder: `renderAppDashboardPage` in `interfaces/http/server.ts`
- Решения зафиксированы до кода:
  - `docs/05_decisions/2026-02-27_adr-0008_job-queue-choice.md`
  - `docs/05_decisions/2026-02-27_adr-0009_report-storage-model.md`
  - `docs/05_decisions/2026-02-27_adr-0010_retry-backoff-policy.md`
  - `docs/05_decisions/2026-02-27_adr-0011_llm-schema-validation-integration.md`
- External research inputs (Context7, official docs):
  - pg-boss features reference: https://github.com/timgit/pg-boss
  - Postgres `FOR UPDATE SKIP LOCKED`: https://www.postgresql.org/docs/current/sql-select
  - Ajv strict validation: https://github.com/ajv-validator/ajv
  - OpenAI Node timeout/retry/errors: https://github.com/openai/openai-node
  - S3 prefixes/lifecycle/security controls: https://docs.aws.amazon.com/AmazonS3/latest/userguide/

## Test-first plan

- Каждый behavioral PR: сначала failing tests (или первым коммитом), потом реализация.
- Negative cases checklist for Epic 3:
  - [x] authz (`401/403`) for protected report APIs
  - [x] validation (`400`) for invalid id/cursor/payload/schema parse branches
  - [x] not found (`404`) for non-owner/missing report
  - [ ] revoked/expired (`410`) not in Epic 3 report endpoint scope (share token semantics remain in share flow)
  - [ ] rate limit (`429`) public API rate limits not introduced in Epic 3 scope
- Additional mandatory negative tests:
  - [x] schema invalid -> file/job `failed` + `raw_llm_output.json` saved
  - [x] LLM transient error -> retried with backoff policy
  - [x] owner-only report access enforced (`404` for non-owner)

### Acceptance criteria -> tests mapping

- job created after upload, status set to queued
  - upload flow integration test asserts DB status and jobs insert
- worker pipeline success writes report and marks succeeded
  - worker integration test with mocked LLM + S3 + repo
- schema invalid output handling
  - worker test asserts raw output artifact write + failed terminal state
- transient LLM failure retry
  - worker test asserts attempts increment + requeue with future `next_run_at`
- owner-only report endpoint
  - HTTP test: owner 200, non-owner 404, unauthenticated 401
- `/app` overlay renders full report when succeeded
  - UI smoke/regression test for overlay fetching `GET /api/files/:id/report`

## Steps (PR-sized)

1. PR-0.1 ADRs + Epic 3 research notes + runbook updates
   - Scope:
     - Finalize ADR-0008..0011.
     - Add/extend runbook section for worker lifecycle, queue recovery, and report artifact keys.
     - Update docs indexes.
   - Test-first list:
     - Docs-only checks (repo/docs/architecture linters).
   - Docs updates:
     - `docs/00_index/README.md`
     - `docs/03_execution_plans/README.md`
     - `docs/05_decisions/README.md`
     - `RELIABILITY.md`
     - `SECURITY.md`
   - Local verification:
     - `python3 scripts/repo_lint.py`
     - `python3 scripts/docs_index_check.py`
     - `python3 scripts/architecture_lint.py`

2. PR-1.1 DB migrations for jobs + report metadata
   - Scope:
     - Add `processing_jobs` table (custom queue) with claim/retry fields.
     - Extend `files` with report metadata columns (`storage_key_report`, `storage_key_raw_llm_output`, `prompt_version`, `schema_version`, attempts/timestamps).
     - Add indexes for claim query and owner report retrieval path.
   - Test-first list:
     - Migration smoke (`up -> status -> down`).
     - Repository tests for job enqueue/claim/complete/fail transitions.
   - Docs updates:
     - `RELIABILITY.md` (queue schema and stuck-job diagnostics)
     - `SECURITY.md` (owner and metadata boundaries)
   - Local verification:
     - `npm run db:migrate`
     - `npm run db:migrate:status`
     - `npm run test`
     - `npm run typecheck`

3. PR-2.1 Worker skeleton + local run command + concurrency control (no LLM)
   - Scope:
     - Add separate worker entrypoint/process.
     - Add claim loop with bounded concurrency and graceful shutdown.
     - Implement hello-job processing with deterministic status transitions only.
     - Apply mandatory status responsibility rule:
       - `processing_jobs.status` is internal scheduling state.
       - `files.status` is user-facing product state.
       - job status must never be used directly as UI status.
       - `files.status='queued'` at enqueue, `'processing'` on successful claim, `'succeeded'|'failed'` only at finalization.
     - Apply mandatory stale-lock policy:
       - treat lock as stale when `locked_at` or `heartbeat_at` is older than TTL (`lock_ttl_seconds`)
       - update `heartbeat_at` periodically while processing long-running jobs.
   - Test-first list:
     - Worker loop unit tests (claim, lock-safe transition to processing, shutdown behavior).
     - Concurrency test (same job cannot be processed twice concurrently).
   - Docs updates:
     - `RELIABILITY.md` (worker process and shutdown signals)
     - runbook for local worker start/stop.
   - Local verification:
     - `npm run test`
     - `npm run typecheck`
     - manual two-process smoke (`http:start` + worker start command)

4. PR-2.2 Upload triggers job creation + status transition to queued
   - Scope:
     - On successful upload finalize: create processing job and set file status `queued`.
     - Preserve compensation logic for partial failures.
   - Test-first list:
     - Existing upload tests adapted for `queued` final status.
     - Failure branch tests: if enqueue fails, file marked failed with explicit error.
   - Docs updates:
     - `SECURITY.md` (status transition and side-effect guarantees)
     - `RELIABILITY.md` (enqueue failure handling)
   - Local verification:
     - `npm run test`
     - `npm run typecheck`

5. PR-3.1 LLM adapter + schema validation layer (unit tests with fixtures)
   - Scope:
     - Add provider-agnostic LLM adapter contract and initial provider implementation.
     - Add versioned prompt/schema loading strategy and Ajv validation module.
   - Test-first list:
     - Fixture tests for valid/invalid model outputs.
     - Validator strictness tests (`additionalProperties`, missing required, invalid enum/type).
     - Adapter timeout/retry error mapping tests.
   - Docs updates:
     - `SECURITY.md` (raw output handling and secret boundaries)
     - `RELIABILITY.md` (timeout/retry layering)
   - Local verification:
     - `npm run test`
     - `npm run typecheck`

6. PR-3.2 Worker full pipeline + retries/backoff
   - Scope:
     - End-to-end worker processing:
       - read original from S3
       - call LLM
       - validate JSON
       - write report/raw artifacts to S3
       - update DB statuses + metadata
     - Implement ADR-0010 retry/backoff policy.
   - Test-first list:
     - happy path `queued -> processing -> succeeded` with report key persisted.
     - schema invalid path -> `failed` + raw saved.
     - transient LLM error path -> requeue and retry schedule.
     - attempts exhausted -> terminal `failed`.
   - Docs updates:
     - `RELIABILITY.md` (retry/backoff policy and failure taxonomy)
     - `SECURITY.md` (artifact access boundary and failure logging)
   - Local verification:
     - `npm run test`
     - `npm run typecheck`
     - manual smoke with seeded job and worker logs

7. PR-3.3 `GET /api/files/:id/report` (owner-only)
   - Scope:
     - Add report endpoint reading `report.json` from S3 for succeeded files.
     - Owner-only access (`404` for non-owner/missing).
   - Test-first list:
     - `401` unauthenticated.
     - `404` non-owner and missing report.
     - `400` invalid file id format.
     - `200` owner gets report payload.
   - Docs updates:
     - `SECURITY.md` (owner-only report retrieval)
     - `RELIABILITY.md` (report read failure behavior).
   - Local verification:
     - `npm run test`
     - `npm run typecheck`

8. PR-4.1 `/app` overlay renders report/failure states
   - Scope:
     - Replace placeholder with real report fetch/render when status `succeeded`.
     - If `failed`, show concise error and note about raw output availability.
     - Keep polling behavior for status updates.
   - Test-first list:
     - UI smoke for succeeded overlay rendering report body.
     - UI regression for failed state message.
     - API contract regression for detail/status compatibility.
   - Docs updates:
     - `RELIABILITY.md` (UI polling expectations)
     - `SECURITY.md` (client-visible error hygiene).
   - Local verification:
     - `npm run test`
     - `npm run typecheck`
     - manual browser smoke for queued/processing/succeeded/failed overlays

## Test plan

- Mandatory per behavioral PR:
  - failing tests first
  - implementation second
  - full test suite + typecheck green
- Baseline checks each PR:
  - `npm run test`
  - `npm run typecheck`
- Docs/structure checks for docs-heavy steps:
  - `python3 scripts/repo_lint.py`
  - `python3 scripts/docs_index_check.py`
  - `python3 scripts/architecture_lint.py`

## Risks & mitigations

- Risk:
  - Duplicate processing of same file under concurrent workers.
  - Mitigation:
    - atomic claim via `FOR UPDATE SKIP LOCKED` + test coverage on race scenarios.

- Risk:
  - Unvalidated LLM output leaks into UI/API.
  - Mitigation:
    - strict Ajv gate before writing `report.json`; invalid outputs never marked succeeded.

- Risk:
  - Retry storms during provider outage.
  - Mitigation:
    - capped attempts + exponential backoff with jitter.

- Risk:
  - Unauthorized report access.
  - Mitigation:
    - owner-scoped lookup and `404` masking policy in report endpoint tests.

## Docs to update

- `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md` (progress notes append)
- `docs/05_decisions/2026-02-27_adr-0008_job-queue-choice.md`
- `docs/05_decisions/2026-02-27_adr-0009_report-storage-model.md`
- `docs/05_decisions/2026-02-27_adr-0010_retry-backoff-policy.md`
- `docs/05_decisions/2026-02-27_adr-0011_llm-schema-validation-integration.md`
- `RELIABILITY.md`
- `SECURITY.md`

## Progress notes

- 2026-02-27: planning created (research -> ADR -> execution plan), no implementation started.
- 2026-02-27: PR-1.1 implemented (DB migrations + tests + docs only)
  - Added migration pair `0004_processing_jobs_and_report_metadata.up.sql` / `.down.sql`.
  - Added `processing_jobs` table with stuck-job diagnostics fields:
    - `locked_at`, `locked_by`, `heartbeat_at`, `lock_ttl_seconds`
    - `last_error_code`, `last_error_message` for sanitized failure diagnostics
  - Extended `files` table with report metadata fields per ADR-0009:
    - `storage_key_report`, `storage_key_raw_llm_output`
    - `prompt_version`, `schema_version`
    - `processing_attempts`, `processed_at`, `queued_at`, `started_at`
  - Extended migration smoke test to cover latest migration lifecycle (`up -> status -> down`).
  - Added repo-level DB schema test for enqueue insert, `file_id` uniqueness, and required queue indexes/constraints.
  - Recorded PR-2.1 guardrails in plan: status responsibility rule and stale-lock/heartbeat handling requirements.
- 2026-02-27: PR-2.1 implemented (worker skeleton only, no LLM integration)
  - Added standalone worker command `npm run worker:start` with env config:
    - `WORKER_CONCURRENCY` (default `2`)
    - `WORKER_POLL_MS` (default `1000`)
    - `WORKER_ID` (default `${hostname}:${pid}`)
  - Added worker orchestration skeleton:
    - bounded-concurrency poll loop
    - heartbeat scheduler while a job is in processing
    - terminal finalize paths (`succeeded` / `failed`)
    - retry requeue skeleton with ADR-0010 backoff+jitter
  - Added Postgres worker repository with atomic claim query using `FOR UPDATE SKIP LOCKED`:
    - claims only ready queued jobs (`next_run_at <= NOW()`)
    - stale lock detection via `COALESCE(heartbeat_at, locked_at)` and `lock_ttl_seconds`
    - enforces status responsibility (`files.status='processing'` on successful claim)
  - Added deterministic tests:
    - stale lock reclaimability
    - non-stale lock non-claimability
    - status responsibility across claim/finalization
    - heartbeat updates with manual scheduler ticks
  - Updated `RELIABILITY.md` with worker loop semantics, lock TTL recovery model, and local run notes.
- 2026-02-27: PR-2.2 implemented (enqueue on upload + queued status only)
  - Upload finalize flow now enqueues a `processing_jobs` row on successful S3 put:
    - `status='queued'`, `next_run_at=NOW()`, `attempts=0`, `max_attempts=4`.
  - Upload finalize now sets file lifecycle to queue state:
    - `files.status='queued'`, `queued_at=NOW()` when available.
  - Added idempotent enqueue behavior:
    - duplicate `processing_jobs(file_id)` insert is treated as success and does not create extra jobs.
  - Added enqueue failure compensation:
    - marks file `failed` with `error_code='enqueue_failed'`.
    - performs best-effort S3 original object delete.
    - emits structured `orphan_file_without_job` diagnostics event.
  - Added/updated upload tests:
    - success path asserts file `queued` + job row exists.
    - idempotency path asserts stable success and no duplicate jobs.
    - enqueue failure path asserts failed file state and S3 delete attempt.
- 2026-02-27: PR-3.1 implemented (adapter + validator only, no worker integration/S3 writes)
  - Added provider-agnostic LLM adapter module with contract:
    - `analyzeTranscript({ transcriptText, promptVersion, schemaVersion, timeoutMs })`
    - result includes `rawText` and `parsedJson`
    - env config is required: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`
  - Added timeout + error-classification hooks for next worker PRs:
    - timeout normalized as `llm_timeout` (`retriable=true`)
    - provider-classified retriable/fatal errors are preserved
  - Added versioned prompt/schema assets:
    - `prompts/report/v1.txt`
    - `schemas/report/v1.json`
    - active version selection is centralized via `app/processing/report_contract.ts`
  - Added strict Ajv validation layer with compile-cache per schema version:
    - validation failure returns `errorCode='schema_validation_failed'`
    - concise bounded summary + structured sanitized errors for logs
  - Added fixture-driven tests:
    - validator: valid fixture pass + invalid fixture fail contract
    - adapter: fake provider success + retriable/fatal classification + timeout path
- 2026-02-27: PR-3.2 implemented (worker pipeline integration: S3 -> LLM -> validate -> S3 -> DB)
  - Added `ReportPipelineProcessor` and wired it into `worker:start`:
    - loads claimed file context (`user_id`, `storage_key_original`) from Postgres
    - reads original transcript from S3
    - calls LLM adapter with active prompt/schema versions and worker timeout override
    - validates model output through Ajv
    - writes `report.json` or `raw_llm_output.json` to S3 depending on validation outcome
    - updates `files` metadata (`storage_key_report`/`storage_key_raw_llm_output`, `prompt_version`, `schema_version`)
  - Preserved worker claim/requeue semantics from PR-2.1:
    - no changes to `FOR UPDATE SKIP LOCKED` claim strategy
    - retries still handled by worker via ADR-0010 backoff+jitter
  - Added required test coverage with fakes:
    - happy path: succeeds only after report write + metadata update
    - schema invalid: raw output persisted + terminal `schema_validation_failed`
    - retriable LLM timeout: requeue with future `next_run_at`
    - retriable S3 read failure: requeue path
    - DB update failure after report write: compensation delete attempt + `orphan_report_object` log
- 2026-02-27: PR-3.3 implemented (`GET /api/files/:id/report` owner-only retrieval endpoint)
  - Added dedicated report retrieval execution plan:
    - `docs/03_execution_plans/2026-02-27_pr-3-3-get-report-endpoint.md`
  - Added authenticated endpoint in HTTP transport:
    - `GET /api/files/:id/report`
    - `401 auth_required` when no session
    - `400 invalid_id` for non-canonical UUID
    - `404 Not Found` for non-owner or missing file (masked)
    - `409 { error: "report_not_ready" }` for owner-owned file when report metadata is not ready (`status != succeeded` or missing `storage_key_report`)
    - `200` returns parsed `report.json` payload with `application/json` content type
    - `500 { error: "report_fetch_failed" }` on S3 read/parse failure for existing succeeded file
  - Added owner-scoped report lookup in file repository:
    - `findFileReportForUser({ id, userId })` in app contract + Postgres implementation
  - Added app-level report retrieval service:
    - validates readiness and maps storage/parse failures to sanitized `report_fetch_failed`
  - Added structured diagnostics event for storage read failures:
    - `event=report_fetch_failed`
    - fields include `fileId` and sanitized error details (no report payload logging)
  - Added HTTP integration tests (test-first):
    - unauthenticated `401`
    - non-owner `404`
    - owner not-ready `409`
    - owner success `200` + `content-type` assertion
    - storage failure `500`
- 2026-02-27: PR-4.1 implemented (`/app` overlay renders report/failure states)
  - Updated `/app` row-click overlay flow in `interfaces/http/server.ts`:
    - always loads metadata via `GET /api/files/:id`
    - for `status === succeeded` loads report via `GET /api/files/:id/report`
    - for `409 { error: "report_not_ready" }` shows `Report is still processing`
    - for `status === failed` shows concise `error_code`/`error_message`
  - Replaced fixed Epic 2 placeholder text with dynamic overlay states.
  - Added report rendering guard:
    - overlay pretty-prints JSON report payload in `<pre>`
    - `raw_llm_output` field is removed from rendered payload by default
  - Added UI smoke tests (mocked fetch for inline `/app` script):
    - succeeded flow renders report JSON in overlay
    - report endpoint `409` flow shows `Report is still processing`
