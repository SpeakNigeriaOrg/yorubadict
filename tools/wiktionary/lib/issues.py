"""What the data-quality report already knows about the pages you are editing.

build/lib/validator.mjs finds problems and #/contribute publishes them, but
neither puts them in front of the person who has just opened those exact pages.
So `-propose` prints the ones that touch the word in hand.

Everything here is read from public/data/validation-report.json, which is built
from the last Kaikki refresh and is therefore up to a week behind Wiktionary.
That matters most for anchors: the report still lists agbẹjọro as pointing at
"think" on ro with no such name, which stopped being true the moment ro was
given its names. So callers that already hold the live anchor names pass them
in, and those get filtered out rather than sending you after finished work.
"""

import json
import re
import unicodedata

from lib import data

TONE = {"\u0300", "\u0301", "\u0302", "\u0304"}


def _untoned(text):
    return unicodedata.normalize(
        "NFC", "".join(c for c in unicodedata.normalize("NFD", text) if c not in TONE)
    )

# The report carries everything from typos to prose notes. These are the kinds
# worth interrupting someone for: each is a specific, fixable thing on a page
# they are already looking at.
ACTIONABLE = {
    "dangling-sense-anchor",
    "reference-tone-typo",
    "reference-underdot-typo",
    "ambiguous-derivation",
    "derived-without-etymology",
    "circular-derivation",
}


def load():
    path = data.REPO_DIR / "public/data/validation-report.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("issues") or []


def _points_at(detail, parent):
    """Does this dangling-anchor detail point at the word we are working on?

    Details read: points at "think" on ro, which has no such name - naming the
    component as the compound spelled it, so tone has to come off both sides.
    """
    match = re.search(r"\son\s+(\S+?),", detail)
    return bool(match) and _untoned(match.group(1)) == _untoned(parent)


def for_pages(page_titles, live_anchor_names=None, parent=None):
    """[(issue, page_entry)] for issues touching any of these pages.

    live_anchor_names, when given, is the set of names that exist on the parent
    page right now. A dangling-anchor detail naming one of them has been fixed
    since the report was built and is dropped.

    parent, when given, also picks up pages that are not in page_titles at all:
    a compound whose only fault is a wrong idN never enters the work queue,
    because the queue reads "has an idN" as resolved. agbẹjọro is the clearest
    case - it names all three of its components and every one of them dangles -
    and it would otherwise be invisible to the person editing exactly that word.
    """
    wanted = set(page_titles)
    live = set(live_anchor_names or ())
    found = []
    for issue in load():
        if issue.get("kind") not in ACTIONABLE:
            continue
        for page in issue.get("pages") or []:
            relevant = page.get("page") in wanted
            if not relevant and parent and issue["kind"] == "dangling-sense-anchor":
                relevant = any(_points_at(d, parent) for d in page.get("details") or [])
            if not relevant:
                continue
            details = page.get("details") or []
            if issue["kind"] == "dangling-sense-anchor" and live:
                details = [d for d in details if not _names_a_live_anchor(d, live)]
                if not details:
                    continue
            found.append((issue, {**page, "details": details}))
    return found


def _names_a_live_anchor(detail, live):
    # details read: points at "think" on ro, which has no such name
    return any(f'"{name}"' in detail or f"“{name}”" in detail for name in live)


def render(found, info):
    if not found:
        return
    info("")
    info(f"  {len(found)} known problem(s) on these pages, from the data-quality report:")
    for issue, page in found:
        info("")
        info(f"    {page['page']} — {issue['title']}  [{issue['effort']}]")
        for detail in page["details"][:4]:
            info(f"        {detail}")
        info(f"        fix: {issue['fix']}")
    info("")
    info("  These are not this tool's to make - it never overwrites an existing")
    info("  idN, and most of the above are wrong values rather than missing ones.")
