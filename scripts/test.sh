#!/usr/bin/env bash
set -euo pipefail

./scripts/typecheck.sh

npx tsx --test interfaces/http/server.test.ts
npx tsx --test infra/db/migrator.smoke.test.ts
npx tsx --test infra/db/processing_jobs_schema.test.ts
npx tsx --test app/processing/worker.test.ts
npx tsx --test app/processing/report_pipeline_processor.test.ts
npx tsx --test infra/processing/llm_adapter.test.ts
npx tsx --test infra/processing/report_schema_validator.test.ts
npx tsx --test infra/processing/postgres_processing_job_repository.test.ts
npx tsx --test infra/storage/s3_client.test.ts
