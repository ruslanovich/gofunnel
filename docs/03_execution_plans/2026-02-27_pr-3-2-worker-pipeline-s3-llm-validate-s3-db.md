# Execution Plan: PR-3.2 Worker Pipeline (S3 -> LLM -> validate -> S3 -> DB)

## Goal

- Интегрировать существующий worker pipeline с реальными шагами обработки:
  - read original transcript from S3
  - call LLM adapter
  - validate payload by schema
  - write artifacts to S3 (`report.json`, `raw_llm_output.json` on schema failure)
  - persist report metadata in Postgres
  - preserve existing claim/retry/finalize semantics from PR-2.1 + ADR-0010

## Non-goals

- Изменения UI overlay rendering.
- Новый HTTP endpoint для чтения report (`/api/files/:id/report` остается в PR-3.3).
- Изменение claim strategy (`FOR UPDATE SKIP LOCKED`, lock ownership, heartbeat model).

## Assumptions

- Базовая queue/status semantics уже реализована в PR-2.1/2.2:
  - `processing_jobs.status` — internal scheduling state.
  - `files.status` — user-facing lifecycle state.
- LLM adapter + Ajv validator из PR-3.1 уже доступны и покрыты unit tests.
- Decisions:
  - `docs/05_decisions/2026-02-27_adr-0008_job-queue-choice.md`
  - `docs/05_decisions/2026-02-27_adr-0009_report-storage-model.md`
  - `docs/05_decisions/2026-02-27_adr-0010_retry-backoff-policy.md`
  - `docs/05_decisions/2026-02-27_adr-0011_llm-schema-validation-integration.md`
- External research (Context7 official docs):
  - AWS SDK JS v3 S3 `GetObject` stream handling (`Body.transformToString()` and single-consume rule): `/aws/aws-sdk-js-v3`
  - Ajv validate contract (`validate(data)` + `validate.errors`): `/ajv-validator/ajv`

## Test-first plan

- Add failing tests for pipeline processor + worker integration via fakes:
  - happy path:
    - S3 read original text
    - LLM returns valid JSON
    - `report.json` written to S3
    - DB metadata (`storage_key_report`, `prompt_version`, `schema_version`) updated
    - worker finalizes file/job as `succeeded`
  - schema invalid:
    - `raw_llm_output.json` written to S3
    - terminal failed (`schema_validation_failed`, no retry)
  - retriable LLM timeout:
    - worker requeues with future `next_run_at`
    - file not marked `succeeded`
  - retriable S3 read failure:
    - worker requeues with backoff+jitter
  - DB metadata write failure after report write:
    - best-effort delete for `report.json` attempted
    - structured `orphan_report_object` emitted when cleanup delete fails
- Negative cases checklist:
  - [ ] authz (`401/403`) not in scope этого PR
  - [ ] validation (`400`) not in scope этого PR (worker-only path)
  - [ ] not found (`404`) not in scope этого PR
  - [ ] revoked/expired (`410`) not in scope этого PR
  - [ ] rate limit (`429`) represented as retriable class in worker retry path
- Acceptance criteria -> tests mapping:
  - full success pipeline with metadata update -> `pipeline happy path` test
  - schema invalid terminal failure + raw capture -> `schema invalid` test
  - transient timeout retry -> `llm timeout retriable` test
  - transient S3 read retry -> `s3 read retriable` test
  - compensation/orphan logging branch -> `db update failure after report write` test

## Steps (PR-sized)

1. Add failing tests
   - Scope:
     - New pipeline processor tests with fake S3/LLM/repository/logger.
     - Worker test update for retriable/fatal pipeline errors.
   - Expected output:
     - Red tests describing PR-3.2 contracts.
   - Checks:
     - `npm run test` (expect red before implementation)

2. Implement processor + infra integration
   - Scope:
     - Pipeline processor orchestration and error classification.
     - S3 read support (`GetObject`).
     - Postgres metadata read/write methods for report artifacts.
     - Worker CLI wiring from placeholder processor to real processor.
   - Expected output:
     - Green tests for required paths with unchanged claim semantics.
   - Checks:
     - `npm run test`
     - `npm run typecheck`

3. Update reliability/security docs + progress notes
   - Scope:
     - `RELIABILITY.md`, `SECURITY.md`, Epic 3 progress note.
   - Expected output:
     - Error taxonomy, retry behavior, and raw-output handling documented.
   - Checks:
     - `python3 scripts/docs_index_check.py`

## Test plan

- Automated:
  - `npm run test`
  - `npm run typecheck`
- Docs consistency:
  - `python3 scripts/docs_index_check.py`

## Risks & mitigations

- Risk:
  - S3 stream body not consumed correctly can leak sockets under worker load.
  - Mitigation:
    - consume `GetObject.Body` via `transformToString()` once and test behavior with fake client.

- Risk:
  - Report object orphaned when DB metadata write fails after successful S3 write.
  - Mitigation:
    - best-effort delete + structured orphan logging for failed cleanup.

- Risk:
  - Wrong retriable/fatal classification causes retry storms or early terminal failures.
  - Mitigation:
    - explicit classifier helpers + tests for timeout/read/write/db branches.

## Docs to update

- `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`
- `RELIABILITY.md`
- `SECURITY.md`
