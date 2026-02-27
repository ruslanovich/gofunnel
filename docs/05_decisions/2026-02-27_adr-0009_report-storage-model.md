# ADR-0009: Report Storage Model (S3 artifacts + Postgres metadata)

## Context

- Epic 3 после обработки должен сохранять:
  - `users/<userId>/files/<fileId>/report.json`
  - `users/<userId>/files/<fileId>/raw_llm_output.json` (на schema failure или debug mode)
- Нужна модель, которая обеспечивает:
  - owner isolation,
  - простой `GET /api/files/:id/report`,
  - хранение `prompt_version` и `schema_version` для воспроизводимости.
- Текущая база уже содержит `files` как source-of-truth по lifecycle/status.
- External research (Context7, official docs):
  - S3 prefixes and multi-tenant key organization:
    - https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html
    - https://docs.aws.amazon.com/AmazonS3/latest/userguide/common-bucket-patterns.html
  - Lifecycle filters by prefix/tags and retention controls:
    - https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-filters.html
  - Block public access and default encryption guidance:
    - https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html

## Options considered

### Option A: Separate `reports` table

- Description:
  - Отдельная таблица `reports` (1:1 или 1:N к `files`) с ключами S3 и версиями.
- Pros:
  - Логически отделяет upload metadata от generated report metadata.
  - Естественная эволюция в сторону multiple report revisions.
- Cons:
  - Дополнительные joins и сложнее owner-scope path для MVP.
  - Больше migration/DAO surface уже на первом шаге Epic 3.

### Option B: Keep report metadata in `files` row

- Description:
  - Расширить `files` колонками для report artifacts/versions/errors.
- Pros:
  - Один owner-scoped read path для `/api/files`, `/api/files/:id`, `/api/files/:id/report`.
  - Меньше инфраструктурной сложности на MVP.
  - Синхронно с текущей lifecycle моделью `files.status`.
- Cons:
  - Таблица `files` становится шире.
  - При будущем multi-revision отчётов, вероятно, потребуется отдельная revision table.

## Decision

- Выбранный вариант:
  - `Option B` — хранить report metadata в `files`, а тяжёлые артефакты в S3.
- Почему выбран:
  - MVP Epic 3 ориентирован на один report per file; отдельная `reports` таблица сейчас добавляет сложность без продуктового выигрыша.
  - Owner isolation проще обеспечить через уже существующий owner-scoped lookup по `files`.
- Область действия:
  - Epic 3 processing + report retrieval API.

### Data placement contract

- S3 (artifact bytes):
  - original transcript: `users/<userId>/files/<fileId>/original.<ext>` (уже есть)
  - report: `users/<userId>/files/<fileId>/report.json`
  - raw model output: `users/<userId>/files/<fileId>/raw_llm_output.json` (on validation failure/debug)
- Postgres (`files` metadata):
  - `status`, `error_code`, `error_message`
  - `storage_key_report` (nullable)
  - `storage_key_raw_llm_output` (nullable)
  - `prompt_version` (nullable)
  - `schema_version` (nullable)
  - `processing_attempts`, `processed_at` (nullable)
  - optional lightweight summary field for list UX (strictly bounded size).

### Prompt/schema version strategy

- Source-of-truth: versioned artifacts in repo under `prompts/`.
- Active versions selected by server config (env):
  - `REPORT_PROMPT_VERSION`
  - `REPORT_SCHEMA_VERSION`
- Worker persists exact versions used into `files` row per processing attempt.
- Изменение структуры schema/prompt требует обновления ADR/plan и миграций при необходимости.

## Consequences

- Плюсы после принятия решения
  - Простой и быстрый owner-safe read path.
  - Чёткое разделение: большие payloads в S3, индексируемая мета в Postgres.
  - Воспроизводимость отчёта через persisted `prompt_version`/`schema_version`.
- Минусы / долг / ограничения
  - Потенциальный будущий refactor в отдельную revision table при появлении reprocessing history.
  - Нужно контролировать размер summary/error полей в Postgres.
- Что нужно мониторить в следующих PR
  - размер `report.json` и частоту загрузок/чтений.
  - согласованность между `files.status` и наличием `storage_key_report`.

## Rollback plan

- Триггеры для пересмотра
  - Появление требований на несколько report revisions per file.
  - Перегрузка `files` из-за объёма аналитических полей.
- Как откатываемся
  - Ввод `reports`/`report_revisions` таблиц с backfill из `files` metadata.
  - API compatibility сохраняется через app service layer.
- Какие артефакты/доки нужно обновить при откате
  - `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`
  - `RELIABILITY.md`
  - `SECURITY.md`
