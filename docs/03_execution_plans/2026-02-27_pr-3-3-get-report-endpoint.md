# Execution Plan: PR-3.3 GET `/api/files/:id/report` (owner-only retrieval)

## Goal

- Implement only Epic 3 PR-3.3 backend endpoint:
  - `GET /api/files/:id/report`
  - owner-only access (masked `404` for missing/non-owner)
  - read `report.json` from S3 by `files.storage_key_report`
  - return JSON payload with `Content-Type: application/json`

## Non-goals

- Any UI changes in `/app` overlay (PR-4.1 scope).
- Worker pipeline behavior changes (PR-3.2 already implemented).
- Share-link flow changes (`/share/*` remains separate).

## Assumptions / research inputs

- Existing contracts and architecture:
  - `interfaces/http/server.ts`
  - `app/files/service.ts`
  - `infra/files/postgres_file_repository.ts`
  - `infra/storage/s3_client.ts`
- Existing Epic 3 decisions remain valid:
  - `docs/05_decisions/2026-02-27_adr-0009_report-storage-model.md`
- External research (Context7, official docs):
  - AWS SDK JS v3 `GetObject` returns unconsumed stream; must be consumed exactly once (`transformToString()`), and stream must not be consumed multiple times:
    - `/aws/aws-sdk-js-v3` (`UPGRADING.md`, `EFFECTIVE_PRACTICES.md`, `CLIENTS.md`)

## Decision notes

- For owner-owned file where report is not yet available (`status != succeeded` or `storage_key_report IS NULL`), use:
  - `409` with body `{ "error": "report_not_ready" }`
- For missing/non-owner file, keep masking behavior:
  - `404 Not Found`

No new ADR is required: this is endpoint-level behavior within existing ADR-0009 model.

## Test-first plan

- Add failing HTTP tests first:
  - `401 auth_required` for unauthenticated request.
  - `404 Not Found` for non-owner access.
  - `409 { error: "report_not_ready" }` for owner when report metadata is not ready.
  - `200` happy path with JSON payload and `content-type` containing `application/json`.
  - `500 { error: "report_fetch_failed" }` when S3 read fails for existing succeeded file.

## Steps

1. Extend file repository contract to support owner-scoped report lookup (`status`, `storage_key_report`, `storage_bucket`).
2. Add report retrieval service in `app/files` with readiness checks and sanitized error mapping.
3. Add endpoint handler in `interfaces/http/server.ts` before generic `/api/files/:id` route.
4. Add/adjust in-memory test harness for S3 report reads.
5. Update docs (`SECURITY.md`, `RELIABILITY.md`, Epic 3 progress note).

## Risks & mitigations

- Risk: leaking file existence across users.
  - Mitigation: owner-scoped repository lookup + masked `404`.
- Risk: leaking sensitive report data through logs.
  - Mitigation: log only structured metadata (`event`, `fileId`, sanitized error), never full payload.
- Risk: invalid report body from storage.
  - Mitigation: parse-as-JSON boundary in service; return sanitized `report_fetch_failed` on parse/read failure.

## Verification

- `npm run test`
- `npm run typecheck`

## Docs to update

- `SECURITY.md`
- `RELIABILITY.md`
- `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md` (progress notes)
