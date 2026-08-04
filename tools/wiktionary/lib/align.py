"""Does the page still mean by "Etymology 5" what our data means by it?

This is the gate that stops {{etymid|yo|write}} landing on the section that
means "to hang" after somebody inserts a new etymology and pushes the rest
down. It is the only thing standing between a stale build and a wrong edit, so
it was calibrated by measurement rather than by taste.

Comparing for equality is the obvious rule and it is wrong. Stripping templates
removes text that Kaikki keeps, because Kaikki renders those templates instead
of dropping them:

    page, stripped     "metal iron"
    kaikki gloss       "metal (in particular) iron"        {{q|in particular}}
    page, stripped     "The tree and its seeds, ..."
    kaikki gloss       "The tree Picralima nitida and ..."  {{taxfmt|...}}

Measured over all 114 pages in the work queue - 536 etymology sections:

    equality              rejects 11 of 502 verifiable sections, all correct
    content-word subset   rejects 0

and, with each page's etymologies deliberately renumbered by one, the subset
rule still refuses 112 of 113 pages. The exception is `eye`, whose two
etymologies are defined in almost the same words; nothing that compares
definitions can tell those apart, and swapping their names would matter little.
"""

import re


def content_words(text):
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", text.lower()).split() if w}


def definitions_agree(from_page, from_kaikki):
    """True, False, or None when there is nothing left to compare.

    None is the honest answer for the 33 sections in the queue whose definition
    is entirely template - `eni` etymology 2 is {{alt form|yo|òní}} and nothing
    else, so it strips to the empty string. Those do not count for or against a
    page; the sections around them carry the check.
    """
    page_words = content_words(from_page)
    if not page_words:
        return None
    kaikki_words = content_words(from_kaikki)
    if not kaikki_words:
        return None
    return page_words <= kaikki_words or kaikki_words <= page_words


def section_agrees(page_definitions, kaikki_definitions):
    """Verdict for one etymology: True, False, or None if unverifiable."""
    verdicts = [
        agreement
        for page_definition in page_definitions
        for kaikki_definition in kaikki_definitions
        if (agreement := definitions_agree(page_definition, kaikki_definition)) is not None
    ]
    if not verdicts:
        return None
    return any(verdicts)
