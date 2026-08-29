#!/usr/bin/env python3
"""Two versions of the ledger, side by side, with the differences ranked.

Offline. Written because regenerating 6,273 addresses under a changed brief is
not obviously an improvement - the first attempt at a better brief made them
shorter and worse, and only a comparison on the same entries showed it. So a
regeneration ends with this rather than with a claim.

Measures the three things that were actually going wrong, all of them countable:

  worn out    words so many pages share that they identify none of them
  padded      more than one word where the one-word answer was free
  numbered    a digit on the end, which is the absence of an answer

Usage:
    python3 tools/slugs/compare.py <before.json>           summary and samples
    python3 tools/slugs/compare.py <before.json> -n:40     more samples
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import data, ledger  # noqa: E402

WORN_OUT_AT = 6
NUMBERED = re.compile(r"\d$")


def measure(entries, group_size):
    words = Counter(r["word"] for r in entries.values())
    worn = {w for w, n in words.items() if n >= WORN_OUT_AT}
    out = {
        "pages": len(entries),
        "one word": sum(1 for r in entries.values() if "-" not in r["word"]),
        "worn out": sum(1 for r in entries.values() if r["word"] in worn),
        "numbered": sum(1 for r in entries.values() if NUMBERED.search(r["word"])),
        # More than one word in a group of one is padding unless the one-word
        # answer would have been worn out - there was nothing to tell apart.
        "padded": sum(
            1
            for r in entries.values()
            if "-" in r["word"]
            and group_size.get(r["spelling"]) == 1
            and r["word"].split("-")[0] not in worn
        ),
        "distinct words": len(words),
        "mean chars": sum(len(r["word"]) for r in entries.values()) / max(len(entries), 1),
    }
    return out, worn


def main(argv):
    if not argv or argv[0].startswith("-"):
        raise SystemExit(__doc__)
    before = json.loads(Path(argv[0]).read_text(encoding="utf-8"))["entries"]
    after = ledger.load()["entries"]
    show = next((int(a.split(":", 1)[1]) for a in argv if a.startswith("-n:")), 14)

    group_size = {g["spelling"]: len(g["entries"]) for g in data.load_groups()["groups"]}
    b, worn_before = measure(before, group_size)
    a, worn_after = measure(after, group_size)

    print(f"{'':16} {'before':>10} {'after':>10} {'change':>10}")
    for key in ("pages", "one word", "worn out", "padded", "numbered", "distinct words"):
        delta = a[key] - b[key]
        print(f"  {key:<14} {b[key]:>10} {a[key]:>10} {delta:>+10}")
    print(f"  {'mean chars':<14} {b['mean chars']:>10.1f} {a['mean chars']:>10.1f} "
          f"{a['mean chars'] - b['mean chars']:>+10.1f}")

    shared = [k for k in after if k in before]
    moved = [k for k in shared if after[k]["word"] != before[k]["word"]]
    print(f"\n{len(moved)} of {len(shared)} addresses changed "
          f"({100 * len(moved) // max(len(shared), 1)}%)")

    # Ranked by whether the change fixed something measurable, so a reviewer can
    # read the worst first rather than a random sample.
    def rank(k):
        was, now = before[k]["word"], after[k]["word"]
        score = 0
        if was in worn_before and now not in worn_after:
            score -= 2  # fixed
        if now in worn_after and was not in worn_before:
            score += 2  # broke
        if NUMBERED.search(was) and not NUMBERED.search(now):
            score -= 2
        if NUMBERED.search(now) and not NUMBERED.search(was):
            score += 2
        return score

    got_worse = sorted((k for k in moved if rank(k) > 0), key=rank, reverse=True)
    got_better = sorted((k for k in moved if rank(k) < 0), key=rank)
    print(f"  {len(got_better)} fixed a worn-out or numbered address, "
          f"{len(got_worse)} introduced one")

    for label, keys in (("introduced a problem", got_worse), ("fixed one", got_better)):
        if not keys:
            continue
        print(f"\n  {label}:")
        for k in keys[:show]:
            print(f"    /{after[k]['spelling']:<18} {before[k]['word']:<24} -> {after[k]['word']}")
        if len(keys) > show:
            print(f"    … {len(keys) - show} more")

    print("\nNothing here says the new set is better. Read the samples.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
