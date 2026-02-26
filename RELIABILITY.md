# RELIABILITY.md

## Базовые принципы надежности

- Наблюдаемость закладывается с первого production-пути.
- Ошибки должны быть логируемыми и диагностируемыми.
- Изменения в пользовательских сценариях сопровождаются тестами.
- Операционные действия должны иметь runbook в `docs/04_runbooks/`.

## Что собираем (целевая рамка)

- Логи (структурированные)
- Метрики (latency, error rate, throughput)
- Трассировка (request/job path)
- Сигналы по ресурсам и saturation

## Что будет добавлено позже

- SLO/SLI
- incident process
- retry/backoff/idempotency policies
- backup/restore и DR процедуры
