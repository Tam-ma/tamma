#!/usr/bin/env python3
"""Turn a ReportGenerator Summary.json into a short Markdown coverage report.

    coverage-summary.py <Summary.json> [--title T] [--floor floor.json] [--check]

Prints Markdown (overall + one row per assembly) to stdout. With --floor, each
overall number is shown next to its committed floor. With --check as well, exits 1
when line or branch coverage has dropped more than the floor's `tolerance`
(percentage points) below the floor — the "no regression" ratchet. Raising the
floor is a manual edit to the floor file, done when coverage has gone up.
"""
import argparse
import json
import sys


def pct(covered, total):
    return 100.0 * covered / total if total else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("summary")
    ap.add_argument("--title", default="C# coverage")
    ap.add_argument("--floor")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    with open(args.summary) as f:
        data = json.load(f)
    s = data["summary"]
    line = pct(s["coveredlines"], s["coverablelines"])
    branch = pct(s["coveredbranches"], s["totalbranches"])

    floor = None
    if args.floor:
        with open(args.floor) as f:
            floor = json.load(f)

    out = [f"## {args.title}", ""]
    if floor:
        tol = floor.get("tolerance", 0.0)
        out += [
            "| | Now | Floor |",
            "|:---|---:|---:|",
            f"| **Lines** | **{line:.1f}%** ({s['coveredlines']:,} / {s['coverablelines']:,}) | {floor['line']:.1f}% |",
            f"| **Branches** | **{branch:.1f}%** ({s['coveredbranches']:,} / {s['totalbranches']:,}) | {floor['branch']:.1f}% |",
            "",
            f"Ratchet: fails if either number drops more than {tol} pp below its floor.",
        ]
    else:
        out += [
            f"**Lines {line:.1f}%** ({s['coveredlines']:,} / {s['coverablelines']:,}) · "
            f"**Branches {branch:.1f}%** ({s['coveredbranches']:,} / {s['totalbranches']:,})",
        ]

    out += ["", "| Assembly | Lines | Branches | Coverable lines |", "|:---|---:|---:|---:|"]
    assemblies = sorted(
        data["coverage"]["assemblies"], key=lambda a: -a["coverablelines"]
    )
    for a in assemblies:
        al = pct(a["coveredlines"], a["coverablelines"])
        ab = pct(a.get("coveredbranches", 0), a.get("totalbranches", 0))
        out.append(f"| {a['name']} | {al:.1f}% | {ab:.1f}% | {a['coverablelines']:,} |")
    print("\n".join(out))

    if args.check and floor:
        tol = floor.get("tolerance", 0.0)
        bad = []
        if line < floor["line"] - tol:
            bad.append(f"line coverage {line:.2f}% < floor {floor['line']}% - {tol}")
        if branch < floor["branch"] - tol:
            bad.append(f"branch coverage {branch:.2f}% < floor {floor['branch']}% - {tol}")
        for b in bad:
            print(f"::error::Coverage dropped: {b}", file=sys.stderr)
        if bad:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
