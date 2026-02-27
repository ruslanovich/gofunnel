# Knowledge Base Index

Главный индекс базы знаний репозитория. Если добавляете новую важную директорию/документ, обновите этот файл.

## Разделы

- Product specs: `docs/01_product/`
- Architecture: `docs/02_architecture/`
- Execution plans: `docs/03_execution_plans/`
- Runbooks: `docs/04_runbooks/`
- Decisions / ADR: `docs/05_decisions/`
- Reference materials: `docs/06_reference/`

## Key process docs and templates

- Agent workflow (plan before code): `docs/02_architecture/agent_workflow.md`
- MCP reference: `docs/06_reference/mcp.md`
- Yandex Object Storage runbook: `docs/04_runbooks/yandex_object_storage.md`
- Admin bootstrap + migrations runbook: `docs/04_runbooks/admin_bootstrap.md`
- ADR template: `docs/05_decisions/ADR_TEMPLATE.md`
- Execution plan template: `docs/03_execution_plans/PLAN_TEMPLATE.md`

## Recent planning artifacts (2026-02-26)

- Epic 1 execution plan: `docs/03_execution_plans/2026-02-26_epic-1-identity-onboarding-share.md`
- Epic 1 research notes (MCP/context7 + supabase): `docs/06_reference/2026-02-26_epic-1-identity-auth-research-notes.md`
- ADR-0001 Auth library: `docs/05_decisions/2026-02-26_adr-0001_auth-library.md`
- ADR-0002 Session strategy: `docs/05_decisions/2026-02-26_adr-0002_session-strategy.md`
- ADR-0003 Rate limit storage: `docs/05_decisions/2026-02-26_adr-0003_rate-limit-storage.md`
- ADR-0004 Token hashing: `docs/05_decisions/2026-02-26_adr-0004_token-hashing.md`

## Recent planning artifacts (2026-02-27)

- Epic 2 execution plan: `docs/03_execution_plans/2026-02-27_epic-2-upload-files.md`
- Epic 3 execution plan: `docs/03_execution_plans/2026-02-27_epic-3-processing-reports.md`
- Epic 3 PR-3.1 execution plan: `docs/03_execution_plans/2026-02-27_pr-3-1-llm-adapter-ajv-validation.md`
- Epic 3 PR-3.1b execution plan (OpenAI provider default): `docs/03_execution_plans/2026-02-27_pr-3-1b-openai-provider-gpt5mini.md`
- Epic 3 PR-3.1c execution plan (Structured Outputs schema normalizer): `docs/03_execution_plans/2026-02-27_pr-3-1c-structured-outputs-schema-normalizer.md`
- Epic 3 PR-3.1d execution plan (use prompt.txt instruction + schema): `docs/03_execution_plans/2026-02-27_pr-3-1d-use-prompt-txt-contract.md`
- Epic 3 PR-3.2 execution plan: `docs/03_execution_plans/2026-02-27_pr-3-2-worker-pipeline-s3-llm-validate-s3-db.md`
- Epic 3 PR-3.3 execution plan: `docs/03_execution_plans/2026-02-27_pr-3-3-get-report-endpoint.md`
- DX CI node dependency install plan: `docs/03_execution_plans/2026-02-27_pr-dx-ci-node-deps-install.md`
- ADR-0005 S3 client + Yandex config: `docs/05_decisions/2026-02-27_adr-0005_s3-client-yandex-object-storage-config.md`
- ADR-0006 Upload transport strategy: `docs/05_decisions/2026-02-27_adr-0006_upload-transport-strategy.md`
- ADR-0007 Files pagination strategy: `docs/05_decisions/2026-02-27_adr-0007_files-list-pagination-strategy.md`
- ADR-0008 Job queue choice: `docs/05_decisions/2026-02-27_adr-0008_job-queue-choice.md`
- ADR-0009 Report storage model: `docs/05_decisions/2026-02-27_adr-0009_report-storage-model.md`
- ADR-0010 Retry/backoff policy: `docs/05_decisions/2026-02-27_adr-0010_retry-backoff-policy.md`
- ADR-0011 LLM + schema validation integration: `docs/05_decisions/2026-02-27_adr-0011_llm-schema-validation-integration.md`

## Важные корневые документы

- Agent map: `AGENTS.md`
- Architecture frame: `ARCHITECTURE.md`
- Contribution process: `CONTRIBUTING.md`
- Reliability principles: `RELIABILITY.md`
- Security principles: `SECURITY.md`
- Quality scoring: `QUALITY_SCORE.md`

## Runtime source directories (current)

- `interfaces/` — transport entry points (CLI, HTTP)
- `app/` — application/orchestration layer (auth use-cases)
- `domain/` — domain types and business concepts
- `infra/` — DB/security/integration implementations

## Стартовые документы (placeholders)

- Architecture boundaries: `docs/02_architecture/boundaries.md`
- Product specs folder README (add when first spec appears): `docs/01_product/`
- Execution plans folder (use dated filenames): `docs/03_execution_plans/`
