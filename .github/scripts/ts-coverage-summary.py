#!/usr/bin/env python3
"""Markdown table of TypeScript coverage, one row per package.

    ts-coverage-summary.py <repo-root> <report>...

Each report is a vitest `json-summary` file (per-file entries keyed by absolute
path), given as `path` or `pkg=path`. Files are grouped by their
`packages/<name>/` directory. A `pkg=path` report OWNS that package: the root
run also lists e.g. dashboard files (at 0%, since its own config runs them), and
those rows are ignored in favour of the owning report.
Report-only: always exits 0 when the inputs parse.
"""
import json
import os
import sys
from collections import defaultdict


def main():
    root = os.path.abspath(sys.argv[1])
    totals = defaultdict(lambda: {"lines": [0, 0], "branches": [0, 0]})
    missing = []
    reports = [a.split("=", 1) if "=" in a else [None, a] for a in sys.argv[2:]]
    owned = {pkg for pkg, _ in reports if pkg}
    for owner, path in reports:
        if not os.path.exists(path):
            missing.append(path)
            continue
        with open(path) as f:
            data = json.load(f)
        for file, m in data.items():
            if file == "total":
                continue
            rel = os.path.relpath(file, root).split(os.sep)
            pkg = rel[1] if len(rel) > 2 and rel[0] == "packages" else rel[0]
            if pkg in owned and pkg != owner:
                continue
            for k in ("lines", "branches"):
                totals[pkg][k][0] += m[k]["covered"]
                totals[pkg][k][1] += m[k]["total"]

    def pct(c, t):
        return f"{100.0 * c / t:.1f}%" if t else "–"

    out = ["## TypeScript coverage", "", "| Package | Lines | Branches | Lines total |", "|:---|---:|---:|---:|"]
    for pkg, t in sorted(totals.items(), key=lambda kv: -kv[1]["lines"][1]):
        if t["lines"][1] == 0:
            continue
        out.append(f"| {pkg} | {pct(*t['lines'])} | {pct(*t['branches'])} | {t['lines'][1]:,} |")
    for m in missing:
        out.append(f"\n> Missing report: `{os.path.relpath(m, root)}` (that run failed before writing coverage).")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
