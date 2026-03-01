# Staging VPS Deploy + Smoke via GitHub Actions

Runbook для полноразмерных прогонов обработки на staging VPS в Yandex Cloud Kazakhstan.

## Scope

- Деплой текущего git ref на VPS через GitHub Actions workflow.
- Запись runtime-конфига в `env.staging`.
- Прогон DB migrations на staging.
- Опциональный restart и smoke command на VPS.

## Prerequisites

- VPS в Yandex Cloud Kazakhstan доступен по SSH.
- На VPS установлен Node.js (>=24, <25), npm, tar, base64.
- Репозиторий содержит workflow `.github/workflows/staging_vps_deploy_smoke.yml`.
- В GitHub настроено Environment `staging`.

## Runtime env file (`env.staging`)

- Используйте шаблон: `env.staging.example`.
- Для Yandex Object Storage в Казахстане:
  - `S3_ENDPOINT=https://storage.yandexcloud.net`
  - `S3_REGION=kz1`
- Рекомендуется хранить фактическое содержимое `env.staging` в GitHub Environment Secret `STAGING_ENV_FILE` (multiline secret).

## GitHub Environment secrets (`staging`)

Required:

- `STAGING_SSH_PRIVATE_KEY` — приватный ключ для SSH пользователя на VPS.
- `STAGING_SSH_HOST` — хост/IP VPS.
- `STAGING_SSH_USER` — SSH user.
- `STAGING_ENV_FILE` — полное содержимое файла `env.staging`.

Optional:

- `STAGING_SSH_PORT` — SSH port (default `22`).
- `STAGING_APP_DIR` — путь приложения на VPS (default `/opt/gofunnel/staging`).
- `STAGING_RESTART_COMMAND` — команда рестарта приложения/сервисов.
- `STAGING_SMOKE_COMMAND` — команда smoke-проверки после деплоя.

Пример `STAGING_RESTART_COMMAND` (если используется `pm2`):

```bash
pm2 reload gofunnel-http && pm2 reload gofunnel-worker
```

Пример `STAGING_SMOKE_COMMAND`:

```bash
DOTENV_CONFIG_PATH=env.staging npm run db:migrate:status
```

## Manual run (GitHub UI)

1. Открыть Actions -> `Staging VPS Deploy and Smoke`.
2. Нажать `Run workflow`.
3. Выбрать:
   - `ref` (например `main` или commit SHA),
   - `run_smoke` (`true/false`),
   - при необходимости override `restart_command`/`smoke_command`.
4. Дождаться завершения job `deploy`.

## What workflow does on VPS

1. Загружает архив текущего репозитория.
2. Распаковывает в `${STAGING_APP_DIR}`.
3. Пишет `${STAGING_APP_DIR}/env.staging`.
4. Выполняет `npm ci`.
5. Выполняет миграции (`DOTENV_CONFIG_PATH=env.staging npm run db:migrate`).
6. Опционально выполняет restart/smoke commands.

## Post-deploy verification for full transcript tests

- Открыть staging UI и загрузить длинный транскрипт.
- Проверить переходы статусов файла (`queued/processing/ready|failed`).
- Если ошибка повторяется, собрать:
  - worker logs,
  - `last_error_code`, `last_error_message`, `attempt`, `next_run_at`.

## Rollback

- Повторно запустить workflow с предыдущим стабильным `ref`.
- При необходимости откатить миграцию:

```bash
DOTENV_CONFIG_PATH=env.staging npm run db:rollback -- --steps=1
```

Rollback миграций выполняйте только после проверки зависимости от нового кода.
