"""What was actually sent, and what came back.

Records are committed. A month from now, "did that edit do what we meant?"
should have an answer that does not depend on remembering, and a reviewer on
Wiktionary asking what this tool does should be able to be shown every edit it
has made.

The diff stored is the server's own, fetched from the revision after it lands,
not ours. Ours is what we intended; the server's is what happened.
"""

import difflib
import json
import re

import pywikibot

from lib import data


def _strip_html(html):
    text = re.sub(r"<[^>]+>", "", html)
    for entity, char in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'),
                         ("&#039;", "'"), ("&nbsp;", " "), ("&amp;", "&")):
        text = text.replace(entity, char)
    return "\n".join(line for line in text.splitlines() if line.strip())


def realized_diff(site, page_title, newrevid):
    """The diff the server recorded for the revision we just made."""
    try:
        request = site.simple_request(
            action="compare", fromrev=newrevid, torelative="prev",
            difftype="unified", prop="diff",
        )
        return _strip_html(request.submit().get("compare", {}).get("body", ""))
    except Exception as error:  # a failed record must not undo a good edit
        pywikibot.warning(f"could not fetch the recorded diff: {error}")
        return ""


def write(result, site):
    data.RECORDS_DIR.mkdir(parents=True, exist_ok=True)

    page = pywikibot.Page(site, result["hostPage"])
    result["newrevid"] = page.latest_revision_id
    result["realizedDiff"] = realized_diff(site, result["hostPage"], result["newrevid"])

    intended = "\n".join(
        difflib.unified_diff(
            result.pop("before").splitlines(),
            result.pop("after").splitlines(),
            lineterm="", n=2,
        )
    )
    result["intendedDiff"] = intended

    def changed(text):
        return [l for l in text.splitlines()
                if l[:1] in "+-" and not l.startswith(("+++", "---"))]

    result["realizedMatchesIntended"] = (
        bool(result["realizedDiff"]) and changed(result["realizedDiff"]) == changed(intended)
    )

    stamp = result["finishedAt"].replace(":", "-").replace(".", "-")
    slug = f'{result["page"].replace("/", "∕")}-{result["job"]}-{stamp}'
    json_path = data.RECORDS_DIR / f"{slug}.json"
    diff_path = data.RECORDS_DIR / f"{slug}.diff"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    diff_path.write_text((result["realizedDiff"] or intended) + "\n", encoding="utf-8")

    if result["realizedDiff"]:
        pywikibot.info("")
        pywikibot.info(result["realizedDiff"])
        pywikibot.info("")
        pywikibot.info(
            "  what landed "
            + ("matches" if result["realizedMatchesIntended"] else "DOES NOT MATCH")
            + " what was previewed"
        )
        pywikibot.info(
            f'  https://en.wiktionary.org/w/index.php?diff={result["newrevid"]}'
        )
    return json_path
