#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required for typecheck. Install Node.js/npm and retry." >&2
  exit 1
fi

npm run typecheck
