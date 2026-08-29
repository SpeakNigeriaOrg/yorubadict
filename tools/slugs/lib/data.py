"""The dictionary, grouped the way an address groups it.

The grouping comes from build/lib/address.mjs by running it, not by
reimplementing it. That module decides the first segment of every address, and
one copy of that rule is the whole point: a Python copy that disagreed with it
would not fail, it would file a word at an address the site never serves.
"""

import json
import subprocess
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = TOOL_DIR.parent.parent
WORK_DIR = TOOL_DIR / "work"

ENTRIES_PATH = REPO_DIR / "public/data/entries.json"
PRINTER = REPO_DIR / "build/print-address-groups.mjs"


def load_groups(entries_path=None):
    path = Path(entries_path) if entries_path else ENTRIES_PATH
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run `npm run build` first.")
    result = subprocess.run(
        ["node", str(PRINTER), str(path)],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"node build/print-address-groups.mjs failed:\n"
            f"{result.stderr.decode('utf-8', 'replace')}"
        )
    payload = json.loads(result.stdout)
    if payload["totals"]["unresolved"]:
        # address.mjs could not work out where these live. Not a warning: an
        # entry with no address is an entry with no page.
        raise SystemExit(
            f'{payload["totals"]["unresolved"]} entries have no address:\n  '
            + "\n  ".join(
                f'{e["written"]} ({e["pos"]}) {e["id"]}' for e in payload["unresolved"][:20]
            )
            + "\nAdd a rule for them in build/lib/address.mjs."
        )
    return payload


def work_dir():
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    return WORK_DIR


# Arabic script, by codepoint. The test is what the entry is WRITTEN IN, not what
# it is about: òbèjé is an ordinary Latin-script Yorùbá noun whose definition is
# "the Yoruba alphabet of the ajami script", and matching the word "ajami" in a
# definition flagged it as needing an ajami address. What the page is written in
# is a fact about the characters, so it is read off the characters.
ARABIC = __import__("re").compile(r"[\u0600-\u06ff\u0750-\u077f]")


def is_ajami(entry):
    """Is this entry Yorùbá written in the Arabic script?"""
    spelling = (entry.get("canonicalForm") or {}).get("value") or entry.get("headword") or ""
    return bool(ARABIC.search(spelling))
