"""The build's own output, read back.

build/lib/wiktionary-tasks.mjs already works out which etymologies need names,
proposes one for each, and lists the words that would point at them. This tool
does not re-derive any of that - it reads it, shows it to you, and carries out
what you approve.
"""

import json
import re
import unicodedata
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = TOOL_DIR.parent.parent
WORK_DIR = TOOL_DIR / "work"
RECORDS_DIR = TOOL_DIR / "records"

TASKS_PATH = REPO_DIR / "public/data/wiktionary-tasks.json"
ENTRIES_PATH = REPO_DIR / "public/data/entries.json"


def work_dir_for(page):
    directory = WORK_DIR / page.replace("/", "∕")
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def load():
    for path in (TASKS_PATH, ENTRIES_PATH):
        if not path.exists():
            raise SystemExit(f"Missing {path}. Run `npm run build` first.")
    tasks = json.loads(TASKS_PATH.read_text(encoding="utf-8"))
    entries = json.loads(ENTRIES_PATH.read_text(encoding="utf-8"))
    by_page = {}
    for entry in entries.values():
        by_page.setdefault(entry["headword"], []).append(entry)
    return tasks, by_page


def _toneless(text):
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)
    )


def find_task(tasks, page):
    for task in tasks["pages"]:
        if task["page"] == page:
            return task
    near = [p["page"] for p in tasks["pages"] if _toneless(p["page"]) == _toneless(page)]
    hint = f' Did you mean {" or ".join(repr(n) for n in near)}?' if near else ""
    raise SystemExit(
        f'"{page}" is not in the work queue.{hint}\n'
        f'The queue holds the {len(tasks["pages"])} pages where a word points at '
        f"an ambiguous spelling."
    )


def definitions_for(entries, etymology_number):
    """Every meaning one etymology covers, not just the first.

    `ta` etymology 6 runs "to shoot" / "to sting" / "to be spicy" / "to kick" /
    "to pick". Checking only the first would reject a page that is perfectly
    well aligned.
    """
    out = []
    for entry in entries:
        if entry.get("etymologyNumber") != etymology_number:
            continue
        for sense in entry.get("senses") or []:
            gloss = (sense.get("glosses") or [None])[0]
            if gloss and gloss not in out:
                out.append(gloss)
    return out


def identity_of(entries, etymology_number):
    for entry in entries:
        if entry.get("etymologyNumber") == etymology_number:
            ipa = (entry.get("ipa") or [{}])[0].get("ipa")
            return {
                "spelling": (entry.get("canonicalForm") or {}).get("value"),
                "pos": entry.get("pos"),
                "ipa": ipa,
            }
    return {"spelling": None, "pos": None, "ipa": None}
