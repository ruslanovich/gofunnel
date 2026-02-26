# ADR-0004: Token Hashing for Invites and Share Links (Epic 1)

## Context

- Epic 1 требует invite links и report share tokens.
- По требованиям токены должны храниться как `token_hash`, а не plaintext.
- Сущности с bearer-токенами:
  - `invites` (one-time token + TTL),
  - `report_shares` (revocation + optional TTL),
  - (рекомендуемо) `sessions` при server-side session strategy.
- Связанные документы:
  - `docs/05_decisions/2026-02-26_adr-0002_session-strategy.md`
  - `docs/06_reference/2026-02-26_epic-1-identity-auth-research-notes.md`
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`

## Options considered

### Option A: Store plaintext tokens

- Description:
  - Хранить токен как есть в таблице и сравнивать строкой.
- Pros:
  - Самая простая реализация.
- Cons:
  - Неприемлемо при утечке БД: bearer tokens сразу пригодны к использованию.
  - Нарушает требование Epic 1.

### Option B: Slow password hash for tokens (Argon2/bcrypt)

- Description:
  - Хранить invite/share tokens как пароль (Argon2/bcrypt).
- Pros:
  - Сильная защита при утечке БД.
- Cons:
  - Токены already high-entropy random; slow hash не дает пропорциональной пользы.
  - Поиск по токену становится неудобным/дорогим (нельзя индексировать по детерминированному hash без дополнительного шага).
  - Избыточно для short-lived one-time tokens.

### Option C: Deterministic HMAC-SHA-256 hash with server-side pepper

- Description:
  - Генерировать случайный токен высокой энтропии, хранить только HMAC-SHA-256(token, pepper).
- Pros:
  - Детерминированный hash позволяет индексированный lookup по `token_hash`.
  - Высокая защита при утечке БД (plaintext token не хранится; нужен pepper).
  - Быстро и удобно для invite/share/session checks.
- Cons:
  - Требует надежного хранения pepper-секрета.
  - Нужна дисциплина по token generation/encoding/compare.

## Decision

- Выбранный вариант:
  - `Option C` (HMAC-SHA-256 + server-side pepper) для invite/share tokens; тот же подход допускается для session tokens.
- Почему выбран:
  - Invite/share tokens являются случайными bearer secrets, а не пользовательскими паролями; для них достаточно быстрого детерминированного hash с pepper, что дает хороший баланс security/performance/indexability.
  - Позволяет хранить только `token_hash` и быстро искать записи по индексу.
- Область действия (где применяется):
  - `invites.token_hash`, `report_shares.token_hash`, и при реализации сессий — `sessions.session_token_hash`.

## Consequences

- Плюсы после принятия решения
  - Соответствует требованию "hash only".
  - Простая и быстрая валидация токенов с TTL/revocation/used semantics.
  - Единый utility для token generation/hash/compare.
- Минусы / долг / ограничения
- Нужен секрет `TOKEN_HASH_PEPPER` (или отдельные peppers по типам токенов).
  - Ротация pepper усложняет поддержку уже выданных токенов (потребуется multi-pepper window или массовая инвалидизация).
- Что нужно мониторить или проверить в следующих PR
  - Генерация токенов достаточной энтропии (например, `crypto.randomBytes(32)`).
  - Безопасный формат выдачи токена (base64url) и отсутствие логирования plaintext.
  - Constant-time compare helper (`timingSafeEqual`) там, где сравнение делается в приложении.
  - Явная separate policy для passwords: `Argon2id` (bcrypt fallback only if platform constraints).

## Rollback plan

- Триггеры для отката/пересмотра
  - Требование compliance/policy на другой hash scheme.
  - Практические проблемы с pepper rotation.
- Как откатываемся
  - Новый ADR на версионируемый token hash scheme.
  - Добавляем `hash_version` и поддерживаем параллельную проверку нескольких схем до полного перевыпуска токенов.
- Какие артефакты/доки нужно обновить при откате
  - ADR-0004
  - `SECURITY.md`
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`
