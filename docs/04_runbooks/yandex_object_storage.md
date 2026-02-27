# Yandex Object Storage Runbook (Epic 2)

Этот runbook фиксирует конкретную операционную настройку Object Storage для Epic 2 (upload original files).

## Purpose

- Зафиксировать обязательные env-переменные для S3-compatible интеграции.
- Дать точные команды `yc` для bucket/service account/access keys.
- Зафиксировать key layout convention и требования приватности bucket.

## Primary sources

- Yandex Object Storage S3 compatibility:
  - https://yandex.cloud/en/docs/storage/s3/
- Yandex AWS CLI tool setup (`endpoint-url`, `region`, `signature_version=s3v4`):
  - https://yandex.cloud/en/docs/storage/tools/aws-cli
- Yandex static access keys for service accounts:
  - https://yandex.cloud/en/docs/iam/operations/authentication/manage-access-keys
- Yandex bucket create docs (public flags optional, private by default):
  - https://yandex.cloud/en/docs/storage/operations/buckets/create

## Required env vars (server-side only)

- `S3_ENDPOINT` (default: `https://storage.yandexcloud.net`)
- `S3_REGION` (default: `ru-central1`; для KZ bucket использовать `kz1`)
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Security rules:

- Никогда не коммитить key/secret в репозиторий.
- Хранить креды только в secret manager / deployment secrets.
- Bucket должен оставаться private (не включать public ACL flags).

## CLI prerequisites

- Установлен `yc` (проверка: `yc --version`).
- Выполнен `yc init` и выбран профиль.
- Есть IAM-права на folder для:
  - bucket create/get/list,
  - service account create,
  - access binding update,
  - access-key create.

## Discover current context

```bash
yc config profile list
yc config get cloud-id
yc config get folder-id
yc config get storage-endpoint
```

`storage-endpoint` может быть пустым в профиле; в этом случае используем `https://storage.yandexcloud.net`.

## Bucket setup (private)

1. Проверить существующие bucket:

```bash
yc storage bucket list --format json
```

2. Создать bucket (без public flags):

```bash
yc storage bucket create <bucket-name>
```

3. Проверить bucket:

```bash
yc storage bucket get <bucket-name> --full --format json
```

Note:

- Для приватного bucket не используйте `--public-read`, `--public-list`, `--public-config-read`.

## Service account + S3 access keys

1. Создать service account:

```bash
yc iam service-account create --name gofunnel-s3-uploads --format json
```

2. Выдать минимально нужные роли на folder.

MVP read/write paths:

- `storage.uploader` (запись объектов)
- `storage.viewer` (чтение объектов/metadata при необходимости)

```bash
yc resource-manager folder add-access-binding <folder-id> \
  --role storage.uploader \
  --service-account-name gofunnel-s3-uploads

yc resource-manager folder add-access-binding <folder-id> \
  --role storage.viewer \
  --service-account-name gofunnel-s3-uploads
```

3. Создать static access key (для S3 API совместимости):

```bash
yc iam access-key create \
  --service-account-name gofunnel-s3-uploads \
  --format json
```

Из ответа:

- `key_id` -> `S3_ACCESS_KEY_ID`
- `secret` -> `S3_SECRET_ACCESS_KEY` (показывается один раз)

## Endpoint and region values

Для Yandex Object Storage S3 API:

- Endpoint URL: `https://storage.yandexcloud.net`
- Region:
  - `ru-central1` (основной регион)
  - `kz1` (если bucket в KZ регионе)

## Troubleshooting: SignatureDoesNotMatch

Частые причины ошибки `SignatureDoesNotMatch`:

- Неверный `S3_REGION` (частый кейс для Yandex S3-compatible endpoint; region mismatch ломает подпись).
- Неверный `S3_ENDPOINT` (ошибка в URL endpoint или неподходящий endpoint для вашего bucket/окружения).
- Неверные `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
- Clock skew: заметный сдвиг системного времени на сервере приложения.

Проверка:

- Сверить `S3_REGION` со значением региона bucket (`ru-central1` или `kz1`).
- Сверить endpoint с `https://storage.yandexcloud.net` (или подтвержденным endpoint проекта).
- Перевыпустить access key и обновить secrets в runtime окружении.
- Синхронизировать системное время (NTP) и повторить запрос.

## S3 object key layout convention (Epic 2)

Для оригинала файла:

```text
users/<userId>/files/<fileId>/original.<ext>
```

Где:

- `<ext>` только `txt` или `vtt`.

Examples:

- `users/4f4a.../files/8d1c.../original.txt`
- `users/4f4a.../files/79be.../original.vtt`

## Optional smoke check with AWS CLI

If AWS CLI is available:

```bash
aws configure set default.s3.signature_version s3v4
aws configure set default.region ru-central1
aws s3 ls --endpoint-url=https://storage.yandexcloud.net
```

## Checklist before enabling upload in app

- [ ] `S3_BUCKET` создан и приватный.
- [ ] Service account создан и имеет минимальные роли.
- [ ] Access key/secret сохранены в secret storage.
- [ ] Все required env vars заданы в runtime окружении.
- [ ] Выполнен локальный smoke (`yc`/`aws`) без включения public ACL.

## Manual verification: `/app` dashboard (PR-4.1)

Prerequisites:

- Активная сессия пользователя (через `/login` или invite flow).
- Сервер поднят (`npm run http:start`) с валидными `DATABASE_URL` и `S3_*`.

Steps:

1. Открыть `/app` и убедиться, что видны:
   - upload control с accept `.txt,.vtt`
   - таблица файлов (`filename`, `created_at`, `status`, `size`)
   - кнопки `Refresh` и `Load more` (вторая появляется только при `next_cursor`).
2. Upload happy path (`.txt`):
   - выбрать `*.txt`, нажать `Upload`
   - во время запроса кнопка становится disabled и показывает `Uploading...`
   - после успеха файл появляется в списке.
3. Upload validation UX (unsupported type):
   - выбрать `*.pdf`/`*.docx`
   - UI показывает friendly ошибку (без сетевого upload запроса).
4. Upload `413` UX:
   - выбрать файл > 10MB (например, `dd if=/dev/zero of=/tmp/oversize.txt bs=1m count=11`)
   - upload завершается сообщением `File too large`.
5. Overlay details:
   - кликнуть строку файла в таблице
   - убедиться, что overlay показывает metadata из `GET /api/files/:id`
   - убедиться, что есть текст `Report not available yet (Epic 3)`
   - закрыть overlay и убедиться, что состояние страницы/списка не теряется.
6. Polling check:
   - оставить `/app` открытым
   - убедиться, что первая страница списка обновляется автоматически примерно каждые 7 секунд.
