# Epic 1 Research Notes (Identity / Onboarding / Admin / Share)

## Purpose

- Зафиксировать краткие результаты обязательного external research (MCP `context7` + MCP `supabase`) перед ADR и execution plan.
- Не является source of truth для архитектурных решений (решения фиксируются в ADR).

## Repo local context (quick)

- Репозиторий на момент исследования содержит только harness/docs/scripts, без app/auth/db реализации.
- Это позволяет выбрать auth/session/token/rate-limit подходы без обратной совместимости.

## Sources (primary references used)

- Next.js authentication guide (cookie sessions, route protection, logout examples):
  - https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/authentication.mdx
- Next.js BFF guide (cookie + redirect callback pattern):
  - https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/backend-for-frontend.mdx
- Auth.js credentials docs (custom authorize for credentials):
  - https://authjs.dev/getting-started/authentication/credentials
- Auth.js reference (session strategy options `jwt` / `database`):
  - https://authjs.dev/reference
- Lucia v3 tutorials/guides (Next.js + sessions + Argon2 examples):
  - https://v3.lucia-auth.com/tutorials/username-and-password/nextjs-pages
  - https://v3.lucia-auth.com/tutorials/username-and-password/nextjs-app
  - https://v3.lucia-auth.com/guides/validate-session-cookies/nextjs-app
- Supabase docs used as Postgres/migration/SQL patterns reference (not for Auth):
  - https://supabase.com/docs/guides/database/query-optimization
  - https://supabase.com/docs/guides/deployment/database-migrations
  - https://supabase.com/docs/guides/local-development/overview

## Key findings (condensed)

### Next.js (session cookies / guards)

- Официальные примеры Next.js показывают server-side установку cookie через `cookies()` с `httpOnly`, `secure`, `sameSite`, `path`, `expires`.
- Паттерн logout: удалить сессию на сервере и редиректить на `/login`.
- Паттерн route protection: middleware/proxy + redirect на login для защищенных маршрутов.
- Паттерн callback redirect можно использовать как основу для "return to originally requested page" (в нашем случае `/share/<token>` после login).

### Auth.js (Credentials)

- Credentials provider все равно требует ручной логики проверки `email/password`.
- Auth.js поддерживает `jwt` и `database` session strategies.
- Для нашего кейса Auth.js закрывает часть plumbing, но не снимает необходимость кастомной бизнес-логики (`invites`, `report_shares`, access request anti-spam, disabled semantics).

### Lucia (sessions + password auth examples)

- Lucia tutorials показывают прямолинейный session-based flow с cookie + `validateSession`.
- В примерах используются Argon2 (`@node-rs/argon2`) и есть явные замечания про brute-force/login throttling.
- Это подтверждает валидность session-first подхода и важность rate limiting для login/access endpoints.

### Password hashing / token hashing implications

- Для пользовательских паролей нужен password hash (`Argon2id` preferred; `bcrypt` fallback при platform constraints).
- Для случайных invite/share/session bearer tokens рациональнее быстрый детерминированный hash (HMAC-SHA-256 + pepper), а не Argon2/bcrypt, чтобы сохранить индексируемый lookup.

### Postgres / migrations / anti-spam patterns

- Supabase docs (как reference по Postgres-практикам) подтверждают нормальность SQL migration workflow и полезность partial/composite indexes.
- Для anti-spam в `POST /api/access-requests` это поддерживает решение хранить rate-limit state в Postgres с индексами и cleanup.

## Decisions derived from research

- `docs/05_decisions/2026-02-26_adr-0001_auth-library.md`
- `docs/05_decisions/2026-02-26_adr-0002_session-strategy.md`
- `docs/05_decisions/2026-02-26_adr-0003_rate-limit-storage.md`
- `docs/05_decisions/2026-02-26_adr-0004_token-hashing.md`
