#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

MAX_AGENTS_LINES = 200

REQUIRED_FILES = [
    ROOT / "AGENTS.md",
    ROOT / "ARCHITECTURE.md",
    ROOT / "CONTRIBUTING.md",
    ROOT / "SECURITY.md",
    ROOT / "RELIABILITY.md",
    ROOT / "QUALITY_SCORE.md",
    ROOT / ".gitignore",
    ROOT / ".github" / "PULL_REQUEST_TEMPLATE.md",
    ROOT / ".github" / "workflows" / "ci.yml",
    ROOT / ".github" / "ISSUE_TEMPLATE" / "feature.md",
    ROOT / ".github" / "ISSUE_TEMPLATE" / "bug.md",
    ROOT / ".github" / "ISSUE_TEMPLATE" / "tech_debt.md",
    ROOT / "docs" / "00_index" / "README.md",
]

REQUIRED_DOC_DIRS = [
    "docs/00_index",
    "docs/01_product",
    "docs/02_architecture",
    "docs/03_execution_plans",
    "docs/04_runbooks",
    "docs/05_decisions",
    "docs/06_reference",
]

DISALLOWED_TOP_LEVEL_DIRS = {"tmp", "notes", "misc"}

EXPECTED_INDEX_REFERENCES = [
    "docs/01_product/",
    "docs/02_architecture/",
    "docs/03_execution_plans/",
    "docs/04_runbooks/",
    "docs/05_decisions/",
    "docs/06_reference/",
]


def fail(msg: str) -> None:
    print(f"ERROR: {msg}")
    sys.exit(1)


def main() -> None:
    for path in REQUIRED_FILES:
        if not path.exists():
            fail(f"Missing required file: {path.relative_to(ROOT)}")

    for rel in REQUIRED_DOC_DIRS:
        path = ROOT / rel
        if not path.is_dir():
            fail(f"Missing required directory: {rel}")

    agents = ROOT / "AGENTS.md"
    line_count = len(agents.read_text(encoding="utf-8").splitlines())
    if line_count > MAX_AGENTS_LINES:
        fail(f"AGENTS.md too long: {line_count} lines (max {MAX_AGENTS_LINES})")

    index_text = (ROOT / "docs" / "00_index" / "README.md").read_text(encoding="utf-8")
    for ref in EXPECTED_INDEX_REFERENCES:
        if ref not in index_text:
            fail(f"docs index missing reference: {ref}")

    top_level_dirs = {
        p.name for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith(".")
    }
    offenders = sorted(top_level_dirs & DISALLOWED_TOP_LEVEL_DIRS)
    if offenders:
        fail(f"Disallowed top-level directories found: {', '.join(offenders)}")

    print("repo_lint: OK")


if __name__ == "__main__":
    main()
