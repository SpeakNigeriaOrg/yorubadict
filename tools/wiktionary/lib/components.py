"""Finding and pointing a compound's component at one meaning.

The other half of etymid.py. That one names the etymologies on a parent page;
this one puts idN= on the compounds so they say which name they mean.

    {{af|yo|à-|kọ|tọ́|t2=to write}}   ->   {{af|yo|à-|kọ|tọ́|t2=to write|id2=write}}

Two things here are easy to get wrong and are therefore checked rather than
assumed: which template on the page is the right one, and which argument
number the component actually occupies.
"""

import mwparserfromhell

# Mirrors COMPONENT_TEMPLATES in build/lib/wiktionary-tasks.mjs. Kept as a set
# of names rather than derived, because the queue entry already tells us which
# template it meant and this is only used to confirm it.
COMPONENT_TEMPLATES = {
    "compound", "com", "compound+", "blend", "af", "affix", "prefix",
    "suffix", "confix", "univerbation",
}


def positional(template, index):
    """The index-th positional argument, 1-based, or None.

    mwparserfromhell keeps named and positional parameters in one list, so
    positional arguments have to be counted rather than indexed.
    """
    seen = 0
    for param in template.params:
        if param.showkey:
            continue
        seen += 1
        if seen == index:
            return str(param.value).strip()
    return None


def argument_position(argument):
    """Which positional argument an idN refers to.

    id2 on {{af|yo|a-|kọ|búlọ́ọ̀gù}} means the component at positional 3: the
    language code is positional 1, so component N sits at N+1. Confirmed
    against the queue's own t2= gloss, which describes the same component.
    """
    return int(argument.removeprefix("id")) + 1


def find_template(section_wikitext, template_name, argument, form):
    """The one template this pointer belongs on.

    Returns (template, problem). A compound can carry several etymology
    templates, and its page can carry several etymologies of its own, so the
    match has to be on the template name AND the component sitting where the
    queue says it sits. Anything other than exactly one match is refused rather
    than guessed at.
    """
    index = argument_position(argument)
    matches = [
        t
        for t in mwparserfromhell.parse(section_wikitext).filter_templates()
        if str(t.name).strip() == template_name
        and positional(t, index) == form
    ]
    if not matches:
        return None, (
            f"no {{{{{template_name}}}}} on the page has {form!r} as argument "
            f"{index}. The etymology has been rewritten since our data."
        )
    if len(matches) > 1:
        return None, (
            f"{len(matches)} templates match — cannot tell which one is meant."
        )
    return matches[0], None


def existing_pointer(template, argument):
    value = template.get(argument).value if template.has(argument) else None
    return str(value).strip() if value is not None else None


def add_pointer(template, argument, name):
    """Add idN= after the tN= it belongs with, so the template stays readable.

    mwparserfromhell appends to the end otherwise, which puts id2 after t3 and
    makes a hand-edited template harder to read than it was.
    """
    gloss = "t" + argument.removeprefix("id")
    if template.has(gloss):
        template.add(argument, name, after=gloss)
    else:
        template.add(argument, name)
    return template
