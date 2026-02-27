# RELIABILITY.md

## Базовые принципы надежности

- Наблюдаемость закладывается с первого production-пути.
- Ошибки должны быть логируемыми и диагностируемыми.
- Изменения в пользовательских сценариях сопровождаются тестами.
- Операционные действия должны иметь runbook в `docs/04_runbooks/`.

## Что собираем (целевая рамка)

- Логи (структурированные)
- Метрики (latency, error rate, throughput)
- Трассировка (request/job path)
- Сигналы по ресурсам и saturation

## Что будет добавлено позже

- SLO/SLI
- incident process
- retry/backoff/idempotency policies
- backup/restore и DR процедуры

## Epic 1 (planned reliability controls, decision-level)

- DB-backed session and anti-spam state chosen for correctness across restarts/instances (see Epic 1 ADRs in `docs/05_decisions/`).
- Для auth/access-request/invite/share flows нужны структурированные логи с outcome-кодами (accepted/rejected/silent_drop/expired/revoked).
- Миграции и индексы для auth tables должны тестироваться на чистой БД в каждом schema-changing PR.
- Нужен cleanup path для expired sessions и short-lived rate-limit buckets (фиксировать в PR, где вводится storage).

## PR-1.1 implementation notes

- Добавлен минимальный migration runner с `up/down/status` и таблицей `schema_migrations` для воспроизводимого применения схемы.
- Rollback поддерживается через парные `*.down.sql` миграции (пока 1-я миграция Epic 1).
- Для этого PR принят manual smoke test вместо automated test harness, так как runtime/test stack только bootstrap'ится; команды проверки зафиксированы в `docs/04_runbooks/admin_bootstrap.md`.

## PR-2.1 implementation notes (auth runtime MVP)

- Добавлен минимальный HTTP transport для auth flows (`/login`, `/app`, `/admin`, `/api/auth/login`, `/api/auth/logout`) с unit/integration-style tests на route guards и session lifecycle.
- Session validation обновляет `sessions.last_seen_at` на успешном доступе (дополнительный диагностический сигнал активности сессий).
- Наблюдаемость пока минимальная: structured auth logs и метрики outcome-кодов остаются задачей следующих PR (не реализованы в PR-2.1).

## PR-3.2 implementation notes (access-request anti-spam)

- Для `POST /api/access-requests` добавлено Postgres-backed anti-spam storage:
  - таблица `access_request_rate_limit_buckets`
  - fixed hourly buckets (`scope`, `subject_hash`, `bucket_start`) для rate limits по IP/email
  - endpoint queries only current hourly bucket for limit evaluation, поэтому старые buckets безопасно игнорируются при решении по текущему запросу
- Cleanup/retention strategy (bounded storage):
  - lazy cleanup выполняется в request path low-frequency режимом: каждый 100-й запрос к `POST /api/access-requests`
  - удаляются записи `access_request_rate_limit_buckets` старше 14 дней
  - это безопасно, потому что enforcement использует только текущий hourly bucket; retention window оставлен с большим запасом для диагностики/операционного анализа
- Structured logs для anti-spam outcomes добавлены в HTTP transport с `event` + `reason` полями:
  - accepted (`created`)
  - suppressed (`duplicate_24h`)
  - dropped (`honeypot`, `time_gate`)
  - rejected (`rate_limited_ip`, `rate_limited_email`)
- Метрики backend-пайплайна пока не подключены; текущие stable reason codes специально пригодны как будущие labels/counters.

## Epic 2 PR-1.1 implementation notes (files schema only)

- Added migration pair:
  - `infra/db/migrations/0003_files_table.up.sql`
  - `infra/db/migrations/0003_files_table.down.sql`
- Added `files` table indexes for target read paths:
  - `(user_id, created_at DESC, id DESC)` for deterministic owner list order
  - `(user_id, id)` for owner-scoped single-row lookup
- Added automated migration smoke test harness:
  - `infra/db/migrator.smoke.test.ts` exercises `up -> status -> down` for the new migration
  - test runs via `scripts/test.sh`; it skips when `DATABASE_URL` is not set (to keep CI/local runs deterministic without forcing DB provisioning).

## Epic 2 PR-3.1 implementation notes (upload endpoint only)

- Added `POST /api/files/upload` in current Node HTTP transport with multipart parsing and fixed max-size guard (`10MB`).
- Upload path uses two durable backends:
  - Postgres `files` metadata row lifecycle (`processing` -> `uploaded` or `failed`)
  - S3 object write/delete through the server-side storage adapter
- Compensation paths implemented for partial-failure safety:
  - S3 success + DB finalize failure:
    - server performs immediate best-effort `deleteObject(key)` rollback
    - if delete also fails, emits structured `orphan_s3_object` log for operational cleanup visibility
  - DB row created + S3 put failure:
    - server updates that row to `status='failed'` with `error_code='s3_put_failed'` and sanitized message
- Automated coverage added for critical reliability edges:
  - happy path metadata/object consistency
  - invalid extension and oversize short-circuit behavior (no side effects)
  - both compensation directions including orphan logging branch.

## Epic 3 PR-1.1 implementation notes (jobs schema + report metadata)

- Added migration pair:
  - `infra/db/migrations/0004_processing_jobs_and_report_metadata.up.sql`
  - `infra/db/migrations/0004_processing_jobs_and_report_metadata.down.sql`
- Queue state is now persisted in `processing_jobs` with stuck-job diagnostics fields:
  - `locked_at`: timestamp when a worker claims a job lock.
  - `locked_by`: worker identifier for diagnosing which worker currently owns the lock.
  - `heartbeat_at`: worker liveness signal while processing long-running jobs.
  - `lock_ttl_seconds`: lock expiration budget used to classify stale locks.
- Stuck-job recovery intent (implemented in worker PR-2.1):
  - worker will treat a lock as stale when `locked_at`/`heartbeat_at` age exceeds TTL
  - stale jobs can be re-claimed safely by another worker via claim query
  - worker will update `heartbeat_at` periodically during processing to keep active jobs from being falsely re-claimed
- `files` table now stores report-processing metadata only (no large artifacts in Postgres):
  - `storage_key_report`, `storage_key_raw_llm_output`, `prompt_version`, `schema_version`
  - `processing_attempts`, `processed_at`, `queued_at`, `started_at`

## Epic 3 PR-2.1 implementation notes (worker skeleton: claim/locks/heartbeat/finalize)

- Added standalone worker process command:
  - `npm run worker:start`
  - env config:
    - `WORKER_CONCURRENCY` (default `2`)
    - `WORKER_POLL_MS` (default `1000`)
    - `WORKER_ID` (default `${hostname}:${pid}`)
- Worker claim mechanics:
  - claim query uses `FOR UPDATE SKIP LOCKED`.
  - only `processing_jobs.status='queued'` and `next_run_at <= NOW()` are claimable.
  - lock is treated as stale when `COALESCE(heartbeat_at, locked_at)` is older than `lock_ttl_seconds`.
  - claim transition updates both entities:
    - `processing_jobs`: `status='processing'`, lock fields + `heartbeat_at`, `attempts += 1`.
    - `files`: `status='processing'` (status responsibility rule).
- Heartbeat/liveness:
  - while processing, worker updates `heartbeat_at` every ~`lock_ttl_seconds / 3`.
  - if a worker dies and heartbeat stops, another worker can reclaim after TTL expiry.
- Finalization behavior in PR-2.1 (placeholder processing only, no LLM/report artifacts):
  - success path:
    - `processing_jobs.status='succeeded'`, lock fields cleared.
    - `files.status='succeeded'`, `processed_at=NOW()`.
  - fail path:
    - `processing_jobs.status='failed'`, sanitized `last_error_code/message`, lock fields cleared.
    - `files.status='failed'` with sanitized error fields.
- Retry/backoff skeleton wired per ADR-0010:
  - retriable errors are requeued with `status='queued'` and future `next_run_at` using exponential backoff + jitter.
- Recovery of stuck jobs:
  - first action: start worker(s) with `npm run worker:start`; stale locks are reclaimed automatically.
  - diagnostics query pattern:
    - find old `processing` jobs where heartbeat age exceeds TTL.
  - manual intervention is needed only if a job keeps cycling retries until `max_attempts` and reaches terminal `failed`.

## Epic 3 PR-2.2 implementation notes (enqueue on upload)

- `POST /api/files/upload` now finalizes into queue state instead of terminal upload state:
  - creates `processing_jobs` row with:
    - `status='queued'`
    - `next_run_at=NOW()`
    - `attempts=0`
    - `max_attempts=4`
  - updates `files.status='queued'` and sets `queued_at=NOW()` when the column exists.
- Enqueue idempotency:
  - duplicate enqueue by `processing_jobs(file_id)` unique constraint is treated as success (no crash, no duplicate rows).
  - file remains finalized as `queued`.
- Enqueue failure handling after successful S3 put:
  - file is marked `failed` with `error_code='enqueue_failed'` and sanitized error message.
  - service performs best-effort `deleteObject(storage_key_original)` compensation.
  - structured event `orphan_file_without_job` is emitted for diagnostics; on delete failure, `orphan_s3_object` is also emitted.

## Epic 3 PR-3.1 implementation notes (LLM adapter + schema validation only)

- Added provider-agnostic LLM adapter contract with env-driven configuration:
  - `LLM_PROVIDER` default:
    - `openai` when `NODE_ENV != test`
    - `fake` when `NODE_ENV == test` and provider is unset
  - `LLM_MODEL` default: `gpt-5-mini`
  - required for real provider: `LLM_API_KEY`
  - optional timeout override: `LLM_TIMEOUT_MS`
  - production guardrails:
    - `LLM_PROVIDER=fake` is rejected
    - missing `LLM_API_KEY` is rejected
- Added adapter hooks required for upcoming worker integration:
  - timeout branch normalizes to `llm_timeout` (`retriable=true`)
  - provider-specific classification can mark errors retriable/fatal
  - unclassified provider failures normalize to `llm_provider_failed` (`retriable=false`)
- Added OpenAI provider integration (official Node SDK) with JSON-schema-first output mode:
  - Structured Outputs path uses `json_schema` response format (`strict=true`) to keep output schema-aligned.
  - Fallback path forces JSON-only mode (`json_object`) if structured mode is unavailable.
  - SDK auto-retries are disabled (`maxRetries=0`) so outer worker retries/backoff remain the single source of retry policy (ADR-0010).
  - retriable mapping: timeout, network, HTTP `429`, HTTP `5xx`.
  - non-retriable mapping: other provider `4xx`.
- Added strict Ajv validation module for versioned report schemas:
  - schema source: `schemas/report/<version>.json`
  - compile is cached and reused per schema version
  - failure contract is stable and bounded:
    - `errorCode='schema_validation_failed'`
    - concise `summary` (length-limited)
    - structured sanitized `errors[]` list with bounded size for logs
- Added fixture-based tests to lock behavior:
  - valid fixture passes strict schema validation
  - invalid fixture returns `schema_validation_failed` and concise summary
  - fake-provider adapter tests cover success, retriable/fatal mapping, timeout path

## Epic 3 PR-3.2 implementation notes (worker full pipeline integration)

- Worker processor now executes full processing chain for claimed jobs:
  - read original transcript from `files.storage_key_original` in S3
  - call LLM adapter with active prompt/schema versions (`v1`) and bounded timeout
  - validate JSON payload via Ajv validator
  - write report artifacts to S3
  - persist report metadata into `files` row
- Status responsibility is preserved:
  - `processing_jobs.status` remains internal scheduler state
  - `files.status='succeeded'` is set only by worker finalization after processor returns success
  - processor success now implies `report.json` write + metadata update already completed
- Retry/backoff taxonomy in processing path:
  - retriable:
    - LLM timeout/network/transient classification (`llm_timeout`, provider retriable classes)
    - transient S3 read/write errors (`s3_read_failed`, `s3_write_failed` when classified transient)
  - fatal:
    - non-retriable LLM failures mapped to `llm_call_failed`
    - schema validation failure mapped to `schema_validation_failed` (no retry)
  - requeue mechanics continue using ADR-0010 schedule (`30s`, `120s`, `480s` with jitter)
- Artifact/DB consistency and compensation:
  - on schema invalid output, worker stores `raw_llm_output.json` and then finalizes failed
  - if `report.json` write succeeds but DB metadata update fails:
    - worker attempts best-effort delete for report artifact
    - failed cleanup emits structured `orphan_report_object` log with `{fileId, key}`

## Epic 3 PR-3.3 implementation notes (owner report retrieval endpoint)

- Added owner-scoped report read path:
  - `GET /api/files/:id/report`
  - owner lookup is performed in Postgres before any storage read
  - non-owner or missing file is masked as `404 Not Found`
- Readiness contract:
  - if owner file is not yet in completed state (`status != succeeded`) or `storage_key_report` is missing, endpoint returns `409 { "error": "report_not_ready" }`
  - chosen behavior is stable and explicit for UI/polling callers while preserving non-owner masking via `404`
- Storage-read failure handling:
  - for existing succeeded owner file, S3 read/parse failure returns sanitized `500 { "error": "report_fetch_failed" }`
  - structured diagnostics event is emitted as `report_fetch_failed` with `{fileId, error}` (sanitized, bounded)
  - report payload is never logged on error path
