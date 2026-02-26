#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "docs" / "00_index" / "README.md"

REQUIRED_LINKS = [
    "docs/01_product/",
    "docs/02_architecture/",
    "docs/03_execution_plans/",
    "docs/04_runbooks/",
    "docs/05_decisions/",
    "docs/06_reference/",
]


def main() -> int:
    if not INDEX.exists():
        print("ERROR: docs/00_index/README.md is missing")
        return 1

    text = INDEX.read_text(encoding="utf-8")
    missing = [link for link in REQUIRED_LINKS if link not in text]
    if missing:
        print("ERROR: docs index is missing required references:")
        for link in missing:
            print(f" - {link}")
        return 1

    print("docs_index_check: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
