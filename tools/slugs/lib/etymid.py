"""Etymology names already chosen by a person, which outrank anything proposed.

An {{etymid}} on Wiktionary is a name a human picked for one etymology so that
compounds can point at it - "ache" rather than the "pain" that was proposed for
ro's sixth etymology, "teach" rather than "build" for kọ's second. Those
decisions were made while reading the whole page, and they are better than
anything this tool would come up with. Where one exists, it is the word.

Two sources, both already in the repo:

  tools/wiktionary/records/*-etymid-*.json   names this project wrote, with the
                                            revision they landed in
  tools/wiktionary/records/*-pointers-*.json namesOnParent - a live snapshot of
                                            every name on a page at the moment
                                            pointers ran, so it also picks up
                                            names other editors wrote
  public/data/wiktionary-tasks.json          anchors already on a page, for the
                                            pages still in the work queue

An etymid names an etymology section, and a section can hold several entries -
ẹ etymology 4 holds four. So this maps to (page, etymology), never to an entry,
and the caller has to deal with the fact that four entries may want one word.
"""

import json
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = TOOL_DIR.parent.parent
RECORDS_DIR = REPO_DIR / "tools/wiktionary/records"
TASKS_PATH = REPO_DIR / "public/data/wiktionary-tasks.json"


def _add(names, page, etymology, name, source):
    if not (page and etymology and name):
        return
    key = (page, str(etymology))
    # Later runs win: a record written today reflects the page better than one
    # written last week, and records are read in filename order, which is
    # timestamp order.
    names[key] = {"name": name, "source": source}


def load():
    """{(page, etymologyNumber): {"name", "source"}} for every name we can see."""
    names = {}

    if TASKS_PATH.exists():
        tasks = json.loads(TASKS_PATH.read_text(encoding="utf-8"))
        for page in tasks.get("pages") or []:
            for anchor in page.get("anchors") or []:
                if anchor.get("alreadyPresent"):
                    _add(
                        names,
                        page["page"],
                        anchor.get("etymologyNumber"),
                        anchor.get("slug"),
                        "wiktionary-tasks",
                    )

    if RECORDS_DIR.exists():
        for path in sorted(RECORDS_DIR.glob("*.json")):
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("job") == "etymid":
                if not record.get("saved"):
                    continue
                for item in record.get("names") or []:
                    _add(names, record["page"], item.get("etymology"), item.get("name"), path.name)
            elif record.get("job") == "pointers":
                for etymology, name in (record.get("namesOnParent") or {}).items():
                    _add(names, record["parent"], etymology, name, path.name)

    return names


def for_entry(names, entry):
    """The chosen name for this entry's etymology section, if there is one.

    Matched on the Wiktionary page title and the etymology number, which is what
    an {{etymid}} is scoped to. An entry with no numbered etymology can never
    have one - that is 71% of the dictionary, and the reason an etymid could
    never have been the address on its own.
    """
    number = entry.get("etymologyNumber")
    if number is None:
        return None
    return names.get((entry["headword"], str(number)))
