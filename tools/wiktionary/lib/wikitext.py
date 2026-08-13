"""Reading and changing the wikitext of one language's section.

Pure functions. No network, no Pywikibot site object - text in, text or a
verdict out, so the part that decides what changes on somebody else's page can
be tested on its own.

Parsing is mwparserfromhell and pywikibot.textlib rather than regular
expressions. That is not a preference: sun's etymology 4 carries

    # {{senseid|yo|to cry}} {{lb|yo|with {{l|yo|ekun|t=tears}}}} to [[cry]]

and a non-greedy {{.*?}} eats half of the nested template and leaves a stray
brace. strip_code() unwinds it correctly because it is a parser.
"""

import re

import mwparserfromhell
from pywikibot import textlib

ETYMOLOGY_TITLE = re.compile(r"^=+\s*Etymology\s+(\d+)\s*=+$")


def strip_markup(text):
    """Definition text as a reader sees it, with templates and links resolved."""
    stripped = mwparserfromhell.parse(text).strip_code()
    return re.sub(r"\s+", " ", stripped).strip(" ;,\t")


def definition_lines(content):
    """The definitions of one etymology section.

    "# " only. "#:" is a usage example, "#*" a quotation and "##" a subsense,
    and none of them is the definition we check the numbering against.
    """
    out = []
    for line in content.splitlines():
        if re.match(r"^# [^#*:]", line):
            out.append(strip_markup(line[1:]))
    return out


def language_span(sections, language):
    """Where a language's sections start and end in a flat section list.

    textlib.extract_sections returns every heading on the page in order, so a
    language is its level-2 heading plus everything after it until the next
    level-2. kọ needs this: it carries a Gun section with its own Etymology 1
    and Etymology 2, and touching those would be vandalism.
    """
    start = None
    for i, section in enumerate(sections):
        if section.level == 2:
            if start is not None:
                return start, i
            if section.title.strip("= ") == language:
                start = i
    return (start, len(sections)) if start is not None else (None, None)


def etymology_sections(sections, start, end):
    """One entry per etymology: (heading index, number, index after its last
    subsection).

    The span matters. extract_sections splits at every heading level, so an
    ===Etymology 5=== section's own content is only the etymology prose - the
    definitions are down in ====Verb====, and the pronunciation and derived
    terms are in siblings of that. Everything from the heading until the next
    level-3-or-shallower heading belongs to that etymology.
    """
    found = []
    for i in range(start, end):
        match = ETYMOLOGY_TITLE.match(sections[i].title.strip())
        if match:
            found.append([i, match.group(1), end])
    for position, item in enumerate(found):
        for j in range(item[0] + 1, end):
            if sections[j].level <= 3:
                item[2] = j
                break
    return [tuple(item) for item in found]


def span_content(sections, start, stop):
    """The wikitext of an etymology and everything nested under it."""
    return "".join(sections[i].title + sections[i].content for i in range(start, stop))


def existing_etymid(content, lang_code):
    """The name this etymology already carries, or None.

    Language-scoped on purpose. sun carries {{etymid|fi|conjunction}} and
    {{etymid|fi|pronoun form}} for Finnish alongside the Yoruba one, so a
    template search that ignored the language argument would read a Finnish
    name as ours.
    """
    for template in mwparserfromhell.parse(content).filter_templates():
        if template.name.strip() != "etymid":
            continue
        if len(template.params) >= 2 and str(template.params[0]).strip() == lang_code:
            return str(template.params[1]).strip()
    return None


def existing_senseids(content, lang_code):
    """Every {{senseid}} value in this span.

    etymid and senseid share one namespace: the documentation says IDs "should
    be unique for each invocation of either {{senseid}} or {{etymid}} per
    language section". sun shows the rule being worked around in practice - its
    etymology 2 is named "to roast, burn" because "to roast" and "to burn" were
    already taken by senseids on the same page.
    """
    found = set()
    for template in mwparserfromhell.parse(content).filter_templates():
        if template.name.strip() != "senseid":
            continue
        if len(template.params) >= 2 and str(template.params[0]).strip() == lang_code:
            found.add(str(template.params[1]).strip())
    return found


def insert_etymid(content, lang_code, name):
    """Put the name on the line directly after the heading.

    That is where all 19 of the etymids already on queue pages sit, without
    exception - before the etymology prose, not after it. The section content
    handed to us begins with the newline that followed the heading.
    """
    body = content[1:] if content.startswith("\n") else content
    return "\n{{etymid|%s|%s}}\n%s" % (lang_code, name, body)


def reassemble(parsed, replacements):
    """Rebuild page text with some section contents replaced.

    `replacements` maps a section index to new content. Everything else is
    copied byte for byte, which is what keeps a whole-page save from touching
    any other language on the page.
    """
    out = [parsed.header]
    for i, section in enumerate(parsed.sections):
        out.append(section.title)
        out.append(replacements.get(i, section.content))
    out.append(parsed.footer)
    return "".join(out)


def parse_page(text, site):
    return textlib.extract_sections(text, site)


NAME_FORBIDDEN = re.compile(r"[|}{=\n\[\]]")


def validate_name(name):
    """Why a name cannot be used, if it cannot.

    The name becomes the HTML anchor "Yoruba:_<name>" and the value of an idN=
    argument, so it cannot carry the characters that would end the template or
    the argument.
    """
    problems = []
    # Template:senseid's documentation, which etymid defers to: "Apostrophes
    # have been known not to work for link resolution, at least in some
    # browsers. Thus, please favor (for example) 'sorcerer_s apprentice'".
    # Spaces are fine and explicitly allowed - "This can be anything, and can
    # include spaces" - and the etymid docs' own worked example, bun, uses
    # names like "probably from bottom-referent origins".
    if "'" in name or "\u2019" in name:
        problems.append("contains an apostrophe, which breaks link resolution")
    if not name.strip():
        problems.append("is empty")
    if name != name.strip():
        problems.append("has leading or trailing space")
    if NAME_FORBIDDEN.search(name):
        problems.append("contains one of | } { = [ ] or a newline")
    if re.match(r"^\s*[Ee]tymology\s*\d*\s*$", name):
        problems.append("just repeats the section number, which names nothing")
    return problems
