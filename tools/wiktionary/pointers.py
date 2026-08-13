#!/usr/bin/env python3
"""Point each compound at one meaning of the word it was built from.

    python pointers.py -parent:kọ -propose     write the worksheet
    <edit the worksheet>
    python pointers.py -parent:kọ -simulate    the run without the saving
    python pointers.py -parent:kọ              show each edit, ask, save

    python pointers.py -parent:kọ -check       optional: list every compound,
                                               blanks included. Reads the
                                               parent, not the compounds.

-simulate is optional in etymid.py but worth keeping here: this touches one page
per compound and asks per page, so `a` at the prompt answers for every remaining
one at once.

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
from pywikibot.exceptions import AbuseFilterDisallowedError

from lib import components, data, issues, record, wikitext, worksheet

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


def reachable_sections(entries_for_page, form, template_name):
    """Which etymologies of the parent this spelling can actually reach.

    Tone is most of the answer. ayékòótọ́ writes its component untoned as
    "kọ", which reaches etymologies 5, 6 and 7 - write, stub, recite. It
    cannot reach etymology 3, which is spelled kọ́. So "negation particle" is
    a real name on the page and still the wrong answer here, and the
    name-exists check alone would let it through.

    Taken from the morpheme's own resolved candidates rather than re-derived,
    for the same reason wiktionary-tasks.mjs does: the headword is the untoned
    page title and is identical for every etymology, so comparing against it
    would declare everything reachable.
    """
    for entry in entries_for_page or []:
        for morpheme in entry.get("etymologyMorphemes") or []:
            if morpheme.get("form") == form and morpheme.get("analysisTemplate") == template_name:
                return morpheme.get("entryIds") or []
    return []


def collect(task, names, by_page, entry_sections):
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
                "reachable": sorted(
                    {
                        entry_sections[i]
                        for i in reachable_sections(
                            by_page.get(reference["page"]),
                            reference["component"],
                            reference["template"].split("|")[0].strip("{ "),
                        )
                        if i in entry_sections
                    },
                    key=int,
                ),
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


def render(parent, names, items, definitions_by_section=None):
    # The names alone are not enough to choose between. Most of these compounds
    # arrive blank, and deciding one means knowing what each etymology actually
    # means - which otherwise sends you to the etymid worksheet or the page.
    definitions_by_section = definitions_by_section or {}
    width = max((len(n) for n in names.values()), default=0)
    listed = []
    for number, name in sorted(names.items(), key=lambda kv: int(kv[0])):
        covers = " / ".join(definitions_by_section.get(number) or [])
        listed.append(
            f"    {number}. {name.ljust(width)}" + (f"   {covers}" if covers else "")
        )
    lines = [
        HEADER.format(
            parent=parent,
            language=LANGUAGE,
            names="\n".join(listed) or "    (none — run etymid.py on this page first)",
        )
    ]
    for item in items:
        # The component belongs in the key. Page `iro` carries three Yoruba
        # etymologies that each take id2 - ìró from ró, ìrò from rò, ìro from
        # ro - so (page, argument) is not unique, and the last one parsed
        # silently overwrote the other two.
        lines.append(
            f'## {item["word"]}   (page {item["page"]}, argument {item["argument"]}, '
            f'component {item["component"]})'
        )
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


def parse_worksheet(markdown, strict=True):
    """The id: line under each `## <word>   (page X, argument idN)` heading."""
    import re

    chosen, current = {}, None
    headings = 0
    for line in markdown.splitlines():
        heading = re.match(
            r"^##\s+\S+\s+\(page\s+(.+?),\s+argument\s+(id\d+),"
            r"\s+component\s+(\S+)\)",
            line,
        )
        if heading:
            headings += 1
            current = (heading.group(1), heading.group(2), heading.group(3))
            continue
        if line.startswith("## "):
            current = None
        match = re.match(r"^\s*id:\s*(.*)$", line)
        if match and current:
            chosen[current] = match.group(1).strip()

    # Silently reading nothing out of a worksheet is the worst outcome: the run
    # carries on using the proposed names and looks like it worked. If the
    # headings are there but none parsed, the file has been edited into a shape
    # this cannot read, or predates the current one.
    if not chosen and "## " in markdown and not headings:
        if not strict:
            # -regenerate is the way out of an unreadable worksheet, so it must
            # not be blocked by one. It starts fresh instead.
            pywikibot.warning(
                "the existing worksheet could not be read; starting it fresh"
            )
            return {}
        raise SystemExit(
            "\n  Could not read a single heading out of this worksheet.\n"
            "  Regenerate it: -propose -regenerate\n"
        )
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
        items = self.by_page[page.title()]
        parsed, start, end = yoruba_section(page, page.site)
        if parsed is None:
            pywikibot.warning(f'{page.title()}: no {LANGUAGE} section - skipped')
            return

        section = "".join(
            parsed.sections[i].title + parsed.sections[i].content for i in range(start, end)
        )
        replacements, applied = {}, []
        for item in items:
            template, problem = components.find_template(
                section, item["template_name"], item["argument"],
                item["component"], item.get("meaning"),
            )
            if problem:
                pywikibot.error(f'{page.title()} / {item["word"]}: {problem}')
                continue
            already = components.existing_pointer(template, item["argument"])
            if already:
                pywikibot.info(
                    f'  {item["word"]}: {item["argument"]} already points at '
                    f'"{already}" - left alone'
                )
                continue
            if item["name"] not in self.names:
                pywikibot.error(
                    f'{item["word"]}: "{item["name"]}" is not a name on the parent page.'
                )
                continue

            before_template = str(template)
            components.add_pointer(template, item["argument"], item["name"])
            after_template = str(template)

            # Replace inside the Yoruba section only, and rebuild the page from
            # the section list. A plain page.text.replace would scan from the
            # top, and a compound's page carries other languages - matching the
            # same string in one of those would edit the wrong entry.
            placed = False
            for i in range(start, end):
                haystack = replacements.get(i, parsed.sections[i].content)
                if before_template in haystack:
                    replacements[i] = haystack.replace(before_template, after_template, 1)
                    placed = True
                    break
            if not placed:
                pywikibot.error(f'{page.title()} / {item["word"]}: could not place the change.')
                continue
            applied.append((item, before_template, after_template))

        if not applied:
            return
        new_text = wikitext.reassemble(parsed, replacements)

        pywikibot.info("")
        for item, before_template, after_template in applied:
            pywikibot.info(f'  {item["word"]} - "{item["definition"][:60]}"')
            pywikibot.info(f"      - {before_template}")
            pywikibot.info(f"      + {after_template}")
            pywikibot.info("")

        arguments = ", ".join(sorted({i["argument"] for i, _, _ in applied}))
        summary = (
            f'/* {LANGUAGE} */ Add {arguments}= so '
            f'{"this points" if len(applied) == 1 else "these point"} at one '
            f'meaning of [[{self.parent}]] (semi-automated: each id written by '
            f'hand, then uploaded via script to save typing time)'
        )
        started = datetime.now(timezone.utc).isoformat()
        oldrevid = page.latest_revision_id
        try:
            saved = self.put_current(
                new_text, summary=summary, minor=False, bot=False,
                watch="watch", show_diff=False,
                ignore_save_related_errors=False,
            )
        except AbuseFilterDisallowedError as blocked:
            # Stop the whole run, do not move to the next page.
            #
            # An AbuseFilter refusal is a statement about the account's rate or
            # standing, not about this page, so the next page will trip it too
            # - and every attempt is itself a filter hit that can escalate. The
            # first run of this tool carried on after being refused and logged
            # six hits in ninety seconds, which cost the account its
            # autoconfirmed status.
            pywikibot.error(f"{page.title()}: {blocked}")
            pywikibot.error(
                "AbuseFilter refused this edit. Stopping the run - the next "
                "page would trip the same filter, and each attempt is another "
                "hit against the account. Wait for the filter to relax before "
                "trying again, and consider a slower put_throttle."
            )
            self.quit()
            return

        for item, before_template, after_template in applied:
            self.results.append(
                {
                    "page": page.title(),
                    "word": item["word"],
                    "argument": item["argument"],
                    "component": item["component"],
                    "name": item["name"],
                    "before": before_template,
                    "after": after_template,
                    "oldrevid": oldrevid,
                    "saved": bool(saved),
                    "startedAt": started,
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

    tasks, by_page = data.load()
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

    entry_sections = {
        e["id"]: e["etymologyNumber"] for e in by_page.get(parent, []) if e.get("etymologyNumber")
    }
    definitions_by_section = {
        number: data.definitions_for(by_page.get(parent, []), number) for number in names
    }
    items = collect(task, names, by_page, entry_sections)

    if mode == "propose":
        if path.exists() and not regenerate:
            raise SystemExit(
                f"\n  A worksheet already exists at {path}.\n"
                f"  Use -regenerate to refresh it, keeping your id: lines.\n"
            )
        if path.exists():
            previous = parse_worksheet(path.read_text(encoding="utf-8"), strict=False)
            for item in items:
                key = (item["page"], item["argument"], item["component"])
                if key in previous:
                    item["name"] = previous[key]
            if previous:
                pywikibot.info(
                    f"  kept {len(previous)} id: line(s) from the existing worksheet"
                )
        path.write_text(
            render(parent, names, items, definitions_by_section), encoding="utf-8"
        )
        ready = sum(1 for i in items if i["name"])
        pywikibot.info(
            f"  {len(items)} compounds: {ready} with a name, {len(items) - ready} needing you"
        )
        issues.render(
            issues.for_pages(
                [parent] + [i["page"] for i in items],
                set(names.values()),
                parent=parent,
            ),
            pywikibot.info,
        )
        pywikibot.info("")
        pywikibot.info(f"  {path}")
        pywikibot.info("")
        return

    if not path.exists():
        raise SystemExit(f'\n  No worksheet. Run `-parent:{parent} -propose` first.\n')
    chosen = parse_worksheet(path.read_text(encoding="utf-8"))
    for item in items:
        key = (item["page"], item["argument"], item["component"])
        if key in chosen:
            item["name"] = chosen[key]

    writable = [i for i in items if i["name"]]
    problems = []
    by_name = {v: k for k, v in names.items()}
    for item in writable:
        if item["name"] not in by_name:
            problems.append(
                f'{item["word"]}: "{item["name"]}" is not a name on {parent}. '
                f'Available: {", ".join(sorted(by_name))}'
            )
            continue
        section = by_name[item["name"]]
        if item["reachable"] and section not in item["reachable"]:
            allowed = [names[s] for s in item["reachable"] if s in names]
            problems.append(
                f'{item["word"]}: "{item["name"]}" is Etymology {section}, which the '
                f'spelling "{item["component"]}" cannot reach.\n'
                f'              It reaches Etymology {", ".join(item["reachable"])}'
                + (f' — {", ".join(allowed)}' if allowed else " (none of them named yet)")
                + "\n              Tone is usually why: a differently toned etymology is a "
                "different word."
            )
    if problems:
        pywikibot.info("")
        for problem in problems:
            pywikibot.error(problem)
        raise SystemExit("\n  Nothing was sent.\n")

    if mode == "check":
        pywikibot.info("")
        for item in items:
            label = f'-> {item["name"]}' if item["name"] else "skipped (id: is blank)"
            pywikibot.info(f'  {item["word"]:22} {item["argument"]:5} {label}')
        pywikibot.info("")
        # Not "would be written": this has read the parent page for its names,
        # but not the compound pages, so it cannot know which of these already
        # carry their pointer. àròkọ was already done and still counted here.
        pywikibot.info(
            f"  {len(writable)} pointers set in the worksheet, of {len(items)} compounds."
        )
        pywikibot.info(
            f"  Read {parent} for its names; the compound pages are not read until"
        )
        pywikibot.info(
            "  -simulate, which is where any that are already pointed will show up."
        )
        pywikibot.info("")
        return

    if not writable:
        raise SystemExit("\n  Every id: line is blank. Nothing to do.\n")

    # Several compounds can live on one page - iro holds three - so group by
    # page and make one edit carrying all of that page's pointers, rather than
    # keeping one item per page and dropping the rest.
    by_page = {}
    for item in writable:
        by_page.setdefault(pywikibot.Page(site, item["page"]).title(), []).append(item)
    bot = PointerBot(
        by_page, names, parent,
        generator=[pywikibot.Page(site, title) for title in by_page],
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
