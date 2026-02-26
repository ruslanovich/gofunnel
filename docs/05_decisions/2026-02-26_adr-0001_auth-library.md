# ADR-0001: Auth Library (Epic 1)

## Context

- Реализуется Epic 1 (Identity, Onboarding, Admin, Share) в пустом SaaS-репозитории с `plan-before-code`.
- Требования MVP: email+password login, ручной invite onboarding без SMTP, admin-only зоны, share URL только для залогиненных, инвалидирование доступа для disabled users.
- Репозиторий пока без прикладного auth-кода и без существующей DB/auth схемы, поэтому выбор можно сделать чисто и явно.
- Для Next.js/cookie-паттернов и auth-библиотек выполнено MCP research:
  - `docs/06_reference/2026-02-26_epic-1-identity-auth-research-notes.md`
- Связанный execution plan:
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`

## Options considered

### Option A: Auth.js (Credentials provider)

- Description:
  - Использовать Auth.js для login/session flow и credentials authorize, поверх Next.js.
- Pros:
  - Хорошая интеграция с Next.js.
  - Есть готовая модель auth-flow и зрелая экосистема.
  - Поддерживает `jwt` и `database` session strategies.
- Cons:
  - Credentials-provider все равно требует нашей логики верификации пароля и хранения пользователей.
  - Потребуется адаптация под кастомные бизнес-таблицы/состояния (`invites`, `report_shares`, `access_requests`, `disabled` semantics).
  - Для узкого MVP (без OAuth/email providers) добавляет абстракции и связность вокруг Auth.js conventions.

### Option B: Lucia

- Description:
  - Использовать Lucia session-centric подход для кастомной auth реализации.
- Pros:
  - Явные session/cookie-паттерны и хорошие tutorial-примеры для Next.js.
  - Удобно для серверных сессий и контролируемых cookie flows.
  - В документации есть практичные примеры с Argon2 и валидацией сессий.
- Cons:
  - Для нашего MVP все равно нужна значимая ручная логика поверх библиотеки.
  - Экосистема/позиционирование Lucia менялись; риск по долгосрочной предсказуемости выше, чем у более "boring" custom подхода.
  - Меньше value, если мы уже строим сильно кастомные invite/share/admin flows.

### Option C: Custom auth module (Next.js + Postgres + httpOnly cookies)

- Description:
  - Реализовать узкий auth слой внутри проекта: login/logout, session validation, route guards, invite acceptance, password hashing, CSRF controls.
- Pros:
  - Полный контроль над доменной логикой (disabled user, invite one-time TTL, share login redirect).
  - Простая и прозрачная схема БД и токенов без подгонки под внешние adapters/models.
  - Минимум зависимостей, легче аудировать MVP security invariants.
- Cons:
  - Больше ответственности на нас: cookie/security flags, CSRF, password hashing, session invalidation, тесты.
  - Нет "готовых" flows/abstractions от auth framework.

## Decision

- Выбранный вариант:
  - `Option C` (custom auth module) с Next.js server-side handlers и Postgres-backed sessions.
- Почему выбран:
  - Требования Epic 1 завязаны на кастомные сущности (`invites`, `report_shares`, `access_requests`) и строгие правила инвалидирования (`disabled user`, one-time invite, share token semantics).
  - Для MVP скорость выше за счет отсутствия адаптации Auth.js/Lucia моделей под наш домен, при этом security-риск контролируется отдельными ADR по session strategy, token hashing и rate limiting.
  - Next.js официальные паттерны для `httpOnly` cookie/session guards можно использовать напрямую без привязки к конкретной auth-библиотеке.
- Область действия (где применяется):
  - Epic 1 authn/authz в `login/logout`, `invite`, `admin`, `app`, `share`.

## Consequences

- Плюсы после принятия решения
  - Доменные требования и security-инварианты описываются в нашем коде/схеме БД без обходных путей.
  - Проще реализовать точное поведение redirect-after-login для `/share/<token>`.
  - Проще сделать "disabled user => existing sessions invalid" через собственную проверку пользователя при валидации сессии.
- Минусы / долг / ограничения
  - Нужны явные security controls (CSRF, cookie flags, rate limits, password hashing) и покрытие тестами.
  - Возможна переоценка, если позже появятся OAuth/social/email login flows.
- Что нужно мониторить или проверить в следующих PR
  - Четкая реализация CSRF-защиты для state-changing POST endpoints.
  - Поведение при истечении сессии и disabled user.
  - Качество/понятность auth boundary (не размазать проверки по UI handlers).

## Rollback plan

- Триггеры для отката/пересмотра
  - Появление требований к нескольким внешним auth providers (OAuth/SAML/email magic links).
  - Сложность поддержки custom auth становится выше, чем интеграция Auth.js.
  - Повторяющиеся security defects в custom auth boundary.
- Как откатываемся
  - Заводим новый ADR на переход к Auth.js (или другому решению).
  - Сохраняем текущие доменные таблицы (`users`, `invites`, `report_shares`, `access_requests`) и мигрируем только auth/session adapters.
- Какие артефакты/доки нужно обновить при откате
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`
  - `SECURITY.md`
  - ADR-0001 и ADR-0002
