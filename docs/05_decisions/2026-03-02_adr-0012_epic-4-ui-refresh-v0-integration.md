# ADR-0012: Epic 4 UI refresh по v0-референсу без переноса кодовой базы

## Context

- Нужно обновить UI основного репозитория `gofunnel` по визуальному и UX-референсу: [gofunnel-v0-design-system](https://github.com/ruslanovich/gofunnel-v0-design-system).
- Жесткие ограничения Epic 4:
  - без изменений backend-доменной логики, DB schema, worker behavior и API контрактов;
  - без поломки/переименования существующих routes;
  - без отдельного frontend rewrite.
- Текущий UI в `gofunnel` рендерится сервером (inline HTML + inline browser script) в `interfaces/http/server.ts`.
- Доступные user-facing страницы/маршруты сейчас:
  - `GET /login`
  - `GET /request-access`
  - `GET /app` (dashboard + overlay)
  - `GET /admin/access-requests`
  - `GET /admin/users`
  - `GET /admin` и `GET /app/*` сейчас placeholder-страницы
- Детали файла не имеют отдельного HTML-route; используются существующие API:
  - `GET /api/files/:id`
  - `GET /api/files/:id/report`
- Дополнительные placeholder-потоки, которые нужно сохранить функциональными:
  - `GET /share/:token` (placeholder shared report page)
  - admin/app placeholder routes.
- External research через MCP `context7`: в текущей сессии MCP-ресурсы недоступны (`resources=[]`), поэтому решение основано на локальном коде `gofunnel` и UI-референсе `gofunnel-v0-design-system`.

## Options considered

### Option A — Скопировать/портировать v0 кодовую базу в основной репозиторий

- Description: перенести Next.js/shadcn UI из v0 практически как есть.
- Pros:
  - быстрый визуальный match.
- Cons:
  - нарушает ограничение «без переноса кодовой базы»;
  - высокий риск поломки существующих routes/контрактов;
  - требует фронтенд-платформенного сдвига, не соответствующего Epic.

### Option B — Инкрементальный UI refresh в текущем server-rendered стеке (chosen)

- Description: оставить текущий transport/rendering, обновлять HTML/CSS/inline-script слоями, ориентируясь на v0 как дизайн-систему.
- Pros:
  - соответствует hard constraints Epic;
  - минимальный риск для backend/API;
  - позволяет PR-sized rollout с быстрым rollback.
- Cons:
  - часть UI-компонентной структуры будет проще, чем в v0 (без React-компонентов);
  - потребуется аккуратная ручная дисциплина по shared-стилям/копирайту.

### Option C — Построить отдельный frontend и проксировать API

- Description: выделить новый UI app и связать с текущими API.
- Pros:
  - максимальная свобода реализации дизайна.
- Cons:
  - фактически big-bang rewrite;
  - противоречит non-goal Epic;
  - увеличивает технический и операционный риск.

## Decision

- Выбранный вариант: Option B (инкрементальный UI refresh в текущем стеке).
- Почему выбран: единственный вариант, одновременно соблюдающий все hard constraints и позволяющий контролируемый rollout.
- Область действия: страницы `login`, `request-access`, `app` dashboard + file details overlay, `admin/access-requests`, `admin/users`, а также визуальная унификация placeholder-потоков.

### A. UI integration approach в текущем стеке

- Сохраняем server-rendered подход (`interfaces/http/server.ts`) и существующие маршруты.
- Добавляем shared layout/style helper(ы) внутри HTTP UI-слоя (например, `interfaces/http/ui/*`), чтобы убрать дублирование разметки/стилей между страницами.
- Реализацию делаем без изменений backend contracts: UI вызывает только уже существующие endpoints.

### B. Styling approach (v0-like look без копирования v0 codebase)

- Не переносим Tailwind/shadcn runtime в текущий репозиторий.
- Вводим lightweight design tokens на уровне CSS-переменных + ограниченный набор reusable utility-классов в server-rendered шаблонах.
- Берем из v0 принципы визуальной системы (spacing, card/table, status badges, typography hierarchy, surface/border/shadow), но реализуем их нативным CSS текущего приложения.

### C. Localization approach (RU-only now, i18n-ready optional)

- Весь user-facing copy в рамках Epic 4 переводится на русский.
- Ошибки API показываются безопасно: базовое RU-сообщение + `error_code`/`error_message` только как plain text (без HTML-инъекций).
- Для готовности к i18n выделяется слой словаря строк (минимум RU namespace в отдельном модуле), но без включения полноценной мультиязычности в Epic 4.

### D. Data mapping strategy для dashboard table

- Источник данных dashboard остается `GET /api/files` и `GET /api/files/:id`.
- Поддерживаемые сейчас поля таблицы:
  - `original_filename` → имя файла
  - `created_at` → дата загрузки
  - `status` → статус обработки
  - `size_bytes` → размер
- Поля из v0, которых нет в текущем API (`client`, `deal_stage`, `duration`, `participants`, `risk_level`, `gaps`, `next_steps`) отображаются как `—` и/или меткой «Скоро», без имитации несуществующей функциональности.
- Affordances сортировки/фильтра допустимы как UI-элементы, если явно не заявляют, что серверная фильтрация уже работает.

### E. Rollout strategy (incremental PRs, no big-bang)

- Выполняем Epic 4 серией PR-4.x с изолированными зонами ответственности:
  - foundation styles/layout;
  - auth pages;
  - dashboard table/search/filter affordances;
  - file details overlay;
  - admin pages;
  - final consistency pass.
- Каждый PR проверяется отдельно и обратимо откатывается без каскадных backend-изменений.

## Consequences

- Плюсы:
  - сохраняется стабильность backend/API;
  - предсказуемое внедрение UI по шагам;
  - единый RU copy + консистентные loading/empty/error состояния.
- Минусы/ограничения:
  - текущий HTML+inline script стек менее компонентный, чем v0 React implementation;
  - часть v0 взаимодействий будет адаптирована упрощенно.
- Что нужно мониторить в следующих PR:
  - отсутствие регрессий auth redirects и admin permissions;
  - корректность отображения `error_code/error_message`;
  - производительность polling/overlay.

## Rollback plan

- Триггеры для отката/пересмотра:
  - регрессии в login/admin/app критичных потоках;
  - рост UI-ошибок из-за рефакторинга шаблонов;
  - нарушение API/route совместимости.
- Как откатываемся:
  - откат последнего PR-4.x без затрагивания backend слоев;
  - возврат к предыдущей версии шаблонов `interfaces/http/server.ts` и связанных UI helper-файлов.
- Какие артефакты/доки обновляем при откате:
  - execution plan Epic 4 (прогресс/статус шага);
  - ADR-0012 (status note/decision amendment, если пересматривается подход).
