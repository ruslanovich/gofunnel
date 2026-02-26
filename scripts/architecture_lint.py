#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BOUNDARIES = ROOT / "docs" / "02_architecture" / "boundaries.md"

REQUIRED_SECTIONS = [
    "# Architecture Boundaries",
    "## Purpose",
    "## Planned Layers",
    "## Dependency Rules (initial)",
]


def main() -> int:
    if not BOUNDARIES.exists():
        print("ERROR: missing docs/02_architecture/boundaries.md")
        return 1

    text = BOUNDARIES.read_text(encoding="utf-8")
    for section in REQUIRED_SECTIONS:
        if section not in text:
            print(f"ERROR: boundaries file missing section: {section}")
            return 1

    print("architecture_lint: OK (placeholder)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
