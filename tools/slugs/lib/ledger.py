"""data/url-slugs.json: which English word each entry's address uses, forever.

The point of this file is that it is a file. The word could be recomputed from
the current first definition on every build - that is what build/lib/
wiktionary-tasks.mjs does for etymology names - but an address is not a
derivation, it is a promise. kaikki-yoruba republishes weekly, so a Wiktionary
editor rewording one definition would silently move a page Google had already
indexed, and nothing would report it. Written down, the word survives the
rewording.

So: the build reads this and never writes it. `merge` is how new entries get in,
and it will not touch a word that is already here.
"""

import json
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = TOOL_DIR.parent.parent
LEDGER_PATH = REPO_DIR / "data/url-slugs.json"

NOTE = (
    "Which English word each entry's web address uses. Written by tools/slugs, "
    "read by build/lib/slugs.mjs, and never regenerated: an address that moves "
    "loses whatever the page had earned. To change one, edit it here and add the "
    "old [spelling, word] pair to that entry's `retired` list so the old address "
    "keeps redirecting. Set `published` to true the first time the site deploys "
    "these addresses - until then a change costs nothing and mints no redirect, "
    "because no reader could have reached the old one."
)

SOURCES = ("etymid", "rule", "model", "hand")


def empty():
    return {"note": NOTE, "version": 1, "published": False, "entries": {}}


def load():
    if not LEDGER_PATH.exists():
        return empty()
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))


def save(ledger):
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    ledger["note"] = NOTE
    # Sorted keys and a trailing newline: this file is reviewed in diffs, and an
    # unstable key order would show every entry as changed on every write.
    LEDGER_PATH.write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def record(spelling, word, source, written, pos, etymology_number,
           approved=False, provisional=False):
    return {
        "spelling": spelling,
        "word": word,
        "source": source,
        "approved": approved,
        # A placeholder nobody chose - what the rule produced so the build always
        # has an address. Replacing one is not a move and mints no redirect,
        # because it was never anybody's link. Anything a person or the model
        # actually chose is not provisional, and replacing that does retire the
        # old address.
        "provisional": provisional,
        # Not the address, and not redundant: this is how a word finds its entry
        # again if the Kaikki id ever changes under it. An id is the key, but it
        # is somebody else's id.
        "written": written,
        "pos": pos,
        "etymologyNumber": etymology_number,
        "retired": [],
    }


def merge(ledger, entry_id, proposal):
    """Add an entry's address, or leave the one it already has alone.

    Returns "added", "kept", "replaced" or "moved".

    "moved" is the one that costs something: a real address changing, which mints
    a redirect so the old one keeps working. "replaced" is a provisional
    placeholder being filled in, which costs nothing because nobody ever linked
    to it.

    Before the site has ever shipped these addresses, nothing costs anything and
    every change is a "replace". That is what `published` is for: while it is
    false the ledger is still being drafted and a redirect would point at a page
    nobody could have reached. Flip it the first time the site deploys - after
    that every change to a settled address mints one, which is the whole reason
    the retired list exists.
    """
    existing = ledger["entries"].get(entry_id)
    if existing is None:
        ledger["entries"][entry_id] = proposal
        return "added"

    if existing["word"] == proposal["word"] and existing["spelling"] == proposal["spelling"]:
        # Everything except the address itself is refreshed: a part of speech or
        # a spelling correction upstream should show up here, and none of it
        # changes where the page lives.
        for field in ("written", "pos", "etymologyNumber"):
            existing[field] = proposal[field]
        # Landing on the same word the rule already guessed is a confirmation,
        # not a no-op. Nearly half of them do - the rule takes the first content
        # words of the first definition, and for "to receive" that is simply
        # right - and leaving those marked provisional said 3,000 entries were
        # still unanswered when every one of them had been answered.
        if existing.get("provisional") and not proposal.get("provisional", False):
            existing["provisional"] = False
            existing["source"] = proposal["source"]
            return "confirmed"
        return "kept"

    if existing.get("provisional") or not ledger.get("published"):
        ledger["entries"][entry_id] = proposal
        return "replaced"

    old = [existing["spelling"], existing["word"]]
    if old not in existing["retired"]:
        existing["retired"].append(old)
    existing.update(
        {k: proposal[k] for k in ("spelling", "word", "source", "written", "pos", "etymologyNumber")}
    )
    existing["approved"] = proposal["approved"]
    existing["provisional"] = proposal.get("provisional", False)
    return "moved"


def address(entry):
    return f'/{entry["spelling"]}/{entry["word"]}'


def retired_addresses(ledger):
    """Every address that used to serve a page, and where it goes now."""
    out = []
    for entry in ledger["entries"].values():
        for spelling, word in entry.get("retired") or []:
            out.append((f"/{spelling}/{word}", address(entry)))
    return out
