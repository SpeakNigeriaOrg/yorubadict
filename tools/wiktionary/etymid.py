#!/usr/bin/env python3
"""Give each etymology on one Wiktionary page a name, so other pages can point
at a meaning instead of at a spelling.

    python etymid.py -page:kọ -propose     write the worksheet
    python etymid.py -page:kọ -check       read it back — no network
    python etymid.py -page:kọ -simulate    show the diff, save nothing
    python etymid.py -page:kọ              show the diff, ask, save

One page per run. There is no batch mode, no generator over a category, and no
loop over the work queue — that is a property of this script, not a setting.
The saving is Pywikibot's `put_current`, so the y/n, the throttle, the
edit-conflict detection and -simulate are all its own. The diff is not: userPut
renders one with no context lines and no way to ask for any, which shows what
changed but not where. show_placement below prints each inserted line under the
heading it lands in, built from the same two strings that are about to be
saved.

What is ours is everything Pywikibot has no opinion about: which etymology
deserves which name, and whether the page still means by "Etymology 5" what our
data means by it. Pywikibot is a MediaWiki framework, not a dictionary one —
`textlib` will hand you the headings on a page but has never heard of an
etymology, and nothing in it knows that a Yoruba compound points at a meaning.
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Pywikibot keeps its config and its state - user-config.py, the login session
# cookie, the API cache, the logs, the throttle file - in one "base directory".
# It picks that directory from -dir:, then PYWIKIBOT_DIR, then the current
# directory, then its own; run this script from anywhere but tools/wiktionary
# and it would put all of that wherever you happened to be standing, including
# pywikibot.lwp, which is a live credential. Setting it here to the directory
# this file is in means there is nothing to remember and nothing to get wrong.
# Must happen before pywikibot is imported, which is when it resolves. setdefault
# so that an explicit PYWIKIBOT_DIR still wins.
os.environ.setdefault("PYWIKIBOT_DIR", str(Path(__file__).resolve().parent))

import pywikibot
from pywikibot import config
from pywikibot.bot import ExistingPageBot

from lib import align, data, record, wikitext, worksheet

LANGUAGE = "Yoruba"
LANG_CODE = "yo"


# ---------------------------------------------------------------------------
# Locating the section
# ---------------------------------------------------------------------------


def resolve_host_page(site, title):
    """The page that actually holds the Yoruba section.

    Usually the page you asked for. Not always: en.wiktionary splits oversized
    entries into "<page>/languages A to L" and "<page>/languages M to Z",
    transcluded under a ==More languages== heading. Page `a` therefore contains
    no Yoruba section at all, and editing it by section index would change
    something else entirely.
    """
    page = pywikibot.Page(site, title)
    if not page.exists():
        raise SystemExit(f'"{title}" does not exist on en.wiktionary.')
    parsed = wikitext.parse_page(page.text, site)
    start, _ = wikitext.language_span(parsed.sections, LANGUAGE)
    if start is not None:
        return page

    # en.wiktionary calls these "mammoth pages": once an entry gets too large,
    # the smaller languages move to "<page>/languages A to L" and
    # "<page>/languages M to Z" and are transcluded back under a generated
    # ==More languages== heading. That heading is not in the wikitext, so there
    # is nothing on the page itself to detect - the marker is a
    # {{mammoth page footer}} template, and rather than depend on that name we
    # just look for the subpages.
    subpages = list(site.allpages(prefix=f"{title}/languages", namespace=0))
    if not subpages:
        raise SystemExit(
            f'No {LANGUAGE} section on "{title}". The page exists but has no '
            f"{LANGUAGE} entry, or it is spelled differently there."
        )
    for subpage in subpages:
        sub_parsed = wikitext.parse_page(subpage.text, site)
        if wikitext.language_span(sub_parsed.sections, LANGUAGE)[0] is not None:
            pywikibot.info(
                f'  note      "{title}" is split across subpages; the {LANGUAGE} '
                f'section is on "{subpage.title()}"'
            )
            return subpage
    raise SystemExit(
        f'"{title}" is split across subpages and none of them holds a '
        f"{LANGUAGE} section."
    )


# ---------------------------------------------------------------------------
# What could be written
# ---------------------------------------------------------------------------


def collect(task, entries, parsed):
    """Every etymology on the page, with the evidence needed to name it."""
    start, end = wikitext.language_span(parsed.sections, LANGUAGE)
    found = wikitext.etymology_sections(parsed.sections, start, end)
    anchors = {a["etymologyNumber"]: a for a in task.get("anchors") or []}

    pointers, unattributable = {}, []
    for reference in task.get("references") or []:
        if reference.get("matchedSection"):
            pointers.setdefault(reference["matchedSection"], []).append(reference)
        else:
            unattributable.append(reference)

    items = []
    for index, number, stop in found:
        content = parsed.sections[index].content
        # Definitions and any existing name are looked for across the whole
        # etymology - heading, prose, and every subsection under it - because
        # the definitions live in ====Verb====, not in the etymology section
        # itself. The name is still written directly after the heading.
        span = wikitext.span_content(parsed.sections, index, stop)
        existing = wikitext.existing_etymid(span, LANG_CODE)
        definitions = data.definitions_for(entries, number)
        anchor = anchors.get(number)

        # Wikitext can carry an etymology Kaikki dropped: `ga` has an
        # Etymology 2 with no part-of-speech section, so nothing was extracted
        # from it. We have no definition for it and therefore no business
        # naming it, but leaving it out of the worksheet would make a gap on
        # the page look like an oversight rather than a decision.
        if existing:
            status = "existing"
        elif anchor and definitions:
            status = "proposed"
        else:
            status = "unknown"

        items.append(
            {
                "index": index,
                "number": number,
                "status": status,
                "name": existing or (anchor["slug"] if anchor else ""),
                "existing": existing,
                "definitions": definitions,
                "page_definitions": wikitext.definition_lines(span),
                "pointed_at_by": pointers.get(number, []),
                **data.identity_of(entries, number),
            }
        )

    return {
        "items": items,
        "unattributable": unattributable,
        "missing": [n for n in anchors if n not in {num for _, num, _ in found}],
    }


def summary_for(items):
    count = sum(1 for i in items if i["status"] == "proposed" and i["name"])
    word = "etymology" if count == 1 else "etymologies"
    return (
        f"Add {{{{etymid}}}} to {count} {LANGUAGE} {word} so other entries can "
        f"point at one meaning (semi-automated: each etymid written by hand, "
        f"then uploaded via script to save typing time)"
    )


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------


def verify(items):
    problems, notes = [], []
    writable = [i for i in items if i["status"] == "proposed" and i["name"]]

    checked = 0
    for item in items:
        if not item["definitions"]:
            continue
        verdict = align.section_agrees(item["page_definitions"], item["definitions"])
        if verdict is None:
            notes.append(
                f'Etymology {item["number"]}: the definition on the page is all '
                f"template, so it cannot be checked."
            )
            continue
        checked += 1
        if not verdict:
            problems.append(
                f'Etymology {item["number"]} does not match our data.\n'
                f'              on the page: {" / ".join(item["page_definitions"]) or "(nothing)"}\n'
                f'              our record:  {" / ".join(item["definitions"])}\n'
                f"              The page has been renumbered or reordered since the last "
                f"data refresh. Writing here would name the wrong meaning."
            )
    if writable and not checked:
        problems.append(
            "Not one etymology on this page could be checked against our data, so "
            "there is no evidence the numbering still lines up. Refusing to write."
        )

    seen = {}
    for item in items:
        if not item["name"]:
            continue
        if item["status"] == "proposed":
            for problem in wikitext.validate_name(item["name"]):
                problems.append(
                    f'Etymology {item["number"]}: the name "{item["name"]}" {problem}.'
                )
        key = item["name"].lower()
        if key in seen:
            problems.append(
                f'Etymology {item["number"]} and Etymology {seen[key]} would both be '
                f'named "{item["name"]}". Names have to differ to be worth anything.'
            )
        seen[key] = item["number"]

    return problems, notes, len(writable)


def show_placement(before, after, items):
    """Print every inserted line with the heading it lands under.

    Pywikibot's own diff is called from userPut as showDiff(old, new), with
    the default context of 0 - so it renders as bare hunks:

        @@ -63,0 +65 @@
        + {{etymid|yo|teach}}

    which says a line was added at 65 and nothing about which etymology that
    is. A tool whose entire safety argument is that a person reads the diff
    has to show enough to read. So this replaces it, and is built from the
    same two strings that are about to be saved rather than from our idea of
    them - if apply() put a name in the wrong section, this shows that.
    """
    import difflib

    before_lines = before.splitlines()
    after_lines = after.splitlines()
    definitions = {i["number"]: i["definitions"] for i in items}
    misplaced = []

    for tag, _, _, j1, j2 in difflib.SequenceMatcher(
        None, before_lines, after_lines
    ).get_opcodes():
        if tag not in ("insert", "replace"):
            continue
        for j in range(j1, j2):
            heading = number = None
            for k in range(j, -1, -1):
                match = wikitext.ETYMOLOGY_TITLE.match(after_lines[k].strip())
                if match:
                    heading, number = after_lines[k], match.group(1)
                    heading_line = k
                    break
            pywikibot.info("")
            if heading is None:
                pywikibot.info("  NOT INSIDE ANY ETYMOLOGY:")
                misplaced.append(after_lines[j])
            else:
                covers = " / ".join(definitions.get(number) or []) or "(no definition on record)"
                pywikibot.info(f"  Etymology {number} — {covers}")
                if j != heading_line + 1:
                    pywikibot.info("  NOT DIRECTLY AFTER THE HEADING:")
                    misplaced.append(after_lines[j])
                pywikibot.info(f"        {heading}")
            pywikibot.info(f"      + {after_lines[j]}")
            # the next line that carries anything - a blank one shows nothing
            # about where this landed
            for following in after_lines[j + 1: j + 6]:
                if following.strip():
                    pywikibot.info(f"        {following}")
                    break
    pywikibot.info("")
    return misplaced


def apply_decisions(parsed, items):
    replacements = {}
    for item in items:
        if item["status"] == "proposed" and item["name"]:
            replacements[item["index"]] = wikitext.insert_etymid(
                parsed.sections[item["index"]].content, LANG_CODE, item["name"]
            )
    return wikitext.reassemble(parsed, replacements)


def overlay(collected, chosen):
    """Put the worksheet's decisions onto freshly read page state."""
    misplaced, superseded = [], []
    for item in collected["items"]:
        number = item["number"]
        if "!" + number in chosen:
            misplaced.append(number)
        wanted = chosen.get(number)
        if item["status"] != "proposed":
            # Somebody named this between propose and now. Dropping our name is
            # right, but doing it silently would lose a decision without saying
            # so, and theirs may not be the name you would have chosen.
            if wanted and item["status"] == "existing":
                superseded.append((number, wanted, item["existing"]))
            continue
        if wanted is not None:
            item["name"] = wanted
    return misplaced, superseded


def report(problems, notes, misplaced, superseded):
    for note in notes:
        pywikibot.info(f"  note      {note}")
    if misplaced:
        pywikibot.info(
            f'  ignored   an id: line under Etymology {", ".join(misplaced)}, which is '
            f"already named or has no data"
        )
    for number, wanted, actual in superseded:
        pywikibot.info(
            f'  dropped   your name for Etymology {number} ("{wanted}") — somebody '
            f'named it "{actual}" on Wiktionary since the worksheet was written. '
            f"Theirs stands."
        )
    if problems:
        pywikibot.info("")
        for problem in problems:
            pywikibot.error(f"REFUSING  {problem}")
        raise SystemExit("\n  Nothing was sent.\n")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_propose(site, task, entries, regenerate):
    page = resolve_host_page(site, task["page"])
    parsed = wikitext.parse_page(page.text, site)
    collected = collect(task, entries, parsed)

    directory = data.work_dir_for(task["page"])
    path = directory / "worksheet.md"
    if path.exists():
        if not regenerate:
            raise SystemExit(
                f"\n  A worksheet already exists at {path}.\n"
                f"  Use -regenerate to refresh the reference material and keep "
                f"your id: lines.\n"
            )
        _, previous = worksheet.parse(path.read_text(encoding="utf-8"))
        for item in collected["items"]:
            if item["status"] == "proposed" and item["number"] in previous:
                item["name"] = previous[item["number"]]
        pywikibot.info("  kept the id: lines already in the worksheet")

    # -check promises to touch the network not at all, so it needs the page
    # text this run read.
    (directory / "page.wikitext").write_text(page.text, encoding="utf-8")
    path.write_text(
        worksheet.render(
            task["page"],
            page.title(),
            LANGUAGE,
            page.latest_revision_id,
            summary_for(collected["items"]),
            collected["items"],
            collected["unattributable"],
            collected["missing"],
        ),
        encoding="utf-8",
    )

    counts = {}
    for item in collected["items"]:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    pywikibot.info(
        f'  {len(collected["items"])} etymologies: {counts.get("proposed", 0)} to name, '
        f'{counts.get("existing", 0)} already named, {counts.get("unknown", 0)} with no data'
    )
    if not counts.get("proposed"):
        pywikibot.info("")
        pywikibot.info("  Nothing to write on this page. Every etymology already has a name.")
    pywikibot.info("")
    pywikibot.info(f"  {path}")


def cmd_check(site, task, entries):
    directory = data.work_dir_for(task["page"])
    path = directory / "worksheet.md"
    cached = directory / "page.wikitext"
    if not path.exists() or not cached.exists():
        raise SystemExit(f'\n  No worksheet for "{task["page"]}". Run -propose first.\n')

    header, chosen = worksheet.parse(path.read_text(encoding="utf-8"))
    parsed = wikitext.parse_page(cached.read_text(encoding="utf-8"), site)
    collected = collect(task, entries, parsed)
    misplaced, superseded = overlay(collected, chosen)

    pywikibot.info(f"  {path}")
    pywikibot.info(
        f'  header: page={header.get("page")} host={header.get("host")} '
        f'revision={header.get("revision")}'
    )
    pywikibot.info("")
    for item in collected["items"]:
        if item["status"] == "proposed":
            label = (
                f'will write  {{{{etymid|{LANG_CODE}|{item["name"]}}}}}'
                if item["name"]
                else "skipped     (id: is blank)"
            )
        elif item["status"] == "existing":
            label = f'untouched   already named "{item["existing"]}"'
        else:
            label = "untouched   no data"
        pywikibot.info(f'  Etymology {item["number"]:<3} {label}')
    pywikibot.info("")

    problems, notes, writable = verify(collected["items"])
    report(problems, notes, misplaced, superseded)
    pywikibot.info(
        f'  {writable} name{"" if writable == 1 else "s"} would be written. '
        f"No network was used."
    )


class EtymidBot(ExistingPageBot):
    """Saves one page, after Pywikibot has shown you the diff and asked."""

    use_redirects = False

    def __init__(self, task, entries, chosen, expected_revision, **kwargs):
        super().__init__(**kwargs)
        self.task = task
        self.entries = entries
        self.chosen = chosen
        self.expected_revision = expected_revision
        self.result = None

    def treat_page(self):
        page = self.current_page
        parsed = wikitext.parse_page(page.text, page.site)

        if self.expected_revision and str(page.latest_revision_id) != self.expected_revision:
            raise SystemExit(
                f"\n  The page moved on. The worksheet was written against revision "
                f"{self.expected_revision}, and the page is now at "
                f"{page.latest_revision_id}.\n"
                f"  Run -propose -regenerate — etymology numbering can shift under you.\n"
            )

        collected = collect(self.task, self.entries, parsed)
        misplaced, superseded = overlay(collected, self.chosen)
        problems, notes, writable = verify(collected["items"])
        report(problems, notes, misplaced, superseded)

        if not writable:
            named = sum(1 for i in collected["items"] if i["status"] == "existing")
            raise SystemExit(
                f"\n  Nothing would change: "
                + (
                    f'all {named} etymologies on "{self.task["page"]}" are already named. '
                    f"That page is in the queue because the words built from it do not "
                    f"point at those names yet, which is the next job.\n"
                    if named == len(collected["items"])
                    else "every id: line in the worksheet is blank.\n"
                )
            )

        new_text = apply_decisions(parsed, collected["items"])
        before = page.text
        oldrevid = page.latest_revision_id  # before the save; page.text updates in place
        names = [
            {"etymology": i["number"], "name": i["name"]}
            for i in collected["items"]
            if i["status"] == "proposed" and i["name"]
        ]
        started = datetime.now(timezone.utc).isoformat()

        # show_diff=False: userPut's diff has no context lines and cannot be
        # given any, so it shows what changed but not where. show_placement
        # renders the same change with the heading each line lands under.
        stray = show_placement(before, new_text, collected["items"])
        if stray:
            raise SystemExit(
                "\n  A name would land somewhere other than directly after an "
                "etymology heading.\n  Refusing - this is a bug, not a "
                "judgement call.\n"
            )

        # Pywikibot owns the rest: the confirmation, the throttle, the
        # edit-conflict check, and honouring -simulate.
        saved = self.put_current(
            new_text,
            summary=summary_for(collected["items"]),
            minor=False,
            bot=False,
            watch="watch",
            show_diff=False,
        )

        self.result = {
            "job": "etymid",
            "page": self.task["page"],
            "hostPage": page.title(),
            "language": LANGUAGE,
            "simulated": bool(config.simulate),
            "saved": bool(saved),
            "startedAt": started,
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "account": str(page.site.user()),
            "summary": summary_for(collected["items"]),
            "names": names,
            "oldrevid": oldrevid,
            "before": before,
            "after": new_text,
        }


def cmd_submit(site, task, entries, always=False):
    directory = data.work_dir_for(task["page"])
    path = directory / "worksheet.md"
    if not path.exists():
        raise SystemExit(f'\n  No worksheet for "{task["page"]}". Run -propose first.\n')
    header, chosen = worksheet.parse(path.read_text(encoding="utf-8"))

    page = resolve_host_page(site, task["page"])
    bot = EtymidBot(
        task,
        entries,
        chosen,
        header.get("revision"),
        generator=[page],
        always=always,
    )
    bot.run()

    # A record is the audit trail of edits that happened. A simulated run did
    # not happen, and neither did one Pywikibot refused to save, so neither
    # gets a file.
    if bot.result and bot.result["saved"] and not config.simulate:
        written = record.write(bot.result, site)
        pywikibot.info("")
        pywikibot.info(f"  {written}")


# ---------------------------------------------------------------------------

USAGE = """
  python etymid.py -page:<page> [-propose | -check | -regenerate] [-simulate]

    -propose      read the page and write the worksheet
    -check        read the worksheet back — no network at all
    -regenerate   refresh a worksheet, keeping your id: lines
    (no flag)     show the diff, ask, and save
    -simulate     Pywikibot's own dry run: does everything but save
"""


def main():
    leftover = pywikibot.handle_args()
    page_title, mode, regenerate, always = None, "submit", False, False
    for argument in leftover:
        if argument.startswith("-page:"):
            page_title = argument[len("-page:"):]
        elif argument == "-propose":
            mode = "propose"
        elif argument == "-check":
            mode = "check"
        elif argument == "-regenerate":
            mode, regenerate = "propose", True
        elif argument == "-always":
            always = True
        else:
            raise SystemExit(f"Unknown argument {argument!r}\n{USAGE}")
    if not page_title:
        raise SystemExit(USAGE)

    # -always is Pywikibot's "don't ask me" flag. Under -simulate it is how the
    # tests drive this script; on a real save it would skip the one
    # confirmation the whole design rests on, so it is not allowed there.
    if always and not config.simulate:
        raise SystemExit(
            "\n  -always skips the confirmation, and this script saves nothing "
            "without one.\n  It is accepted only together with -simulate.\n"
        )

    tasks, by_page = data.load()
    task = data.find_task(tasks, page_title)
    entries = by_page.get(page_title, [])
    site = pywikibot.Site()

    pywikibot.info("")
    if mode == "propose":
        cmd_propose(site, task, entries, regenerate)
    elif mode == "check":
        cmd_check(site, task, entries)
    else:
        cmd_submit(site, task, entries, always)
    pywikibot.info("")


if __name__ == "__main__":
    sys.exit(main())
