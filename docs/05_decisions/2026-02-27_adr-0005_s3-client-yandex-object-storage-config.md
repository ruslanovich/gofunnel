# ADR-0005: S3 Client & Yandex Object Storage Config (Epic 2)

## Context

- Epic 2 требует хранить оригиналы `.txt` и `.vtt` в Yandex Object Storage (S3-compatible) и метаданные в Postgres.
- Текущий runtime — Node.js + TypeScript, transport пока `node:http` (`interfaces/http/server.ts`), без существующего S3 adapter.
- Нужен единый и проверяемый способ конфигурирования endpoint/region/credentials и запуска в локальной среде и CI.
- Research inputs:
  - Yandex Object Storage S3 compatibility, SigV4, endpoint formats:
    - https://yandex.cloud/en/docs/storage/s3/
  - Yandex AWS tooling integration (endpoint + region values):
    - https://yandex.cloud/en/docs/storage/tools/aws-cli
  - Yandex static access keys for service accounts:
    - https://yandex.cloud/en/docs/iam/operations/authentication/manage-access-keys
  - AWS SDK JS v3 custom endpoint configuration:
    - https://github.com/aws/aws-sdk-js-v3/blob/main/supplemental-docs/CLIENTS.md
  - Local CLI validation (`yc 0.195.0`): `yc iam access-key --help`, `yc storage bucket --help`.
- Связанный план:
  - `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md`

## Options considered

### Option A: AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`)

- Description:
  - Использовать официальный AWS SDK v3 `S3Client` с custom `endpoint`, `region`, `credentials`.
- Pros:
  - Типобезопасный и широко поддерживаемый client для S3 API.
  - Нативная поддержка S3-compatible endpoint через `endpoint`.
  - Прямо подходит под будущую миграцию transport (`node:http` -> Next.js Route Handlers), т.к. infra-клиент останется тем же.
- Cons:
  - Больше dependency surface по сравнению с узким custom HTTP client.
  - Нужно внимательно зафиксировать env/config, чтобы избежать подписи с неправильным region.

### Option B: MinIO JS client

- Description:
  - Использовать `minio` как S3-compatible клиент.
- Pros:
  - Удобный high-level API для object storage.
- Cons:
  - Дополнительный provider-specific слой поверх уже стандартного S3 API.
  - Меньше прямых reference-примеров в текущем repo/harness по сравнению с AWS SDK.
  - Дополнительный migration risk при переносе transport и при дальнейшем расширении S3 use-cases.

### Option C: Custom signed HTTP client (manual S3 REST + SigV4)

- Description:
  - Писать S3 REST вызовы и подпись запросов вручную.
- Pros:
  - Минимум внешних зависимостей.
- Cons:
  - Высокий риск security/compatibility ошибок в подписи и canonical request.
  - Долгая и дорогая поддержка для MVP без бизнес-выигрыша.

## Decision

- Выбранный вариант:
  - `Option A` — AWS SDK JS v3 `S3Client`.
- Почему выбран:
  - Это самый прямой и низкорисковый путь для S3-compatible интеграции в TypeScript-проекте.
  - Даёт стабильную базу для будущей миграции HTTP transport без переписывания storage adapter.
  - Соответствует research по endpoint/region/signing требованиям Yandex Object Storage.
- Область действия:
  - Все серверные операции загрузки/чтения объектов Epic 2.

### Fixed config contract for Epic 2

- Required env vars:
  - `S3_ENDPOINT` (default: `https://storage.yandexcloud.net`)
  - `S3_REGION` (default: `ru-central1`; для KZ bucket использовать `kz1`)
  - `S3_BUCKET`
  - `S3_ACCESS_KEY_ID`
  - `S3_SECRET_ACCESS_KEY`
- S3 client baseline:
  - `endpoint` = `S3_ENDPOINT`
  - `region` = `S3_REGION`
  - `credentials` = static access key/secret for service account
  - `forcePathStyle = true` для MVP (детерминированный host + совместимость с path-style URL `https://storage.yandexcloud.net/<bucket>/<key>`).
- Auth/signing:
  - AWS Signature V4, ключи сервисного аккаунта; креды только server-side.
- Object key convention (Epic 2):
  - `users/<userId>/files/<fileId>/original.<ext>`

## Consequences

- Плюсы после принятия решения
  - Прозрачная и стандартная интеграция S3-compatible storage в TS.
  - Явные env contracts и runbook снижают ошибки конфигурации.
  - Легче покрывать unit/integration тестами storage adapter.
- Минусы / долг / ограничения
  - Статические ключи требуют дисциплины ротации и безопасного хранения.
  - `forcePathStyle=true` может потребовать пересмотра при переходе на signed public URLs/CDN-стратегии.
- Что нужно мониторить в следующих PR
  - Ошибки подписи (`SignatureDoesNotMatch`) и region mismatch.
  - Ошибки доступа/прав сервисного аккаунта.
  - S3 latency/error-rate на upload path.

## Rollback plan

- Триггеры для пересмотра
  - Неустойчивая работа через AWS SDK v3 с Yandex compatibility.
  - Новые требования, где нужен другой client abstraction или временные credentials-first подход.
- Как откатываемся
  - Новый ADR на альтернативный S3 client/adapter.
  - Сохраняем те же env contracts и object key convention, чтобы минимизировать миграцию.
- Какие артефакты обновляем
  - `docs/04_runbooks/yandex_object_storage.md`
  - `SECURITY.md`
  - `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md`
