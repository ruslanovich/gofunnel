# ADR-0003: Rate Limit Storage for Access Requests (Epic 1)

## Context

- Для `POST /api/access-requests` в Epic 1 требуется антиспам без внешних captcha/cloud сервисов:
  - honeypot field,
  - rate limit по IP,
  - rate limit по email,
  - anti-duplicate: не чаще 1 заявки на email за 24 часа,
  - time gate (слишком быстрый submit).
- Репозиторий готовится под multi-PR развитие и потенциально multi-instance deployment; состояние антиспама должно быть воспроизводимо.
- Связанные документы:
  - `docs/06_reference/2026-02-26_epic-1-identity-auth-research-notes.md`
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`

## Options considered

### Option A: In-memory counters (process-local)

- Description:
  - Хранить счетчики rate limits в памяти приложения.
- Pros:
  - Очень быстро и просто для single-process dev.
  - Не требует дополнительных таблиц.
- Cons:
  - Не работает корректно при нескольких инстансах.
  - Сброс при рестарте процесса.
  - Слабая воспроизводимость для тестов/диагностики.
  - Не покрывает anti-duplicate 24h без обращения к БД (которое нам все равно нужно).

### Option B: Postgres-backed anti-spam state

- Description:
  - Хранить/вычислять rate-limit и duplicate semantics в Postgres (таблица/таблицы + индексы + UPSERT/queries).
- Pros:
  - Единое состояние для всех инстансов.
  - Естественно сочетается с `access_requests` и проверкой duplicate окна 24ч.
  - Удобно диагностировать и тестировать.
  - Поддерживает индексацию и точные constraints.
- Cons:
  - Дополнительные DB writes/read для публичного endpoint.
  - Нужен cleanup/retention для rate-limit таблиц.

## Decision

- Выбранный вариант:
  - `Option B` (Postgres-backed storage).
- Почему выбран:
  - Требования duplicate window (24ч) и корректность при масштабировании важнее, чем микровыигрыш по latency.
  - Postgres уже является системной зависимостью для Epic 1, и можно использовать SQL/migrations + индексы вместо нового infra-компонента.
- Область действия (где применяется):
  - Только антиспам/anti-abuse для `POST /api/access-requests` в Epic 1 (не глобальный rate limit framework для всего приложения).

## Consequences

- Плюсы после принятия решения
  - Предсказуемое поведение anti-spam в проде и в тестах.
  - Можно реализовать idempotent-like поведение без раскрытия сигналов ботам.
  - SQL constraints/indexes помогают держать логику в source of truth.
- Минусы / долг / ограничения
  - Публичный endpoint получает нагрузку на БД.
  - Нужен retention/cleanup старых rate-limit buckets.
- Что нужно мониторить или проверить в следующих PR
  - Индексы по `(scope, key, window_start)`/аналогичной схеме.
  - Write amplification при всплесках спама.
  - Метрики rejected/silent-drop/accepted событий.

## Rollback plan

- Триггеры для отката/пересмотра
  - Серьезная DB-нагрузка от публичного endpoint.
  - Появление требований к высокому throughput/глобальному rate limiting.
- Как откатываемся
  - Новый ADR на Redis/external rate limiter или hybrid (Redis + DB audit).
  - Сохраняем duplicate-window проверку в Postgres, а burst rate limit переносим во внешнее хранилище.
- Какие артефакты/доки нужно обновить при откате
  - ADR-0003
  - `SECURITY.md`
  - `RELIABILITY.md`
  - `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`
