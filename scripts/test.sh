#!/usr/bin/env bash
set -euo pipefail

./scripts/typecheck.sh

npx tsx --test interfaces/http/server.test.ts
npx tsx --test infra/db/migrator.smoke.test.ts
npx tsx --test infra/storage/s3_client.test.ts
