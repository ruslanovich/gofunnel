# Execution Plan: PR-3.2a Unify LLM Timeout Source of Truth

## Goal

- Убрать расходящиеся LLM timeout defaults из worker/pipeline/adapter.
- Сделать `LLM_TIMEOUT_MS` единственным runtime source of truth для LLM timeout.
- Зафиксировать единый кодовый дефолт `180000` для всех worker-driven LLM вызовов.

## Non-goals

- Изменение retry/backoff policy.
- Изменение OpenAI provider transport semantics.
- Изменение бизнес-логики report pipeline за пределами выбора timeout.

## Assumptions

- Scope относится к существующему Epic 3 pipeline:
  - `infra/processing/llm_adapter.ts`
  - `app/processing/report_pipeline_processor.ts`
  - `interfaces/cli/worker_start.ts`
- Архитектурное решение не требуется:
  - меняется источник конфигурации существующего adapter flow, без нового слоя/provider/contract.
- Existing outer-timeout semantics must stay intact:
  - adapter inner timeout continues to feed outer timeout fallback.
- External research (official docs):
  - OpenAI Node SDK: client/request `timeout` options can be configured globally or per-request; request timeout override must remain compatible with current provider contract (`/openai/openai-node` via Context7, queried on 2026-03-10).

## Test-first plan

- Add/update tests before implementation:
  - adapter config default test:
    - asserts `loadLlmProviderConfig()` returns `timeoutMs=180000` when `LLM_TIMEOUT_MS` is absent.
  - adapter env override test:
    - asserts `LLM_TIMEOUT_MS=180000` and `LLM_TIMEOUT_MS=90000` are respected.
  - adapter analyze fallback test:
    - asserts `analyzeTranscript({ transcriptText })` passes config timeout to provider when no input timeout override is supplied.
  - processor passthrough test:
    - asserts no `timeoutMs` is sent to adapter when processor override is absent.
  - processor override test:
    - asserts explicit `llmTimeoutMs` still wins when passed intentionally.
  - worker wiring regression:
    - asserts worker startup/runtime no longer reads or injects `WORKER_LLM_TIMEOUT_MS`.
- Negative cases checklist:
  - [ ] authz (`401/403`) not in scope
  - [ ] validation (`400`) limited to config parsing only
  - [ ] not found (`404`) not in scope
  - [ ] revoked/expired (`410`) not in scope
  - [ ] rate limit (`429`) unchanged and covered indirectly by existing retriable timeout/provider tests
- Acceptance criteria -> tests mapping:
  - no env -> `180000` -> adapter config default test
  - `LLM_TIMEOUT_MS=180000` -> adapter env override test
  - `LLM_TIMEOUT_MS=90000` -> adapter env override test
  - worker path without override uses adapter config -> processor passthrough test + worker wiring regression
  - explicit processor override wins if kept -> processor override test
  - legacy `WORKER_LLM_TIMEOUT_MS` removed from runtime -> worker wiring regression + docs/env cleanup checks

## Steps (PR-sized)

1. Add tests for unified timeout semantics
   - Scope:
     - update adapter tests for default/env fallback
     - update pipeline processor tests for override vs passthrough
   - Expected output:
     - red tests describing single-source timeout contract
   - Checks:
     - `./scripts/test.sh` or targeted Node test command

2. Remove duplicate runtime timeout sources
   - Scope:
     - set adapter default to `180000`
     - remove worker timeout env/default wiring
     - remove processor local fallback default while preserving optional override
   - Expected output:
     - green tests with adapter-only default ownership
   - Checks:
     - `./scripts/test.sh`
     - `./scripts/typecheck.sh`

3. Clean docs and config examples
   - Scope:
     - update `.env.example`, `env.staging.example`, reliability/deploy docs, execution plan notes that mention `WORKER_LLM_TIMEOUT_MS`
   - Expected output:
     - docs/env examples reflect one env: `LLM_TIMEOUT_MS`
   - Checks:
     - `python3 scripts/docs_index_check.py`

## Test plan

- Automated:
  - targeted Node tests for `infra/processing/llm_adapter.test.ts`
  - targeted Node tests for `app/processing/report_pipeline_processor.test.ts`
  - full `./scripts/test.sh`
  - `./scripts/typecheck.sh`
- Manual spot-check:
  - verify `rg` no longer finds `WORKER_LLM_TIMEOUT_MS` in runtime code paths

## Risks & mitigations

- Risk:
  - processor may accidentally stop forwarding explicit per-call overrides used by tests or special flows.
  - Mitigation:
    - keep optional `llmTimeoutMs` override contract and cover it with a dedicated test.

- Risk:
  - changing default timeout may accidentally alter outer-timeout fallback behavior.
  - Mitigation:
    - keep current `normalizeTimeoutMs()` and outer-timeout resolution flow untouched; change only the single config default source.

- Risk:
  - stale deployment docs may leave operators with two env knobs.
  - Mitigation:
    - remove `WORKER_LLM_TIMEOUT_MS` from examples/docs and call out VPS cleanup in changelog.

## Docs to update

- `docs/00_index/README.md`
- `docs/03_execution_plans/README.md`
- `.env.example`
- `env.staging.example`
- `RELIABILITY.md`
