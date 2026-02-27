# Execution Plan: Epic 2 Upload & Files (S3 + Postgres metadata)

## Goal

- Реализовать Epic 2:
  - `/app` показывает список файлов + Upload button.
  - Upload принимает только `.txt` и `.vtt`.
  - Оригинал сохраняется в Yandex Object Storage по ключу:
    - `users/<userId>/files/<fileId>/original.<ext>`
  - Metadata сохраняется в Postgres `files` со статусом `uploaded`.
  - API:
    - `POST /api/files/upload` (multipart)
    - `GET /api/files`
    - `GET /api/files/:id`
  - Overlay на row click показывает metadata + placeholder:
    - `Report not available yet (Epic 3)`.

## Non-goals

- Любая LLM обработка, jobs/workers.
- Realtime subscriptions.
- Парсинг/нормализация содержимого `.vtt`.
- Публичный доступ к объектам в bucket.

## Assumptions

- Текущий runtime: Node HTTP transport (`interfaces/http/server.ts`) с cookie sessions из Epic 1.
- Decision artifacts зафиксированы до кода:
  - `docs/05_decisions/2026-02-27_adr-0005_s3-client-yandex-object-storage-config.md`
  - `docs/05_decisions/2026-02-27_adr-0006_upload-transport-strategy.md`
  - `docs/05_decisions/2026-02-27_adr-0007_files-list-pagination-strategy.md`
- Runbook c environment/CLI:
  - `docs/04_runbooks/yandex_object_storage.md`
- External research inputs:
  - AWS SDK v3 + custom endpoint (Context7 / AWS primary docs)
  - Next.js Route Handlers `request.formData()` (Context7)
  - Node HTTP low-level request parsing + streaming parser pattern (Context7 + busboy docs)
  - Yandex docs for endpoint/region/signature and service-account access keys

## Test-first plan

- Contract tests must be added before implementation per step.
- Negative cases checklist for Epic 2 APIs:
  - [x] authz (`401/403`) for all `/api/files*`
  - [x] validation (`400`) for invalid multipart/extension/size/cursor/id format
  - [x] not found (`404`) for non-owned file access and missing IDs
  - [ ] revoked/expired (`410`) not applicable in Epic 2 (no file expiry/revocation semantics)
  - [ ] rate limit (`429`) explicitly deferred (not in Epic 2 scope)
- Acceptance criteria -> tests mapping:
  - upload `.txt/.vtt` only -> upload validation tests (200/400)
  - auth required -> unauthenticated tests (401)
  - owner-only metadata -> non-owner `GET /api/files/:id` returns `404`
  - `/app` list and overlay placeholder -> UI smoke + route tests

## Steps (PR-sized)

1. PR-0.1 ADRs + runbook updates (Yandex S3 config)
   - Scope:
     - Add ADR-0005..0007.
     - Update `docs/04_runbooks/yandex_object_storage.md` with concrete env + `yc` commands.
     - Update docs indexes (`docs/00_index`, section READMEs) with new artifacts.
   - Tests to add first:
     - Docs-only PR; automated repo/docs checks are the test.
   - Docs to update:
     - `docs/00_index/README.md`
     - `docs/03_execution_plans/README.md`
     - `docs/05_decisions/README.md`
     - `docs/04_runbooks/yandex_object_storage.md`
   - Local verification:
     - `python3 scripts/repo_lint.py`
     - `python3 scripts/docs_index_check.py`
     - `python3 scripts/architecture_lint.py`

2. PR-1.1 DB migration: `files` table + indexes
   - Scope:
     - Add SQL migration pair for `files`.
     - Columns: `id`, `user_id`, `storage_bucket`, `storage_key`, `original_filename`, `extension`, `mime_type`, `size_bytes`, `status`, timestamps.
     - Constraints: allowed extensions (`txt|vtt`), positive size, status enum/check.
     - Indexes for owner list path and single-file owner lookup.
   - Tests to add first:
     - Migration smoke on clean DB (`up`/`down`/`status`).
     - Repository-level tests for insert/list/get ownership filters (in-memory or Postgres integration).
   - Docs to update:
     - `SECURITY.md` (owner isolation + metadata storage policy)
     - `RELIABILITY.md` (new migration/index notes)
     - Epic 2 plan progress notes.
   - Local verification:
     - `npm run db:migrate`
     - `npm run db:migrate:status`
     - `npm run test`
     - `npm run typecheck`

3. PR-2.1 S3 client wrapper + config + unit tests (no HTTP yet)
   - Scope:
     - Add infra S3 adapter (`S3Client`) with env config from ADR-0005.
     - Add object key builder for:
       - `users/<userId>/files/<fileId>/original.<ext>`
     - Add upload method abstraction used by app layer.
   - Tests to add first:
     - Unit tests for config validation (missing env -> startup error).
     - Unit tests for key generation and extension normalization.
     - Mocked client tests for upload call shape.
   - Docs to update:
     - `SECURITY.md` (server-side-only credentials)
     - `RELIABILITY.md` (S3 failure modes/retries policy for MVP)
     - `docs/04_runbooks/yandex_object_storage.md` (smoke check section if needed).
   - Local verification:
     - `npm run test`
     - `npm run typecheck`

4. PR-3.1 `POST /api/files/upload` (multipart) + validations + S3 + DB write
   - Scope:
     - Implement upload endpoint in current Node HTTP transport.
     - Parse multipart with streaming parser (no full-body buffering).
     - Enforce auth required.
     - Validate extension and max size before finalize.
     - Write object to S3 and metadata row to DB (`status='uploaded'`).
   - Tests to add first:
     - 401 unauthenticated upload.
     - 400 invalid extension.
     - 400 file too large.
     - 400 malformed multipart.
     - 200 happy path (`.txt`, `.vtt`) with DB + S3 adapter call assertions.
   - Docs to update:
     - `SECURITY.md` (validation, upload auth, secrets boundary)
     - `RELIABILITY.md` (failure handling between S3 and DB write)
     - plan progress notes.
   - Local verification:
     - `npm run test`
     - `npm run typecheck`
     - Manual curl smoke with multipart upload against local server.

5. PR-3.2 `GET /api/files` + cursor pagination
   - Scope:
     - Implement owner-scoped list endpoint with cursor strategy from ADR-0007.
     - Sorting: `created_at DESC, id DESC`.
   - Tests to add first:
     - 401 unauthenticated.
     - 400 invalid cursor/limit.
     - 200 list only current user rows.
     - pagination continuity test for `next_cursor`.
   - Docs to update:
     - `SECURITY.md` (owner-only list scope)
     - `RELIABILITY.md` (pagination contract notes)
     - plan progress notes.
   - Local verification:
     - `npm run test`
     - `npm run typecheck`
     - Manual API smoke with seeded data and cursor traversal.

6. PR-3.3 `GET /api/files/:id` + owner checks
   - Scope:
     - Implement metadata endpoint for single file.
     - Owner-only access with `404` for not-owned/missing.
   - Tests to add first:
     - 401 unauthenticated.
     - 404 missing id.
     - 404 non-owner id.
     - 200 owner gets metadata payload.
   - Docs to update:
     - `SECURITY.md` (404-for-not-owned policy)
     - plan progress notes.
   - Local verification:
     - `npm run test`
     - `npm run typecheck`

7. PR-4.1 `/app` UI: files list + upload + metadata overlay placeholder + polling
   - Scope:
     - Update `/app` protected page for files UX.
     - Add upload form/button and row list from `GET /api/files`.
     - Add row click overlay with metadata and fixed text:
       - `Report not available yet (Epic 3)`.
     - Polling refresh (no realtime).
   - Tests to add first:
     - UI/HTTP smoke test for authenticated access path.
     - Basic regression: upload success appears in list.
   - Docs to update:
     - `docs/01_product/*` (Epic 2 micro-spec if needed)
     - `SECURITY.md` (UI-visible constraints summary)
     - `RELIABILITY.md` (polling behavior notes)
     - plan progress notes.
   - Local verification:
     - `npm run test`
     - `npm run typecheck`
     - Manual browser smoke:
       - upload `.txt/.vtt`
       - list refresh
       - overlay placeholder text visible.

## Test plan

- Mandatory per PR:
  - Add failing tests for changed contracts first.
  - Then implementation.
- Baseline checks for every PR:
  - `npm run test`
  - `npm run typecheck`
- Docs/structure checks for doc-heavy PRs:
  - `python3 scripts/repo_lint.py`
  - `python3 scripts/docs_index_check.py`
  - `python3 scripts/architecture_lint.py`

## Risks & mitigations

- Risk:
  - multipart upload memory pressure in current Node transport.
  - Mitigation:
    - streaming parser + strict max-size limits + tests for oversize.
- Risk:
  - Partial failure (S3 success, DB failure) creates orphan object.
  - Mitigation:
    - explicit compensation path (best-effort delete object) and observable error logging.
- Risk:
  - Cursor bugs under same timestamp ordering.
  - Mitigation:
    - strict tie-breaker on `id` and dedicated pagination tests.

## Docs to update

- `docs/04_runbooks/yandex_object_storage.md`
- `SECURITY.md`
- `RELIABILITY.md`
- `docs/01_product/*` (if spec detail changes)
- `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md` (progress notes append)

## Progress notes

- 2026-02-26: PR-1.1 started/implemented (DB migration: `files` table only)
  - Added migration pair `0003_files_table.up.sql` / `0003_files_table.down.sql`.
  - Added `files` schema with FK to `users`, extension/status/size constraints, and metadata/error fields.
  - Added indexes for owner list and owner lookup paths:
    - `(user_id, created_at DESC, id DESC)`
    - `(user_id, id)`
  - Added migration smoke test harness (`up -> status -> down`) in `infra/db/migrator.smoke.test.ts` and connected it to `scripts/test.sh`.
  - Updated `SECURITY.md` and `RELIABILITY.md` with Epic 2 PR-1.1 notes.
  - Explicitly kept scope limited: no S3 adapter/runtime changes, no HTTP endpoints, no UI changes.

- 2026-02-27: PR-2.1 implemented (S3 adapter only)
  - Added `infra/storage/s3_client.ts` with AWS SDK v3 `S3Client` wrapper (`putObject`, `deleteObject`, `headObject`) and `forcePathStyle=true` baseline.
  - Added strict fail-fast env validation for required server-side vars:
    - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
  - Added unit tests in `infra/storage/s3_client.test.ts`:
    - missing env -> actionable startup error
    - client config includes endpoint + region + `forcePathStyle`
    - wrapper sends expected `PutObject/DeleteObject/HeadObject` command shapes
  - External research refresh (Context7, AWS SDK v3 primary docs):
    - confirmed `S3Client` custom `endpoint` support and v3 `forcePathStyle` config for S3-compatible providers
    - confirmed command-based usage pattern (`client.send(new PutObjectCommand(...))`)
  - Updated docs:
    - `.env.example` with `S3_*` variables
    - `docs/04_runbooks/yandex_object_storage.md` with `SignatureDoesNotMatch` troubleshooting
    - `SECURITY.md` with server-side credential boundary
    - ADR-0005 env contract alignment to `S3_*`
  - Explicitly kept scope limited: no HTTP endpoints, no UI changes, no DB writes.

- 2026-02-27: PR-3.1 implemented (`POST /api/files/upload` only)
  - Added `app/files/service.ts` + `app/files/contracts.ts` and `infra/files/postgres_file_repository.ts`.
  - Added authenticated multipart endpoint `POST /api/files/upload` in `interfaces/http/server.ts`:
    - accepts `file` field only
    - enforces allowed extensions `.txt|.vtt`
    - enforces fixed max size `10MB` (`FILE_UPLOAD_MAX_BYTES`)
  - Implemented upload write path:
    - generates `fileId` (UUID)
    - builds object key `users/<userId>/files/<fileId>/original.<ext>`
    - inserts metadata row in `files` with `status='processing'`
    - uploads raw bytes to S3
    - finalizes DB status to `uploaded` on success
  - Implemented compensation/error handling:
    - if S3 put fails after DB insert => updates row to `status='failed'`, `error_code='s3_put_failed'` with sanitized message
    - if DB finalize fails after successful S3 put => best-effort `deleteObject`; if delete fails emits `orphan_s3_object` structured log (`userId`, `fileId`, `key`)
  - Added endpoint tests in `interfaces/http/server.test.ts`:
    - `401` unauthenticated upload
    - `.txt` happy path with DB row + S3 put assertions
    - invalid extension (`400 invalid_file_type`) with no side effects
    - oversize (`413 file_too_large`) with no side effects
    - DB failure after S3 put (delete compensation + orphan log branch)
    - S3 failure after DB insert (DB row transitions to `failed`)
  - External research refresh (Context7 / Node primary docs):
    - confirmed multipart server parsing pattern with `@fastify/busboy` in Node/undici docs and size-limit handling approach.
  - Updated docs:
    - `SECURITY.md`
    - `RELIABILITY.md`
  - Explicitly kept scope limited: no files list endpoint, no file details endpoint, no `/app` files UI.

- 2026-02-27: PR-3.2 implemented (`GET /api/files` list only, cursor pagination)
  - Added owner-scoped list path in files layer:
    - `FileMetadataRepository.listFilesForUser(...)` contract
    - `PostgresFileRepository` keyset query with ordering `created_at DESC, id DESC`
    - cursor filter for next pages: `AND (created_at, id) < ($cursor_created_at, $cursor_id)`
  - Added list application service:
    - `FileListService` computes `nextCursor` using `limit + 1` fetch strategy
    - default `limit=20`, max `limit=100`, invalid limit => `400 invalid_limit`
  - Added authenticated API endpoint `GET /api/files` in `interfaces/http/server.ts`:
    - unauthenticated => `401 auth_required`
    - parses/validates opaque cursor token (base64url JSON marker of `created_at` + `id`)
    - invalid cursor => `400 invalid_cursor`
    - response shape: `{ items, next_cursor }`
    - item fields limited to MVP metadata only:
      - `id`, `original_filename`, `extension`, `size_bytes`, `status`, `created_at`, `updated_at`
  - Added/updated tests in `interfaces/http/server.test.ts`:
    - list endpoint unauthenticated => `401`
    - list returns only current user files (owner isolation)
    - pagination continuity across two pages with stable ordering
    - invalid cursor => `400 invalid_cursor`
  - External research refresh (Context7 / PostgreSQL primary docs):
    - confirmed row constructor comparison semantics for tuple filter:
      - `(created_at, id) < ($cursor_created_at, $cursor_id)`
  - Updated docs:
    - `SECURITY.md`
    - this Epic 2 execution plan progress section
  - Explicitly kept scope limited: no `/app` UI changes, no `GET /api/files/:id`, no detail/overlay API work.

- 2026-02-27: PR-3.3 implemented (`GET /api/files/:id` only, owner-only)
  - Extended files metadata read contract with owner-scoped single-file lookup:
    - `FileMetadataRepository.findFileForUser({ id, userId })`
    - implemented in `infra/files/postgres_file_repository.ts` with `WHERE id = $1::uuid AND user_id = $2::uuid`
  - Added `FileDetailsService` in `app/files/service.ts` for app-layer orchestration of single-file metadata reads.
  - Added authenticated API endpoint `GET /api/files/:id` in `interfaces/http/server.ts`:
    - unauthenticated => `401 auth_required`
    - invalid UUID in `:id` => `400 invalid_id`
    - not found or not owned => `404 Not Found` (existence masking)
    - owner success => `200` metadata payload with fields:
      - `id`, `original_filename`, `extension`, `size_bytes`, `status`, `created_at`, `updated_at`, `error_code`, `error_message`
    - keeps storage internals excluded (`storage_bucket`, `storage_key_original` not returned)
  - Added endpoint tests in `interfaces/http/server.test.ts`:
    - `401` unauthenticated
    - `400 invalid_id` for non-UUID path parameter
    - `404` for non-owner access (owner isolation)
    - `200` owner success with expected response fields
  - External research refresh (Context7 / Node.js primary docs):
    - confirmed `new URL(req.url, base)` + `pathname` parsing behavior for deterministic route matching.
  - Updated docs:
    - `SECURITY.md`
    - this Epic 2 execution plan progress section
  - Explicitly kept scope limited: no `/app` UI changes, no list pagination changes, no upload-flow changes.

- 2026-02-27: PR-4.1 implemented (`/app` files dashboard UI only)
  - Replaced `/app` placeholder with files dashboard UI in `interfaces/http/server.ts` (no new backend endpoints).
  - Added upload UX wired to existing API:
    - uses `POST /api/files/upload`
    - client-side extension gate for `.txt|.vtt` before request
    - submit button/input disabled while uploading + `Uploading...` state
    - `413` response mapped to user-facing message `File too large`
  - Added files list UX wired to existing list API:
    - first page fetch via `GET /api/files?limit=20`
    - `Load more` pagination via `next_cursor`
    - polling refresh of first page every 7 seconds (within required 5-10s window)
  - Added row-click metadata overlay wired to existing details API:
    - fetches `GET /api/files/:id`
    - renders full JSON payload from API (all returned fields)
    - includes fixed placeholder text `Report not available yet (Epic 3)`
    - closes inline without page navigation
  - Added tests in `interfaces/http/server.test.ts`:
    - UI smoke: authenticated `/app` renders upload/list/overlay scaffold
    - regression: successful upload becomes visible in `/api/files` list response
  - Explicitly kept scope limited:
    - no Epic 3/report-generation work
    - no new API contracts
    - no storage credential exposure in UI
