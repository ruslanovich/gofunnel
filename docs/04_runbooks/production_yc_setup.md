# Production: первоначальная настройка VM в Yandex Cloud Kazakhstan

## 1. Создание пользователя deploy

```bash
sudo useradd -m -s /bin/bash deploy
```

## 2. Установка Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
node -v  # должно быть v24.x
```

## 3. Создание директории приложения

```bash
sudo mkdir -p /opt/gofunnel/production
sudo chown deploy:deploy /opt/gofunnel/production
```

## 4. systemd unit-файлы

Создать два файла:

```bash
sudo tee /etc/systemd/system/gofunnel-http.service > /dev/null <<'EOF'
[Unit]
Description=GoFunnel HTTP Server
After=network.target postgresql.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/gofunnel/production
ExecStart=/usr/bin/node --import tsx/esm interfaces/http/server_main.ts
EnvironmentFile=/opt/gofunnel/production/env.production
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo tee /etc/systemd/system/gofunnel-worker.service > /dev/null <<'EOF'
[Unit]
Description=GoFunnel Background Worker
After=network.target postgresql.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/gofunnel/production
ExecStart=/usr/bin/node --import tsx/esm interfaces/cli/worker_start.ts
EnvironmentFile=/opt/gofunnel/production/env.production
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Активировать:

```bash
sudo systemctl daemon-reload
sudo systemctl enable gofunnel-http gofunnel-worker
```

## 5. Настройка sudoers для деплой-пользователя

Деплой-пользователь должен перезапускать сервисы без пароля:

```bash
echo 'deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart gofunnel-http, /usr/bin/systemctl restart gofunnel-worker' | sudo tee /etc/sudoers.d/gofunnel-deploy
sudo chmod 440 /etc/sudoers.d/gofunnel-deploy
```

## 6. SSH-ключ для GitHub Actions

На локальной машине:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/gofunnel_deploy_key -N ""
```

Публичный ключ — на VM (добавить в authorized_keys пользователя deploy):

```bash
sudo mkdir -p /home/deploy/.ssh
cat ~/.ssh/gofunnel_deploy_key.pub | ssh murmaaan@<VM_IP> 'sudo tee -a /home/deploy/.ssh/authorized_keys'
ssh murmaaan@<VM_IP> 'sudo chown -R deploy:deploy /home/deploy/.ssh && sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys'
```

Или, если уже на VM:

```bash
sudo mkdir -p /home/deploy/.ssh
echo '<СОДЕРЖИМОЕ .pub КЛЮЧА>' | sudo tee -a /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Приватный ключ (`~/.ssh/gofunnel_deploy_key`) — в GitHub Secret `PROD_SSH_PRIVATE_KEY`.

## 7. GitHub Environment и Secrets

1. Settings → Environments → New environment → `production`
2. Добавить **Environment secrets**:

| Secret | Значение |
|--------|----------|
| `PROD_SSH_PRIVATE_KEY` | Содержимое приватного ключа (целиком, включая BEGIN/END) |
| `PROD_SSH_HOST` | IP адрес VM (например `94.131.91.44`) |
| `PROD_SSH_USER` | `deploy` |
| `PROD_SSH_PORT` | SSH порт (опц., по умолчанию `22`) |
| `PROD_ENV_FILE` | Содержимое env-файла для production (на основе `.env.local`, с prod S3-кредами) |
| `PROD_APP_DIR` | Путь к приложению на VM (опц., по умолчанию `/opt/gofunnel/production`) |

## 8. Проверка

После push в `main` workflow `Production YC Deploy` запустится автоматически.

Для ручного запуска: Actions → Production YC Deploy → Run workflow.

На VM проверить:

```bash
systemctl status gofunnel-http gofunnel-worker
curl -sf http://localhost:3000/
```