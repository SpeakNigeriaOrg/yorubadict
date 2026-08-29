#!/usr/bin/env python3
"""Give every entry an address now, from what is already known.

Offline. No credentials, no network, no model. Three sources, in order:

  1. the rule in build/lib/address.mjs           ajami spellings, tone marks,
                                                 the Ajami alphabet
  2. an {{etymid}} a person chose on Wiktionary  "ache", not "pain"
  3. the first few words of the first definition the floor

Run this first. It means the site has a complete set of addresses before the
model is asked anything, so nothing is ever half-built, and check.py has
something to check. Words from the third source are marked provisional: they are
placeholders, so propose.py and review.py replace them without minting a
redirect for an address nobody ever had.

Usage:
    python3 tools/slugs/seed.py            fill every gap
    python3 tools/slugs/seed.py -dry       say what would change, write nothing
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import data, etymid, ledger  # noqa: E402


def _fold_word(word):
    import re
    import unicodedata

    text = unicodedata.normalize("NFD", (word or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", text))


def _unique_in_group(items):
    """Distinct words for one group, preferring a real word over a numbered one.

    A numbered address is a bad address: /o/letter and /o/letter-2 tell a reader
    nothing about which is which. So a collision tries the rule's own answer
    before it tries a number - and that is usually better than the word it
    collided on. The etymid "letter" is shared by o's sixteenth-letter entry and
    by the entry for that letter's *name*, one {{etymid}} across two entries;
    taking the rule's answer gives sixteenth-letter and name, which are both
    right, where numbering gives letter and letter-2, which are both useless.

    A number is the last resort. Every one is counted and reported rather than
    quietly applied, because every one is a question for a person.
    """
    taken, out, numbered = set(), [], []
    for entry_id, word, source, provisional, rule_word in items:
        base = word or rule_word or "sense"
        candidate = base
        if candidate in taken and rule_word and rule_word not in taken:
            candidate, source, provisional = rule_word, "rule", True
        n = 2
        while candidate in taken:
            candidate = f"{base}-{n}"
            n += 1
        if candidate != base and candidate != rule_word:
            numbered.append((entry_id, candidate))
        taken.add(candidate)
        out.append((entry_id, candidate, source, provisional or candidate.rsplit("-", 1)[-1].isdigit()))
    return out, numbered


def main(argv):
    dry = "-dry" in argv
    groups = data.load_groups()
    book = ledger.load()
    etymid_names = etymid.load()
    entries_by_id = json.loads(
        (data.REPO_DIR / "public/data/entries.json").read_text(encoding="utf-8")
    )

    tallies = {"added": 0, "kept": 0, "replaced": 0, "moved": 0}
    sources = {}
    all_numbered = []

    for group in groups["groups"]:
        proposals = []
        for item in group["entries"]:
            existing = book["entries"].get(item["id"])
            if existing and not existing.get("provisional"):
                # Already decided. It still takes up its word in the group, so
                # nothing else can be given the same one.
                proposals.append((item["id"], existing["word"], existing["source"], False, None))
                continue
            if item["derivedWord"]:
                proposals.append((item["id"], item["derivedWord"], "rule", False, item["ruleWord"]))
                continue
            chosen = etymid.for_entry(etymid_names, entries_by_id[item["id"]])
            if chosen:
                proposals.append(
                    (item["id"], _fold_word(chosen["name"]), "etymid", False, item["ruleWord"])
                )
                continue
            proposals.append((item["id"], item["ruleWord"], "rule", True, None))

        settled, numbered = _unique_in_group(proposals)
        all_numbered += [(group["spelling"], eid, word) for eid, word in numbered]

        by_id = {e["id"]: e for e in group["entries"]}
        for entry_id, word, source, provisional in settled:
            existing = book["entries"].get(entry_id)
            if existing and not existing.get("provisional") and existing["word"] == word:
                tallies["kept"] += 1
                continue
            source_entry = by_id[entry_id]
            outcome = ledger.merge(
                book,
                entry_id,
                ledger.record(
                    group["spelling"], word, source,
                    source_entry["written"], source_entry["pos"],
                    source_entry["etymologyNumber"],
                    provisional=provisional,
                ),
            )
            tallies[outcome] += 1
            # Only count where a word actually landed. Counting every merge
            # attempted made the source tally disagree with the outcome tally,
            # which reads like a bug in the ledger rather than in the printing.
            if outcome != "kept":
                sources[source] = sources.get(source, 0) + 1

    if not dry:
        ledger.save(book)

    verb = "would write" if dry else "wrote"
    print(f'{verb} data/url-slugs.json: {tallies["added"]} added, {tallies["kept"]} unchanged, '
          f'{tallies["replaced"]} placeholders filled, {tallies["moved"]} moved')
    print(f'  words came from: ' + ", ".join(f"{k} {v}" for k, v in sorted(sources.items())))
    print(f'  ledger holds {len(book["entries"])} addresses')
    provisional = sum(1 for r in book["entries"].values() if r.get("provisional"))
    print(f'  {provisional} are placeholders, waiting on propose.py')
    if all_numbered:
        print(f'\n  {len(all_numbered)} needed a number, which no reader can interpret.')
        print(f'  These are the first thing to fix in review:')
        for spelling, entry_id, word in all_numbered[:12]:
            print(f"    /{spelling}/{word}")
        if len(all_numbered) > 12:
            print(f"    … {len(all_numbered) - 12} more")
    print(f'\nNow: python3 tools/slugs/check.py')
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
