#!/usr/bin/env bash
set -euo pipefail

npx tsx --test interfaces/http/server.test.ts
