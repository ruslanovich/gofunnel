# Local HTTP Start/Restart Runbook

Короткая инструкция для стабильного локального запуска HTTP приложения на `http://localhost:3000`.

## Scope

- Запуск и перезапуск локального HTTP сервера.
- Базовая проверка доступности `/health` и `/app`.

## Canonical commands

1. Перейти в корень репозитория:

```bash
cd /Users/murad/Documents/7.\ Product\ Development/gofunnel
```

2. Остановить предыдущий локальный процесс (если был):

```bash
pkill -f "interfaces/http/server_main.ts" || true
```

3. Запустить сервер в foreground (рекомендуемый и канонический способ):

```bash
npm run http:start:local
```

4. В отдельном терминале проверить доступность:

```bash
curl -fsS http://127.0.0.1:3000/health
```

Ожидаемый ответ:

```json
{"status":"ok"}
```

## Quick diagnostics

- Проверка редиректа `/app` без авторизации:

```bash
curl -i http://127.0.0.1:3000/app
```

Ожидается `HTTP/1.1 303 See Other` и `Location: /login?next=%2Fapp`.

- Если `localhost:3000` не открывается:
  - Убедитесь, что процесс жив: `lsof -nP -iTCP:3000 -sTCP:LISTEN`.
  - Проверьте последние логи запуска в текущем терминале.
  - Повторите последовательность restart из раздела `Canonical commands`.

## Note for Codex/agent runs

- Для agent-run нельзя считать надёжным запуск через одноразовый `nohup ... &` в отдельной команде: процесс может завершиться после окончания shell-сессии.
- Каноника для агента: запускать `npm run http:start:local` в живой PTY-сессии и держать её открытой, пока нужна работа приложения.
