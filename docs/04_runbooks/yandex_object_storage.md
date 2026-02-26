# Yandex Cloud CLI + Object Storage Runbook (MVP)

Этот runbook описывает, как мы документируем и настраиваем доступ к Yandex Object Storage для MVP. Он не запускает реальные команды и не создаёт ресурсы автоматически.

## Purpose

- Зафиксировать стандартный процесс работы с bucket и доступом
- Определить ожидаемые переменные окружения
- Зафиксировать базовые требования по безопасности

## Предпосылки

- Установлен и настроен Yandex Cloud CLI (`yc`)
- Настроен профиль (`yc init` / выбран профиль с нужным cloud/folder)
- Есть доступ к нужному folder и IAM-ролям для создания bucket/service account

## Что нужно уметь (MVP)

### 1. Создать bucket

Примерный поток (уточнять по актуальной документации Yandex Cloud):

- выбрать folder/профиль
- создать bucket с уникальным именем
- оставить bucket private by default

Пример команды (проверить перед выполнением по официальной документации):

```bash
yc storage bucket create --name <bucket-name>
```

### 2. Создать service account и доступ для S3 API

Примерный поток:

- создать service account для приложения
- выдать минимальные IAM права на работу с Object Storage
- создать static access keys (или другой утверждённый способ доступа)
- сохранить секреты только в secret storage / env менеджере

Примерные команды (проверить по официальной документации):

```bash
yc iam service-account create --name <sa-name>
yc resource-manager folder add-access-binding <folder-id> \
  --role <storage-role> \
  --subject serviceAccount:<service-account-id>
yc iam access-key create --service-account-name <sa-name>
```

### 3. Минимальные IAM права (MVP guidance)

Принцип: least privilege.

- Только необходимые операции для приложения (чтение/запись объектов)
- По возможности избегать широких ролей уровня admin
- Права назначать на минимально достаточный scope (bucket/folder/service account)

Конкретную роль и scope фиксируем ADR, если есть выбор/сомнение.

## Convention по S3 keys (путь хранения объектов)

Рекомендуемый шаблон (пример):

```text
<env>/<domain>/<entity>/<entity_id>/<yyyy>/<mm>/<uuid>_<filename>
```

Примеры:

- `dev/uploads/user/123/2026/02/uuid_avatar.png`
- `prod/reports/project/456/2026/02/uuid_export.csv`

Правила:

- Всегда включать `env` (`dev` / `staging` / `prod`)
- Не использовать пользовательские имена как единственный идентификатор
- Избегать "плоских" ключей без namespace
- При необходимости хранить derived/processed файлы в отдельном префиксе (`derived/`, `thumbnails/`)

## Security notes

- Ключи доступа только через env/secret storage (не коммитить в репозиторий)
- Bucket private by default
- Доступ к объектам отдавать через server-side proxy или pre-signed URL
- Выбор стратегии доступа (proxy vs pre-signed URL) оформить ADR позже
- Логировать операции загрузки/выгрузки на стороне приложения (если это влияет на аудит)

## Ожидаемые переменные окружения

Минимум:

- `YANDEX_S3_ENDPOINT`
- `YANDEX_S3_BUCKET`
- `YANDEX_S3_ACCESS_KEY_ID`
- `YANDEX_S3_SECRET_ACCESS_KEY`

Дополнительно (по необходимости):

- `YANDEX_S3_REGION`
- `YANDEX_S3_FORCE_PATH_STYLE`

## Before First Real Setup (Checklist)

- [ ] Создан execution plan для интеграции Object Storage
- [ ] Выполнено исследование S3 SDK/клиента и подхода к доступу
- [ ] Оформлен ADR по стратегии доступа к объектам (proxy / pre-signed URL), если решение влияет на архитектуру
- [ ] Подготовлены secret management и env переменные для окружения
