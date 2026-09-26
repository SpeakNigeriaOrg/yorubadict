#!/usr/bin/env python3
"""Read every proposed web address, change the ones that are wrong, approve them.

Offline. No credentials, no network.

    python3 tools/slugs/review.py -new        the weekly one: just the words not yet named
    python3 tools/slugs/review.py -priority   ONE worksheet, worst addresses first
    python3 tools/slugs/review.py             one worksheet per letter, all 6,273
    python3 tools/slugs/review.py -apply      read them back into the ledger
    python3 tools/slugs/review.py -letter:a   just that letter
    python3 tools/slugs/review.py -priority -n:150   how many to include

Start with -priority. There are 6,273 addresses and most of them are fine; that
one file holds the ones a measurement can already tell are not, ranked, so an
hour of reading buys the most improvement available rather than the letter A.

Reviewing before the site goes live is worth doing in that order for a second
reason: until then a changed address costs nothing. Afterwards each one needs a
forwarding rule, and Cloudflare allows 2,000 of those against 6,273 pages.

Writes one file per first letter into tools/slugs/work/, which is not committed.
A letter is a sitting: work through it, set `reviewed: yes` at the top, and
-apply marks every word in it as checked. Letters can be done in any order, and
the site works with the unreviewed ones in the meantime - they are just not
promises yet.
"""

import json
import datetime
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit import flags_for  # noqa: E402
from lib import data, ledger, worksheet  # noqa: E402


def _backup(path):
    """Keep a copy of a worksheet before anything is written over it."""
    if not path.exists():
        return
    stamp = datetime.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    backups = path.parent / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backups / f"{path.stem}-{stamp}.md")


def _letter_of(spelling):
    first = spelling[0] if spelling else "?"
    return first if first.isalnum() else "other"


def _collate(only_flagged=False, limit=None, only_new=False):
    """Every group with its current ledger word, bucketed by first letter.

    With only_flagged, one bucket instead - "priority" - holding just the entries
    a measurement can already tell are wrong, worst first. The group's other
    entries come along with it, because a word has to be different from its
    neighbours and a reviewer cannot check that without seeing them.

    With only_new, one bucket - "new" - holding the groups with a word nobody
    has named: an entry the ledger has no record for, or a placeholder. That is
    the weekly queue. An entry with no record shows the address the build is
    serving it at right now, read off entries.json, so the sheet says what is
    live rather than a second guess at it.
    """
    groups = data.load_groups()
    book = ledger.load()
    flags = flags_for(book, groups) if only_flagged else {}
    ranked = list(flags)[: limit or len(flags)]
    wanted = set(ranked)
    served = {}
    if only_new:
        entries = json.loads(data.ENTRIES_PATH.read_text(encoding="utf-8"))
        served = {eid: e.get("path", "").rsplit("/", 1)[-1] for eid, e in entries.items()}
        for group in groups["groups"]:
            for e in group["entries"]:
                record = book["entries"].get(e["id"])
                if not record or record.get("provisional"):
                    wanted.add(e["id"])
    buckets = {}
    for group in groups["groups"]:
        if (only_flagged or only_new) and not any(e["id"] in wanted for e in group["entries"]):
            continue
        rows = []
        for item in group["entries"]:
            existing = book["entries"].get(item["id"])
            if not existing and only_new:
                existing = {"word": served.get(item["id"]) or item["ruleWord"], "source": "rule"}
            if not existing:
                continue
            rows.append(
                {
                    "id": item["id"],
                    "written": item["written"],
                    "pos": item["pos"],
                    "etymologyNumber": item["etymologyNumber"],
                    "definitions": item["definitions"],
                    "ruleWord": item["ruleWord"],
                    "word": existing["word"],
                    "source": existing["source"],
                    "approved": existing.get("approved", False),
                    "flags": flags.get(item["id"], [])
                    or (["not named yet"] if only_new and item["id"] in wanted else []),
                    # Shown so a new word can avoid it, but not offered for
                    # approval: `reviewed: yes` on this sheet vouches for the
                    # new words, not for forty neighbours nobody was asked about.
                    "context": only_new and item["id"] not in wanted,
                }
            )
        if rows:
            bucket = (
                "priority" if only_flagged else "new" if only_new else _letter_of(group["spelling"])
            )
            buckets.setdefault(bucket, []).append(
                {"spelling": group["spelling"], "entries": rows}
            )
    return buckets, book


PRIORITY_PREAMBLE = [
    "Every address below carries a ⚠ saying what is wrong with it, or sits in a",
    "group with one that does. Worst first.",
    "",
    "None of these are broken - check.py owns that, and it passes. These are",
    "addresses a reader would learn nothing from, which is a different problem and",
    "the one this file exists to fix:",
    "",
    "    still a placeholder    nobody has named it; a rule guessed",
    "    numbered               a digit on the end, which names nothing",
    "    says nothing           a category, not a meaning: `name`, `title`",
    "    repeats the spelling   the Yorùbá handed back instead of its meaning",
    "    describes the entry    `noun`, `alternative`, `sense-2`",
    "    very long              nobody will read or type it",
    "",
    "Unflagged entries in a group are shown because your word has to differ from",
    "theirs, and you cannot check that without seeing them. You may change those",
    "too.",
]


NEW_PREAMBLE = [
    "The words Wiktionary gained since the ledger was last written. Each is live",
    "already, at the address shown, but kept out of the sitemap until it is named",
    "here. Entries marked ⚠ are the new ones; the rest of each group is shown",
    "because a new word has to differ from its neighbours.",
    "",
    "Naming one now costs nothing: no redirect, because nothing has linked to it.",
    "To leave one unnamed - a duplicate page awaiting deletion, say - empty its",
    "`word:` line and it stays as it is.",
]


def _rekey():
    """Records whose Kaikki id changed go to the new id before anything else.

    Otherwise a renamed entry shows up here as a new word, and naming it gives
    it a second record claiming the address its first one already holds.
    """
    import subprocess
    done = subprocess.run(["node", str(data.TOOL_DIR / "rekey.mjs")], check=False)
    if done.returncode != 0:
        raise SystemExit("Settle the ambiguous ids above first.")


def write(only=None, priority=False, limit=None, new=False):
    if new:
        _rekey()
    buckets, _ = _collate(only_flagged=priority, limit=limit, only_new=new)
    if new and not buckets:
        print("Every word has a chosen address. Nothing to name.")
        return
    preamble = NEW_PREAMBLE if new else PRIORITY_PREAMBLE if priority else None
    out_dir = data.work_dir()
    written = []
    for letter, groups in sorted(buckets.items()):
        if only and letter != only:
            continue
        totals = {
            "groups": len(groups),
            "entries": sum(len(g["entries"]) for g in groups),
        }
        path = out_dir / f"{letter}.md"
        # Never clobber a sitting in progress. The wiktionary tool learned this
        # the same way: a regenerate that overwrote a half-edited worksheet cost
        # the edits and gave no sign it had.
        #
        # The check below is not enough on its own, and that is not theoretical:
        # `rm -f work/*.md && review.py -priority` walks straight past it, and
        # doing exactly that destroyed 66 edits someone was partway through. So
        # every write also leaves a timestamped copy in work/backups/, which
        # nothing here ever deletes. Cheap - a worksheet is 100 KB - and the one
        # thing that would have made that recoverable without luck.
        _backup(path)
        if path.exists():
            header, _words, _problems = worksheet.parse(path.read_text(encoding="utf-8"))
            if header.get("reviewed", "no").lower() not in ("yes", "y", "true"):
                print(f"  kept   {path.name} — already open, and not applied yet")
                continue
        path.write_text(
            worksheet.render(letter, groups, totals, preamble),
            encoding="utf-8",
        )
        written.append((letter, totals))
    for letter, totals in written:
        print(f'  wrote  {letter}.md — {totals["groups"]} groups, {totals["entries"]} entries')
    unapproved = sum(
        1 for r in ledger.load()["entries"].values() if not r.get("approved")
    )
    kept = sorted((data.work_dir() / "backups").glob("*.md")) if (data.work_dir() / "backups").exists() else []
    print(f"\n{len(written)} files in tools/slugs/work/. {unapproved} addresses not yet checked.")
    if kept:
        print(f"{len(kept)} earlier copies kept in work/backups/, most recent {kept[-1].name}")
    print("Edit the `word:` lines, set `reviewed: yes`, then: python3 tools/slugs/review.py -apply")


def apply(only=None):
    groups = {g["spelling"]: g for g in data.load_groups()["groups"]}
    by_id = {e["id"]: (g["spelling"], e) for g in groups.values() for e in g["entries"]}
    book = ledger.load()
    out_dir = data.work_dir()

    tallies = {"changed": 0, "approved": 0, "unchanged": 0, "unnamed": 0}
    skipped, problems = [], []

    for path in sorted(out_dir.glob("*.md")):
        letter = path.stem
        if only and letter != only:
            continue
        header, words, file_problems = worksheet.parse(path.read_text(encoding="utf-8"))
        problems += [f"{path.name} {p}" for p in file_problems]
        reviewed = header.get("reviewed", "no").lower() in ("yes", "y", "true")
        if not reviewed:
            skipped.append(letter)

        for entry_id, word in words.items():
            if entry_id not in by_id:
                problems.append(f"{path.name}: {entry_id} is not in the dictionary")
                continue
            spelling, source_entry = by_id[entry_id]
            existing = book["entries"].get(entry_id)
            folded = _fold_word(word)
            if not folded:
                # Emptied on purpose: left unnamed, as the new-words sheet says.
                tallies["unnamed"] += 1
                continue
            changed = not existing or existing["word"] != folded

            if changed:
                ledger.merge(
                    book,
                    entry_id,
                    ledger.record(
                        spelling, folded, "hand",
                        source_entry["written"], source_entry["pos"],
                        source_entry["etymologyNumber"],
                        approved=reviewed,
                    ),
                )
                tallies["changed"] += 1
            elif reviewed and not existing.get("approved"):
                # Left as proposed, and the file says it was read. That is an
                # approval - it is the whole reason approval is per file.
                existing["approved"] = True
                existing["provisional"] = False
                tallies["approved"] += 1
            else:
                tallies["unchanged"] += 1

    ledger.save(book)
    print(f'{tallies["changed"]} words changed, {tallies["approved"]} confirmed as they were, '
          f'{tallies["unchanged"]} already settled, {tallies["unnamed"]} left unnamed')
    approved = sum(1 for r in book["entries"].values() if r.get("approved"))
    print(f'{approved} of {len(book["entries"])} addresses checked by hand')
    if skipped:
        print(f'\nnot marked reviewed, so words were taken but not approved: {", ".join(skipped)}')
    if problems:
        print(f"\n{len(problems)} problems:")
        for line in problems[:20]:
            print("  " + line)
    print("\nNow: python3 tools/slugs/check.py")


def _fold_word(word):
    import re
    import unicodedata

    text = unicodedata.normalize("NFD", (word or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", text))


def main(argv):
    flags = {a.split(":", 1)[0]: (a.split(":", 1)[1] if ":" in a else True) for a in argv}
    only = flags.get("-letter") if isinstance(flags.get("-letter"), str) else None
    limit = int(flags["-n"]) if "-n" in flags else None
    if "-apply" in flags:
        apply(only)
    else:
        write(only, priority="-priority" in flags, limit=limit, new="-new" in flags)


if __name__ == "__main__":
    main(sys.argv[1:])
