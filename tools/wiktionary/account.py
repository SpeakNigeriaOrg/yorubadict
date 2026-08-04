#!/usr/bin/env python3
"""Is this account clear to edit, and has anything been logged against it?

    python account.py

Answers the question you actually have after an AbuseFilter refusal: am I
still restricted, and did anything else happen? Read-only, no login needed.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("PYWIKIBOT_DIR", str(Path(__file__).resolve().parent))

import pywikibot

# Rights an ordinary established account holds. Losing autoconfirmed is what
# an AbuseFilter blockautopromote action does, and it is the one that stops
# semi-protected pages and raises the rate limits you run into.
WATCHED = ["autoconfirmed", "editsemiprotected", "skipcaptcha", "autopatrol"]


def main():
    pywikibot.handle_args()
    site = pywikibot.Site()
    username = site.username()
    if not username:
        raise SystemExit("No username configured. See README.md.")

    result = site.simple_request(
        action="query", list="users", ususers=username,
        usprop="groups|rights|editcount|blockinfo", formatversion="2",
    ).submit()
    user = result["query"]["users"][0]
    rights = set(user.get("rights") or [])

    pywikibot.info("")
    pywikibot.info(f"  {username} — {user.get('editcount')} edits")
    pywikibot.info(f"  blocked: {'YES' if user.get('blockid') else 'no'}")
    pywikibot.info("")
    for right in WATCHED:
        pywikibot.info(f"    {right:20} {'yes' if right in rights else 'NO'}")

    log = site.simple_request(
        action="query", list="abuselog", afluser=username, afllimit=10,
        aflprop="filter|title|result|timestamp", formatversion="2",
    ).submit()
    hits = log.get("query", {}).get("abuselog", [])
    pywikibot.info("")
    if not hits:
        pywikibot.info("  no AbuseFilter hits on record")
    else:
        pywikibot.info(f"  {len(hits)} AbuseFilter hits, most recent first:")
        for hit in hits[:5]:
            pywikibot.info(
                f"    {hit.get('timestamp')}  ({hit.get('filter')})  "
                f"{hit.get('title')} -> {hit.get('result')}"
            )
    if "autoconfirmed" not in rights:
        pywikibot.info("")
        pywikibot.info(
            "  autoconfirmed is still withheld. It returns on its own when the\n"
            "  filter's blockautopromote expires — there is nothing to apply for.\n"
            "  Editing by hand meanwhile is fine and rebuilds standing."
        )
    pywikibot.info("")


if __name__ == "__main__":
    sys.exit(main())
