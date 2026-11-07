#!/usr/bin/env python3
"""Split a .NET test project into N balanced shards for parallel CI jobs.

Why: Tamma.Api.Tests alone took ~16.5 of the ~20 minutes the single `.NET Tests`
job ran, and runs that crossed the job's 25-minute limit were reported as
"cancelled". Splitting it into parallel shards keeps every job short.

How it splits:
  * The unit of work is a test CLASS (never a single test), so a fixture's
    OneTimeSetUp runs once per shard that holds the class, not once per test.
  * Classes are packed greedily, heaviest first, into the currently lightest
    shard (longest-processing-time first). Weights are the per-class seconds in
    dotnet-test-weights.json; a class missing from it (new tests) gets the
    median weight, so new tests are always run, just less evenly balanced.
  * The result is deterministic: every shard job computes the same partition
    from the same inputs, and each class lands in exactly ONE shard. `--check`
    proves that (every listed class assigned once, none twice).

Usage:
  list    dotnet-test-shard.py filter  --tests TESTS.txt --shard I --total N
          -> prints the `dotnet test --filter` expression for shard I (1-based)
  check   dotnet-test-shard.py check   --tests TESTS.txt --total N
          -> prints per-shard class counts and estimated seconds; exits 1 on
             any overlap or gap
  weigh   dotnet-test-shard.py weights --trx RESULTS.trx > dotnet-test-weights.json
          -> regenerate the weights file from a full local or CI .trx run

TESTS.txt is the output of
  dotnet vstest <dll> --ListFullyQualifiedTests --ListTestsTargetPath:TESTS.txt
(one fully-qualified test name per line).
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

WEIGHTS_FILE = Path(__file__).with_name("dotnet-test-weights.json")


def class_of(fqn: str) -> str:
    """`Ns.Class.Method(args.with.dots)` -> `Ns.Class`."""
    head = fqn.split("(", 1)[0].strip()
    return head.rsplit(".", 1)[0] if "." in head else head


def load_classes(tests_file: Path) -> list[str]:
    names = [ln.strip() for ln in tests_file.read_text().splitlines() if ln.strip()]
    if not names:
        sys.exit(f"no tests listed in {tests_file}")
    return sorted({class_of(n) for n in names})


def load_weights() -> dict[str, float]:
    """Per-class seconds INCLUDING the per-class setup overhead.

    A .trx records each test's own duration but not its fixture's OneTimeSetUp
    (in Tamma.Api.Tests, mostly WebApplicationFactory host start-up). That cost
    is real and per class, so it is spread evenly over classes as
    `perClassOverheadSeconds` (run wall-clock minus summed test time, divided
    by class count). Without it, a shard of many tiny classes looks cheap and
    runs long.
    """
    if not WEIGHTS_FILE.exists():
        return {}
    data = json.loads(WEIGHTS_FILE.read_text())
    overhead = float(data.get("perClassOverheadSeconds", 0.0))
    return {k: float(v) + overhead for k, v in data.get("classes", {}).items()}


def partition(classes: list[str], total: int, weights: dict[str, float]) -> list[list[str]]:
    known = [weights[c] for c in classes if c in weights]
    default = statistics.median(known) if known else 1.0
    weighted = sorted(((weights.get(c, default), c) for c in classes), key=lambda x: (-x[0], x[1]))
    shards: list[list[str]] = [[] for _ in range(total)]
    loads = [0.0] * total
    for w, c in weighted:
        i = min(range(total), key=lambda k: (loads[k], k))
        shards[i].append(c)
        loads[i] += w
    return shards


def filter_for(classes: list[str]) -> str:
    # The trailing '.' stops `Ns.Foo` from also matching `Ns.FooBar`.
    return "|".join(f"FullyQualifiedName~{c}." for c in sorted(classes))


def cmd_filter(a: argparse.Namespace) -> None:
    if not 1 <= a.shard <= a.total:
        sys.exit(f"--shard must be in 1..{a.total}")
    shards = partition(load_classes(a.tests), a.total, load_weights())
    mine = shards[a.shard - 1]
    if not mine:
        sys.exit(f"shard {a.shard}/{a.total} is empty — lower --total")
    print(filter_for(mine))


def cmd_check(a: argparse.Namespace) -> None:
    classes = load_classes(a.tests)
    weights = load_weights()
    shards = partition(classes, a.total, weights)
    seen: dict[str, int] = {}
    for i, s in enumerate(shards, 1):
        for c in s:
            if c in seen:
                sys.exit(f"class {c} is in shard {seen[c]} and shard {i}")
            seen[c] = i
    missing = set(classes) - set(seen)
    if missing:
        sys.exit(f"{len(missing)} classes in no shard, e.g. {sorted(missing)[:3]}")
    known = [weights[c] for c in classes if c in weights]
    default = statistics.median(known) if known else 1.0
    unweighted = sum(1 for c in classes if c not in weights)
    for i, s in enumerate(shards, 1):
        est = sum(weights.get(c, default) for c in s)
        print(f"shard {i}/{a.total}: {len(s):4d} classes, ~{est:6.0f}s")
    print(f"{len(classes)} classes, each in exactly one shard; {unweighted} without a recorded weight")


def cmd_weights(a: argparse.Namespace) -> None:
    root = ET.parse(a.trx).getroot()
    ns = {"t": re.match(r"\{.*\}", root.tag).group(0)[1:-1]} if root.tag.startswith("{") else {}
    p = "t:" if ns else ""
    # testId -> class, from the test definitions.
    class_by_id: dict[str, str] = {}
    for ut in root.iterfind(f".//{p}UnitTest", ns):
        tm = ut.find(f"{p}TestMethod", ns)
        if tm is not None:
            cls = tm.get("className", "")
            class_by_id[ut.get("id", "")] = cls.split(",", 1)[0].strip()
    totals: dict[str, float] = {}
    for r in root.iterfind(f".//{p}UnitTestResult", ns):
        cls = class_by_id.get(r.get("testId", ""))
        dur = r.get("duration")
        if not cls or not dur:
            continue
        h, m, s = dur.split(":")
        totals[cls] = totals.get(cls, 0.0) + int(h) * 3600 + int(m) * 60 + float(s)
    times = root.find(f"{p}Times", ns)
    overhead = 0.0
    if times is not None and times.get("start") and times.get("finish") and totals:
        from datetime import datetime

        def ts(v: str) -> datetime:
            # .trx timestamps carry 7 fractional digits; Python accepts 6.
            v = re.sub(r"(\.\d{6})\d+", r"\1", v)
            return datetime.fromisoformat(v)

        wall = (ts(times.get("finish")) - ts(times.get("start"))).total_seconds()
        overhead = max(0.0, (wall - sum(totals.values())) / len(totals))
    out = {
        "_comment": "Per-class test seconds used to balance CI shards. Regenerate with "
        "`.github/scripts/dotnet-test-shard.py weights --trx <run>.trx`. Approximate is fine: "
        "an unknown or stale class still runs, it only balances less evenly.",
        "perClassOverheadSeconds": round(overhead, 3),
        "classes": {k: round(v, 2) for k, v in sorted(totals.items())},
    }
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("filter")
    f.add_argument("--tests", type=Path, required=True)
    f.add_argument("--shard", type=int, required=True)
    f.add_argument("--total", type=int, required=True)
    f.set_defaults(fn=cmd_filter)
    c = sub.add_parser("check")
    c.add_argument("--tests", type=Path, required=True)
    c.add_argument("--total", type=int, required=True)
    c.set_defaults(fn=cmd_check)
    w = sub.add_parser("weights")
    w.add_argument("--trx", type=Path, required=True)
    w.set_defaults(fn=cmd_weights)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
