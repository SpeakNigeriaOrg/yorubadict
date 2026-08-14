"""Finding the page that actually holds a language's section.

Separate from wikitext.py on purpose: that module promises pure functions with
no network and no site object, and this needs both.
"""

import pywikibot

from lib import wikitext


def resolve_host_page(site, title, language, note=None):
    """The page that actually holds `language`'s section for `title`.

    Usually the page you asked for. Not always: en.wiktionary splits oversized
    entries into "<page>/languages A to L" and "<page>/languages M to Z",
    transcluded under a generated ==More languages== heading. Page `a` therefore
    contains no Yoruba section at all - editing it by section index would change
    something else entirely, and reading it finds nothing.

    en.wiktionary calls these "mammoth pages". The ==More languages== heading is
    not in the wikitext, so there is nothing on the page itself to detect - the
    marker is a {{mammoth page footer}} template, and rather than depend on that
    name we just look for the subpages.

    `note` is called with a one-line explanation when the answer is a subpage,
    so a run says where it went rather than silently editing a different title.
    """
    page = pywikibot.Page(site, title)
    if not page.exists():
        raise SystemExit(f'"{title}" does not exist on en.wiktionary.')
    parsed = wikitext.parse_page(page.text, site)
    if wikitext.language_span(parsed.sections, language)[0] is not None:
        return page

    subpages = list(site.allpages(prefix=f"{title}/languages", namespace=0))
    if not subpages:
        raise SystemExit(
            f'No {language} section on "{title}". The page exists but has no '
            f"{language} entry, or it is spelled differently there."
        )
    for subpage in subpages:
        sub_parsed = wikitext.parse_page(subpage.text, site)
        if wikitext.language_span(sub_parsed.sections, language)[0] is not None:
            if note:
                note(
                    f'  note      "{title}" is split across subpages; the {language} '
                    f'section is on "{subpage.title()}"'
                )
            return subpage
    raise SystemExit(
        f'"{title}" is split across subpages and none of them holds a '
        f"{language} section."
    )
