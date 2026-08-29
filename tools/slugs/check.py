#!/usr/bin/env python3
"""Everything that must be true about data/url-slugs.json before it becomes URLs.

Offline, no credentials, no network. Run it after propose.py, after review.py,
and in CI. Exit code 1 means do not deploy.

The checks are ordered by how much damage the fault does. Two entries sharing an
address is the worst: one of them has no page at all, and nothing else in the
system will say so - the build writes one file, the second write silently wins.

Usage:
    python3 tools/slugs/check.py
    python3 tools/slugs/check.py -v      also list every problem, not a sample
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import data, ledger  # noqa: E402

WORD = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
# Cloudflare Pages allows 2,000 STATIC redirects in a _redirects file (plus 100
# dynamic ones, for the 2,100 combined total the docs lead with - we generate only
# static 301s, so 2,000 is the number that binds). Beyond it the escape hatch is
# Bulk Redirects, a separate dashboard-managed product.
#
# Why this is not a comfortable margin: one retired address is one redirect, and
# retirement begins the moment `published` is true. There are 6,273 addresses, so
# changing more than about 32% of them AFTER launch exhausts the file. The last
# full regeneration changed 34%. That is the same order of magnitude, which makes
# the review order load-bearing: reviewing before publishing costs nothing,
# reviewing after costs a redirect per change and has a ceiling.
RETIRED_LIMIT = 1500

# The longest an address's second half may be. A reader has to recognise their
# word in a search result, and something went wrong upstream long before 40
# characters - one answer was a whole sentence explaining what a name means.
MAX_WORD = 40


class Report:
    def __init__(self, verbose):
        self.verbose = verbose
        self.failures = 0
        self.warnings = 0

    def fail(self, title, items):
        items = list(items)
        if not items:
            print(f"  ok    {title}")
            return
        self.failures += len(items)
        print(f"  FAIL  {title} — {len(items)}")
        for line in items if self.verbose else items[:8]:
            print(f"          {line}")
        if not self.verbose and len(items) > 8:
            print(f"          … {len(items) - 8} more (-v to see them)")

    def warn(self, title, items):
        items = list(items)
        if not items:
            print(f"  ok    {title}")
            return
        self.warnings += len(items)
        print(f"  warn  {title} — {len(items)}")
        for line in items if self.verbose else items[:5]:
            print(f"          {line}")


def main(argv):
    verbose = "-v" in argv
    report = Report(verbose)

    groups = data.load_groups()
    book = ledger.load()
    records = book["entries"]

    # What address.mjs says today, which is the only authority on the first segment.
    spelling_of = {}
    live = {}
    for group in groups["groups"]:
        for item in group["entries"]:
            spelling_of[item["id"]] = group["spelling"]
            live[item["id"]] = item

    print(f'ledger: {len(records)} addresses | dictionary: {len(live)} entries\n')

    # 1. Two entries at one address. The build writes one file per address, so
    #    the loser of a collision has no page and nothing reports it.
    seen = {}
    for entry_id, rec in records.items():
        seen.setdefault(ledger.address(rec), []).append(entry_id)
    report.fail(
        "no two entries share an address",
        (f'{addr} claimed by {len(ids)}: {", ".join(ids)}' for addr, ids in seen.items() if len(ids) > 1),
    )

    # 2. An address that is not URL-safe is an address that does not work.
    report.fail(
        "every word is lowercase a-z0-9 with single hyphens",
        (f'{eid}: {rec["word"]!r}' for eid, rec in records.items() if not WORD.match(rec.get("word") or "")),
    )

    # 3. An address nobody can read, type, or recognise.
    report.fail(
        f"no word is longer than {MAX_WORD} characters",
        (
            f'{eid}: /{rec["spelling"]}/{rec["word"]} ({len(rec["word"])} characters)'
            for eid, rec in records.items()
            if len(rec.get("word") or "") > MAX_WORD
        ),
    )

    # 4. The word is the spelling again. Not broken, but it names nothing: it is
    #    the Yorùbá handed back instead of an English word for it, which is what
    #    a model does when it will not commit to a meaning.
    report.warn(
        "no word merely repeats its own spelling",
        (
            f'{eid}: /{rec["spelling"]}/{rec["word"]}'
            for eid, rec in records.items()
            if rec.get("word") == rec.get("spelling")
        ),
    )

    # 3. A first segment that shadows a page takes that page down.
    from subprocess import run
    reserved = set(json.loads(run(
        ["node", "--input-type=module", "-e",
         "import {RESERVED} from '%s'; process.stdout.write(JSON.stringify([...RESERVED]))"
         % (data.REPO_DIR / "build/lib/address.mjs")],
        capture_output=True, check=True).stdout))
    report.fail(
        "no address shadows a page of the site",
        (f'{eid}: /{rec["spelling"]}/' for eid, rec in records.items() if rec["spelling"] in reserved),
    )

    # 4. The ledger's own idea of the spelling must match address.mjs's. A drift
    #    here means the ledger is describing an address the site never serves.
    report.fail(
        "the ledger agrees with build/lib/address.mjs on every spelling",
        (
            f'{eid}: ledger says /{rec["spelling"]}/, address.mjs says /{spelling_of[eid]}/'
            for eid, rec in records.items()
            if eid in spelling_of and rec["spelling"] != spelling_of[eid]
        ),
    )

    # 4b. Yorùbá written in the Arabic script, whose address does not say so.
    #     Not an error - the address works - but these are the pages hardest to
    #     reach by any other means: the spelling cannot be typed, and nothing
    #     links to them, so the address is where a reader learns what they have.
    entries_by_id = json.loads(
        (data.REPO_DIR / "public/data/entries.json").read_text(encoding="utf-8")
    )
    report.warn(
        "every Ajami address says ajami somewhere",
        (
            f'{eid}: /{rec["spelling"]}/{rec["word"]}'
            for eid, rec in records.items()
            if eid in entries_by_id
            and data.is_ajami(entries_by_id[eid])
            and "ajami" not in f'{rec["spelling"]}/{rec["word"]}'
        ),
    )

    # 5. A record for an entry that no longer exists. Not fatal - it is how a
    #    retired address keeps redirecting - but it should be deliberate.
    orphans = [eid for eid in records if eid not in live]
    report.warn(
        "every ledger record still has an entry",
        (f'{eid} ({records[eid]["written"]}, {records[eid]["pos"]}) -> {ledger.address(records[eid])}'
         for eid in orphans),
    )

    # 6. An entry with no record has no page.
    missing = [eid for eid in live if eid not in records]
    report.fail(
        "every entry has an address",
        (f'{eid} ({live[eid]["written"]}, {live[eid]["pos"]})' for eid in missing),
    )

    # 7. A retired address that is also a live one redirects a page to itself,
    #    or worse, away from itself.
    live_addresses = {ledger.address(r) for r in records.values()}
    clashes = [
        f"{old} is retired but is also live"
        for old, _new in ledger.retired_addresses(book)
        if old in live_addresses
    ]
    report.fail("no retired address is also a live one", clashes)

    retired = ledger.retired_addresses(book)
    report.warn(
        f"retired addresses stay under {RETIRED_LIMIT} (Cloudflare allows 2,000 static)",
        [
            f"{len(retired)} retired addresses need redirects, {2000 - len(retired)} left "
            f"before _redirects overflows and Bulk Redirects is the only way out"
        ]
        if len(retired) > RETIRED_LIMIT
        else [],
    )

    approved = sum(1 for r in records.values() if r.get("approved"))
    by_source = {}
    for r in records.values():
        by_source[r.get("source", "?")] = by_source.get(r.get("source", "?"), 0) + 1

    print()
    print(f"  reviewed by hand : {approved} of {len(records)}"
          f" ({100 * approved / len(records):.0f}%)" if records else "  ledger is empty")
    print(f"  where words came from: " + ", ".join(f"{k} {v}" for k, v in sorted(by_source.items())))
    print(f"  addresses retired    : {len(retired)}")

    print()
    if report.failures:
        print(f"{report.failures} problems. Do not deploy.")
        return 1
    if report.warnings:
        print(f"No problems. {report.warnings} things worth a look.")
        return 0
    print("All checks pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
