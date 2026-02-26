# Agent Workflow: Plan Before Code

Этот документ описывает обязательный процесс для agent-led разработки в репозитории. Цель: сначала собрать знания и зафиксировать решения, затем писать код маленькими проверяемыми шагами.

## Workflow Summary

1. Repo orientation
2. Local research
3. External research (MCP)
4. ADR (если есть значимый выбор)
5. Execution plan (PR-sized steps)
6. Code changes
7. Tests/checks + docs updates + PR

Код до шагов 1-5 не пишем (кроме harness-уровня изменений в документации/шаблонах/индексах).

## Recommended loop (test-first)

1. Write failing tests (or at least explicit assertions of expected behavior/contract).
2. Implement minimal code to make tests pass.
3. Refactor with tests green.
4. Update docs/index if public contract changed.

## Что считать исследованием

### 1. Local research (обязательно)

Минимум:

- Прочитать `AGENTS.md` и `docs/00_index/README.md`
- Найти похожие модули/паттерны через поиск по репозиторию (`rg`)
- Проверить инварианты/границы в `ARCHITECTURE.md`, `docs/02_architecture/*`, ADR и runbooks
- Зафиксировать найденные ограничения в плане или ADR

Артефакт:

- 1-3 строки в execution plan или PR ("что найдено и на что опираемся")

### 2. External research (обязательно для выбора библиотек/интеграций)

Используем MCP `context7` для получения актуальной официальной документации и примеров. Для Supabase/Postgres-паттернов можно использовать MCP `supabase` (поиск docs, схемы, миграции, best practices).

Минимум:

- Найти первоисточник (официальную документацию / reference)
- Проверить актуальный способ реализации для выбранной версии/стека
- Сравнить минимум 2 варианта, если есть развилка решения

Артефакт:

- Короткая ссылка/выдержка в ADR или execution plan (без длинного копипаста)

## Как оформлять ADR

Создавайте ADR в `docs/05_decisions/` если есть:

- выбор библиотеки/фреймворка/provider
- изменение архитектурных границ/слоёв
- инфраструктурное решение с долгосрочными trade-offs

Используйте шаблон: `docs/05_decisions/ADR_TEMPLATE.md`

Практика:

- Именование: `YYYY-MM-DD_<slug>.md`
- Описывать минимум 2 опции (если применимо)
- Фиксировать последствия и rollback plan
- Ссылаться на execution plan и источники исследования

## Как писать Execution Plan

Создавайте план в `docs/03_execution_plans/` до кода.

- Именование: `YYYY-MM-DD_<slug>.md`
- Используйте шаблон: `docs/03_execution_plans/PLAN_TEMPLATE.md`
- Нарезайте шаги так, чтобы каждый шаг был отдельным PR
- Для каждого шага указывайте ожидаемые проверки (tests/lint/typecheck/build)

Требование к шагам:

- Один шаг = одно связное изменение
- Проверяемый результат
- Понятный rollback/recovery подход при необходимости

## Как обновлять индексы и "garden" доки

При добавлении новых важных документов:

- Обновить `docs/00_index/README.md`
- При необходимости обновить README соответствующего раздела (`docs/03_execution_plans/README.md`, `docs/05_decisions/README.md`, и т.п.)
- Добавить ссылки между ADR, execution plan и runbook/reference документами

Если меняется поведение продукта или архитектуры:

- Обновить релевантные product docs (`docs/01_product/*`)
- Обновить ADR / архитектурные документы
- Отразить изменения в runbook/reference, если они влияют на эксплуатацию или интеграции

## Definition of Done для каждого PR

PR считается готовым, если выполнено:

- Есть ссылка на execution plan (и ADR, если решение принималось)
- Прогнаны релевантные проверки (`test`, `lint`, `typecheck`, `build`) или явно объяснено, почему не нужны
- Обновлены docs при изменении поведения/архитектуры/операционных процедур
- Изменение ограничено PR-sized scope и понятно ревьюеру

## Быстрый шаблон-процесс (чеклист)

- [ ] Прочитал `AGENTS.md` и `docs/00_index/README.md`
- [ ] Провёл local research по репозиторию
- [ ] Провёл external research через MCP (`context7`, при необходимости `supabase`)
- [ ] Оформил ADR (если есть архитектурный/технологический выбор)
- [ ] Создал execution plan и нарезал шаги
- [ ] Только теперь начал код
