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
