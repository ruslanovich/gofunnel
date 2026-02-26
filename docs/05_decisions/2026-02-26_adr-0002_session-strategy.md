# ADR-0002: Session Strategy (Epic 1)

## Context

- Epic 1 требует:
  - login/logout,
  - TTL истечения сессии,
  - route guards (`/app/*`, `/admin/*`, `/share/<token>`),
  - инвалидирование доступа disabled user,
  - корректное поведение existing sessions после disable.
- В `ADR-0001` выбран custom auth module.
- Связанные документы:
  - `docs/05_decisions/2026-02-26_adr-0001_auth-library.md`
  - `docs/06_reference/2026-02-26_epic-1-identity-auth-research-notes.md`
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`

## Options considered

### Option A: Server-side sessions in Postgres (opaque session token in cookie)

- Description:
  - В cookie хранится случайный session token/id (httpOnly). Сервер валидирует его через `sessions` table + `users` status.
- Pros:
  - Logout = delete/expire session row.
  - Disable user = все existing sessions становятся невалидны при следующей проверке (join к `users.status`).
  - TTL и rolling expiry реализуются прозрачно на сервере.
  - Хорошо сочетается с кастомными admin/invite flows.
- Cons:
  - DB lookup на каждый authenticated request (или почти каждый).
  - Нужны индексы/cleanup expired sessions.

### Option B: JWT session cookie (self-contained token)

- Description:
  - В cookie хранится подписанный JWT с user claims и expiry.
- Pros:
  - Нет DB lookup на каждый request для базовой проверки.
  - Просто масштабируется stateless.
- Cons:
  - Logout и disable user invalidation сложнее (blacklist/session version/revocation store).
  - При строгом требовании "disabled user sessions invalid now" фактически появляется state store, что убирает главное преимущество JWT.
  - Больше риск ошибок вокруг rotation/revocation и stale claims.

## Decision

- Выбранный вариант:
  - `Option A` (server-side sessions in Postgres).
- Почему выбран:
  - Требование `disabled user` и existing session invalidation делает stateful sessions естественным и более безопасным выбором для MVP.
  - Logout/TTL/forced invalidation реализуются без дополнительных blacklist/session-version обходов.
  - Стоимость DB lookups приемлема для MVP; оптимизируется индексами и request-level caching позже.
- Область действия (где применяется):
  - Все authenticated маршруты и API Epic 1.

## Consequences

- Плюсы после принятия решения
  - Простая логика lifecycle: create session, validate session, delete session, expire session.
  - Единая точка правды для статуса пользователя и сессий.
  - Удобно тестировать acceptance criteria по disable/expiry.
- Минусы / долг / ограничения
  - Нужно планировать cleanup expired sessions и индексы.
  - Растет нагрузка на DB при каждом auth-check.
- Что нужно мониторить или проверить в следующих PR
  - Индекс по `sessions.session_token_hash` и `sessions.expires_at`.
  - Поведение rolling TTL (если делаем обновление `last_seen_at`/`expires_at`) без лишних write amplification.
  - Корректность redirect-to-login + return-to-share flow.

## Rollback plan

- Триггеры для отката/пересмотра
  - Неприемлемая latency/нагрузка на DB от session validation.
  - Переход к edge-heavy architecture, где DB lookup на каждый request становится узким местом.
- Как откатываемся
  - Новый ADR на JWT или hybrid approach (JWT + revocation/session_version).
  - Добавляем миграцию/поля для session version или blacklist store и переводим cookie format.
- Какие артефакты/доки нужно обновить при откате
  - `SECURITY.md`
  - `RELIABILITY.md`
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`
  - ADR-0002
