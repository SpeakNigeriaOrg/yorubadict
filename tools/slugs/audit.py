#!/usr/bin/env python3
"""What is wrong with the addresses we have, ranked so review can start somewhere.

Offline. Reads the ledger and reports the addresses least likely to be right, so
a person checking 6,273 of them does not have to start at "a" and hope.

None of these are errors - check.py owns the things that are actually broken.
These are addresses that are legal, unique, and still poor: a number stuck on the
end, a word that describes the entry rather than its meaning, a word that just
repeats the spelling. Every one is a page somebody may land on from a search
result, and the word is most of what they see before they click.

Usage:
    python3 tools/slugs/audit.py
    python3 tools/slugs/audit.py -n:40      how many to list per category
    python3 tools/slugs/audit.py -worksheet write the flagged ones to review
"""

import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import data, ledger  # noqa: E402

# Words that name a category rather than a meaning. "alternative" tells a reader
# nothing: every entry is an alternative of something. These are what the rule
# produces when a definition only points somewhere else.
EMPTY_WORDS = {
    "alternative", "sense", "form", "name", "type", "kind", "variant",
    "spelling", "word", "term", "thing", "one", "any", "the", "used",
    "given", "female", "male", "unisex", "person", "plural", "singular",
}

# A word that describes the entry rather than what it means.
GRAMMAR_WORDS = {
    "noun", "verb", "adjective", "adverb", "pronoun", "particle", "prefix",
    "suffix", "interjection", "preposition", "conjunction", "numeral",
    "letter", "character", "phrase", "proverb", "idiom", "intj", "det",
}


def flags_for(book, groups):
    """{entry_id: [why it is worth a look]}, worst reason first.

    The same measurements audit() prints, returned instead of printed, so
    review.py can build a worksheet of only these. Ranking exists because there
    are 6,273 addresses and an hour of review should buy the most improvement it
    can, not the first letter of the alphabet.
    """
    findings, _written = audit(book, groups)
    order = [
        "still a placeholder",
        "numbered",
        "says nothing",
        "repeats the spelling",
        "describes the entry",
        "very long",
        "four words or more",
    ]
    by_id = {}
    for label in order:
        for _address, record in findings.get(label, []):
            entry_id = next(k for k, v in book["entries"].items() if v is record)
            by_id.setdefault(entry_id, []).append(label)
    return by_id


def audit(book, groups):
    entries = book["entries"]
    written = {}
    for group in groups["groups"]:
        for item in group["entries"]:
            written[item["id"]] = item

    findings = {
        "numbered": [],
        "leads with be": [],
        "says nothing": [],
        "describes the entry": [],
        "repeats the spelling": [],
        "four words or more": [],
        "very long": [],
        "still a placeholder": [],
    }

    for entry_id, record in entries.items():
        word = record["word"]
        spelling = record["spelling"]
        address = f"/{spelling}/{word}"
        parts = word.split("-")
        where = findings

        if re.search(r"-\d+$", word):
            where["numbered"].append((address, record))
        # Yorùbá writes a stative verb as "to be X", so a model naming one keeps
        # the "be" - "be-tough" for what the register would call "tough". None of
        # the 141 names editors chose on Wiktionary starts with it.
        if parts[0] in ("be", "to", "become", "being") and len(parts) > 1:
            where["leads with be"].append((address, record))
        if parts[0] in EMPTY_WORDS or (len(parts) > 1 and set(parts) <= EMPTY_WORDS):
            where["says nothing"].append((address, record))
        # "letter" and "character" describe the entry for a verb and name it for
        # a letter: /a/first-letter is exactly what the page for the letter A
        # should be called. Flagging those buried the real cases under 60 of them.
        grammar = GRAMMAR_WORDS - ({"letter", "character"} if record.get("pos") == "character" else set())
        if any(p in grammar for p in parts):
            where["describes the entry"].append((address, record))
        if spelling in parts and len(parts) > 1:
            where["repeats the spelling"].append((address, record))
        if len(parts) >= 4:
            where["four words or more"].append((address, record))
        if len(word) > 28:
            where["very long"].append((address, record))
        if record.get("provisional"):
            where["still a placeholder"].append((address, record))

    return findings, written


def main(argv):
    flags = {a.split(":", 1)[0]: (a.split(":", 1)[1] if ":" in a else True) for a in argv}
    show = int(flags["-n"]) if "-n" in flags else 15

    book = ledger.load()
    groups = data.load_groups()
    findings, written = audit(book, groups)
    total = len(book["entries"])

    print(f"{total} addresses\n")
    sources = Counter(r.get("source", "?") for r in book["entries"].values())
    approved = sum(1 for r in book["entries"].values() if r.get("approved"))
    print("  where the words came from: " + ", ".join(f"{k} {v}" for k, v in sources.most_common()))
    print(f"  checked by hand: {approved}")
    print(f"  one word: {sum(1 for r in book['entries'].values() if '-' not in r['word'])}"
          f"  two: {sum(1 for r in book['entries'].values() if r['word'].count('-') == 1)}"
          f"  three or more: {sum(1 for r in book['entries'].values() if r['word'].count('-') >= 2)}")

    flagged = set()
    print("\nWorth looking at, worst first:\n")
    for label, rows in sorted(findings.items(), key=lambda kv: -len(kv[1])):
        if not rows:
            continue
        print(f"  {label} — {len(rows)}")
        for address, record in rows[:show]:
            item = written.get(
                next(k for k, v in book["entries"].items() if v is record), {}
            )
            definition = (item.get("definitions") or [""])[0][:56]
            print(f"      {address:<40} {record['written']}  {definition}")
        if len(rows) > show:
            print(f"      … {len(rows) - show} more")
        print()
        flagged.update(id(r) for _a, r in rows)

    unique = {id(r) for rows in findings.values() for _a, r in rows}
    print(f"{len(unique)} of {total} addresses flagged ({100 * len(unique) / total:.0f}%).")
    print("None of these are broken - check.py owns that. They are addresses a")
    print("reader would learn nothing from, which is a different problem and the")
    print("one review exists to fix.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
