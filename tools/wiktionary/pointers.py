#!/usr/bin/env python3
"""Point each compound at one meaning of the word it was built from.

    python pointers.py -parent:kọ -propose     write the worksheet
    python pointers.py -parent:kọ -check       read it back — no network
    python pointers.py -parent:kọ -simulate    show the edits, save nothing
    python pointers.py -parent:kọ              show each edit, ask, save

The other half of etymid.py. That names the etymologies on one page; this puts
idN= on the words built from them, so that

    {{af|yo|à-|kọ|tọ́|t2=to write}}

becomes

    {{af|yo|à-|kọ|tọ́|t2=to write|id2=write}}

and the dictionary stops guessing which kọ that was.

One parent word per run, but many pages: the parent plus one page per compound.
The confirmation stays per page, so nothing is applied in bulk.

The names come from the parent page as it is RIGHT NOW, never from the build
output's proposedValue. That is not caution for its own sake: our snapshot
proposes "build" for kọ's etymology 2 and the page says "teach", because a
person read the evidence and chose better. Nine pointers would have been born
dangling.
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("PYWIKIBOT_DIR", str(Path(__file__).resolve().parent))

import pywikibot
from pywikibot import config
from pywikibot.bot import ExistingPageBot

from lib import components, data, record, wikitext, worksheet

LANGUAGE = "Yoruba"
LANG_CODE = "yo"


def yoruba_section(page, site):
    """The Yoruba span of a page, as (parsed, start, end) or (None, None, None)."""
    parsed = wikitext.parse_page(page.text, site)
    start, end = wikitext.language_span(parsed.sections, LANGUAGE)
    return (parsed, start, end) if start is not None else (None, None, None)


def live_names(parent_page, site):
    """The {{etymid}} names on the parent, keyed by etymology number.

    Read from the page, not from our data. This is the whole contract of this
    script: a pointer is only ever written against a name that exists.
    """
    parsed, start, end = yoruba_section(parent_page, site)
    if parsed is None:
        raise SystemExit(f'No {LANGUAGE} section on "{parent_page.title()}".')
    names = {}
    for index, number, stop in wikitext.etymology_sections(parsed.sections, start, end):
        span = wikitext.span_content(parsed.sections, index, stop)
        found = wikitext.existing_etymid(span, LANG_CODE)
        if found:
            names[number] = found
    return names


def collect(task, names):
    """One item per reference, with the live name it would point at."""
    items = []
    for reference in task.get("references") or []:
        section = reference.get("matchedSection")
        items.append(
            {
                "word": reference["word"],
                "page": reference["page"],
                "argument": reference["argument"],
                "component": reference["component"],
                "template_name": reference["template"].split("|")[0].strip("{ "),
                "template": reference["template"],
                "definition": reference.get("definition") or "",
                "meaning": reference.get("meaning"),
                "tier": reference["tier"],
                "why": reference.get("why") or "",
                "section": section,
                # the live name, or nothing if that etymology is unnamed or the
                # reference was never tied to one
                "name": names.get(section, "") if section else "",
                "matched_definition": reference.get("matchedDefinition"),
            }
        )
    return items


HEADER = """# {parent} — pointing its compounds at one meaning

```
parent:   {parent}
language: {language}
```

Names that exist on **{parent}** right now:

{names}

Edit the `id:` lines. Each must be one of the names above, or blank to skip
that word. Everything else is reference material and is ignored.
"""


def render(parent, names, items):
    lines = [
        HEADER.format(
            parent=parent,
            language=LANGUAGE,
            names="\n".join(
                f"    {number}. {name}" for number, name in sorted(names.items(), key=lambda kv: int(kv[0]))
            )
            or "    (none — run etymid.py on this page first)",
        )
    ]
    for item in items:
        lines.append(f'## {item["word"]}   (page {item["page"]}, argument {item["argument"]})')
        lines.append("")
        lines.append(f'    id: {item["name"]}')
        lines.append("")
        lines.append(f'    means     "{item["definition"]}"')
        lines.append(f'    template  {item["template"]}')
        if item["meaning"]:
            lines.append(f'    component "{item["component"]}" glossed "{item["meaning"]}"')
        else:
            lines.append(f'    component "{item["component"]}" — no meaning recorded')
        if item["section"]:
            lines.append(
                f'    matched   Etymology {item["section"]} — {item["matched_definition"]}'
            )
        else:
            lines.append(f'    unmatched {item["why"]}')
        lines.append("")
    return "\n".join(lines)


def parse_worksheet(markdown):
    """The id: line under each `## <word>   (page X, argument idN)` heading."""
    import re

    chosen, current = {}, None
    for line in markdown.splitlines():
        heading = re.match(r"^##\s+\S+\s+\(page\s+(\S+),\s+argument\s+(id\d+)\)", line)
        if heading:
            current = (heading.group(1), heading.group(2))
            continue
        if line.startswith("## "):
            current = None
        match = re.match(r"^\s*id:\s*(.*)$", line)
        if match and current:
            chosen[current] = match.group(1).strip()
    return chosen


# ---------------------------------------------------------------------------


class PointerBot(ExistingPageBot):
    """One compound page per call."""

    use_redirects = False

    def __init__(self, by_page, names, parent, **kwargs):
        super().__init__(**kwargs)
        self.parent = parent
        self.by_page = by_page
        self.names = set(names.values())
        self.results = []

    def treat_page(self):
        page = self.current_page
        item = self.by_page[page.title()]
        parsed, start, end = yoruba_section(page, page.site)
        if parsed is None:
            pywikibot.warning(f'{page.title()}: no {LANGUAGE} section — skipped')
            return

        section = "".join(
            parsed.sections[i].title + parsed.sections[i].content for i in range(start, end)
        )
        template, problem = components.find_template(
            section, item["template_name"], item["argument"], item["component"]
        )
        if problem:
            pywikibot.error(f'{page.title()}: {problem}')
            return

        already = components.existing_pointer(template, item["argument"])
        if already:
            pywikibot.info(
                f'  {page.title()}: already points at "{already}" — left alone'
            )
            return
        if item["name"] not in self.names:
            pywikibot.error(
                f'{page.title()}: "{item["name"]}" is not a name on the parent page.'
            )
            return

        before_template = str(template)
        components.add_pointer(template, item["argument"], item["name"])
        after_template = str(template)

        # Replace inside the Yoruba section only, and rebuild the page from
        # the section list. A plain page.text.replace would scan from the top,
        # and a compound's page carries other languages - matching the same
        # string in one of those would edit the wrong entry.
        replacements = {}
        for i in range(start, end):
            if before_template in parsed.sections[i].content:
                replacements[i] = parsed.sections[i].content.replace(
                    before_template, after_template, 1
                )
                break
        if not replacements:
            pywikibot.error(f"{page.title()}: could not place the change.")
            return
        new_text = wikitext.reassemble(parsed, replacements)

        pywikibot.info("")
        pywikibot.info(f'  {item["word"]} — "{item["definition"][:60]}"')
        pywikibot.info(f"      - {before_template}")
        pywikibot.info(f"      + {after_template}")
        pywikibot.info("")

        summary = (
            f'Add {item["argument"]}= so this points at one meaning of '
            f'[[{self.parent}]] (semi-automated, each edit reviewed by hand)'
        )
        started = datetime.now(timezone.utc).isoformat()
        oldrevid = page.latest_revision_id
        saved = self.put_current(
            new_text, summary=summary, minor=False, bot=False,
            watch="watch", show_diff=False,
        )
        self.results.append(
            {
                "page": page.title(),
                "word": item["word"],
                "argument": item["argument"],
                "name": item["name"],
                "before": before_template,
                "after": after_template,
                "oldrevid": oldrevid,
                "saved": bool(saved),
                "startedAt": started,
                # each compound is its own page, so its own revision
                "newrevid": page.latest_revision_id if saved else None,
            }
        )


# ---------------------------------------------------------------------------

USAGE = """
  python pointers.py -parent:<page> [-propose | -check | -regenerate] [-simulate]
"""


def main():
    leftover = pywikibot.handle_args()
    parent = mode = None
    regenerate = always = False
    for argument in leftover:
        if argument.startswith("-parent:"):
            parent = argument[len("-parent:"):]
        elif argument in ("-propose", "-check"):
            mode = argument[1:]
        elif argument == "-regenerate":
            mode, regenerate = "propose", True
        elif argument == "-always":
            always = True
        else:
            raise SystemExit(f"Unknown argument {argument!r}\n{USAGE}")
    if not parent:
        raise SystemExit(USAGE)
    if always and not config.simulate:
        raise SystemExit(
            "\n  -always skips the confirmation, and this script saves nothing "
            "without one.\n  It is accepted only together with -simulate.\n"
        )

    tasks, _ = data.load()
    task = data.find_task(tasks, parent)
    site = pywikibot.Site()
    directory = data.work_dir_for(parent)
    path = directory / "pointers.md"

    pywikibot.info("")
    parent_page = pywikibot.Page(site, parent)
    names = live_names(parent_page, site)
    pywikibot.info(
        f'  {parent}: {len(names)} of its etymologies are named on Wiktionary right now'
    )
    if not names:
        raise SystemExit(
            f'\n  Nothing to point at. Run `etymid.py -page:{parent}` first.\n'
        )

    items = collect(task, names)

    if mode == "propose":
        if path.exists() and not regenerate:
            raise SystemExit(
                f"\n  A worksheet already exists at {path}.\n"
                f"  Use -regenerate to refresh it, keeping your id: lines.\n"
            )
        if path.exists():
            previous = parse_worksheet(path.read_text(encoding="utf-8"))
            for item in items:
                key = (item["page"], item["argument"])
                if key in previous:
                    item["name"] = previous[key]
            pywikibot.info("  kept the id: lines already in the worksheet")
        path.write_text(render(parent, names, items), encoding="utf-8")
        ready = sum(1 for i in items if i["name"])
        pywikibot.info(
            f"  {len(items)} compounds: {ready} with a name, {len(items) - ready} needing you"
        )
        pywikibot.info("")
        pywikibot.info(f"  {path}")
        pywikibot.info("")
        return

    if not path.exists():
        raise SystemExit(f'\n  No worksheet. Run `-parent:{parent} -propose` first.\n')
    chosen = parse_worksheet(path.read_text(encoding="utf-8"))
    for item in items:
        key = (item["page"], item["argument"])
        if key in chosen:
            item["name"] = chosen[key]

    writable = [i for i in items if i["name"]]
    unknown = [i for i in writable if i["name"] not in set(names.values())]
    if unknown:
        pywikibot.info("")
        for item in unknown:
            pywikibot.error(
                f'{item["word"]}: "{item["name"]}" is not a name on {parent}. '
                f'Available: {", ".join(sorted(set(names.values())))}'
            )
        raise SystemExit("\n  Nothing was sent.\n")

    if mode == "check":
        pywikibot.info("")
        for item in items:
            label = f'-> {item["name"]}' if item["name"] else "skipped (id: is blank)"
            pywikibot.info(f'  {item["word"]:22} {item["argument"]:5} {label}')
        pywikibot.info("")
        pywikibot.info(f"  {len(writable)} pointers would be written. No network was used.")
        pywikibot.info("")
        return

    if not writable:
        raise SystemExit("\n  Every id: line is blank. Nothing to do.\n")

    by_page = {}
    for item in writable:
        by_page[pywikibot.Page(site, item["page"]).title()] = item
    bot = PointerBot(
        by_page, names, parent,
        generator=[pywikibot.Page(site, i["page"]) for i in writable],
        always=always,
    )
    bot.run()

    landed = [r for r in bot.results if r["saved"]]
    if landed and not config.simulate:
        # One record per parent word, holding one entry per compound edited.
        # Each carries the diff the server recorded for that page - not the
        # parent's, which is what routing this through record.write would have
        # fetched, and which never changed.
        import json

        for result in landed:
            result["realizedDiff"] = record.realized_diff(
                site, result["page"], result["newrevid"]
            )
            result["realizedShowsOurChange"] = (
                result["after"].split("|")[-1].rstrip("}") in result["realizedDiff"]
            )
        finished = datetime.now(timezone.utc).isoformat()
        data.RECORDS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = finished.replace(":", "-").replace(".", "-")
        path = data.RECORDS_DIR / f"{parent.replace('/', chr(8725))}-pointers-{stamp}.json"
        path.write_text(
            json.dumps(
                {
                    "job": "pointers",
                    "parent": parent,
                    "language": LANGUAGE,
                    "account": str(site.user()),
                    "finishedAt": finished,
                    "namesOnParent": names,
                    "pointers": landed,
                    "allShowOurChange": all(r["realizedShowsOurChange"] for r in landed),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        pywikibot.info("")
        pywikibot.info(f"  {len(landed)} pointers written · {path}")
    pywikibot.info("")


if __name__ == "__main__":
    sys.exit(main())
