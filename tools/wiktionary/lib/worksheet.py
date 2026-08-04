"""The worksheet: one Markdown file that is both the briefing and the input.

Markdown rather than JSON or YAML because a person has to read it while
deciding what to call a meaning. The parser reads only lines matching `id:`
under an `## Etymology N` heading and ignores everything else, so the prose
around them can be as long as it needs to be without any risk to the
machine-readable part.

The reference material is not decoration. You cannot judge what to call a
meaning without seeing which words will point at it, so those are listed under
the meaning they would attach to.
"""

import re

HEADER_FIELDS = ("page", "host", "language", "revision", "summary")
PLAIN_HEADING = re.compile(r"^##\s+Etymology\s+(\d+)\s*$")
ANY_ETYMOLOGY_HEADING = re.compile(r"^##\s+Etymology\s+(\d+)")
ID_LINE = re.compile(r"^\s*id:\s*(.*)$")


def render(page, host, language, revision, summary, items, unattributable, missing):
    lines = [f"# {page} — etymology names", ""]
    lines += ["```"]
    lines += [f"page:     {page}"]
    lines += [f"host:     {host}"]
    lines += [f"language: {language}"]
    lines += [f"revision: {revision}"]
    lines += [f"summary:  {summary}"]
    lines += ["```", ""]

    writable = [i for i in items if i["status"] == "proposed"]
    if writable:
        lines += [
            "Edit the `id:` lines below, then run with -check. A blank `id:` skips that",
            "etymology. Everything that is not an `id:` line is reference material and is",
            "ignored by the tool.",
            "",
        ]
    else:
        lines += [
            "There is nothing to write on this page. Every etymology already has a name.",
            "It is still in the work queue because the words built from it do not point at",
            "those names yet — that is the next job, not this one.",
            "",
        ]

    for item in items:
        lines += _render_item(item)

    if unattributable:
        lines += ["## Words that naming cannot fix", ""]
        lines += ["These are built from this page, but no name would help them yet:", ""]
        for reference in unattributable:
            lines.append(f'- **{reference["word"]}** — {reference["why"]}')
        lines.append("")

    if missing:
        lines += ["## Warning", ""]
        lines += [
            f'Our data has Etymology {", ".join(missing)}, which the page does not. '
            f"The page has changed since the last data refresh; regenerate before "
            f"trusting any of this.",
            "",
        ]

    return "\n".join(lines)


def _render_item(item):
    out = []
    number = item["number"]
    if item["status"] == "existing":
        out += [f'## Etymology {number} — already named: "{item["existing"]}"', ""]
        out += ["    (no id: line — this name is on Wiktionary and will not be touched)", ""]
    elif item["status"] == "unknown":
        out += [f"## Etymology {number} — we have no data for this one", ""]
        out += [
            "    (no id: line — this etymology is on the page but nothing was extracted",
            "     from it, so we have no definition to name it by. It stays unnamed.)",
            "",
        ]
    else:
        out += [f"## Etymology {number}", ""]
        out += [f'    id: {item["name"]}', ""]

    identity = " · ".join(
        str(v) for v in (item["spelling"], item["pos"], item["ipa"]) if v
    )
    if identity:
        out.append(f"    {identity}")
    for i, definition in enumerate(item["definitions"], 1):
        out.append(f"    {i}. {definition}")
    if not item["definitions"] and item["page_definitions"]:
        out.append(f'    on the page: {" / ".join(item["page_definitions"])}')

    if item["pointed_at_by"]:
        out += ["", "    would be pointed at by:"]
        for reference in item["pointed_at_by"]:
            out.append(
                f'      {reference["word"]}  "{reference["definition"]}"  ({reference["argument"]})'
            )
    elif item["status"] != "unknown":
        out += ["", "    nothing points here yet"]
    out.append("")
    return out


def parse(markdown):
    header = {}
    fenced = re.search(r"```\n(.*?)```", markdown, re.S)
    for line in (fenced.group(1) if fenced else "").splitlines():
        match = re.match(r"^\s*([a-z]+):\s*(.*)$", line)
        if match and match.group(1) in HEADER_FIELDS:
            header[match.group(1)] = match.group(2).strip()

    names = {}
    current = None
    for line in markdown.splitlines():
        heading = ANY_ETYMOLOGY_HEADING.match(line)
        if heading:
            # Only the plain "## Etymology N" heading takes an id. The
            # already-named and no-data headings carry a dash and an
            # explanation, and an id: typed under one of those is a mistake
            # worth reporting rather than silently obeying.
            current = (
                heading.group(1)
                if PLAIN_HEADING.match(line.rstrip())
                else "!" + heading.group(1)
            )
            continue
        if line.startswith("## "):
            current = None
        id_match = ID_LINE.match(line)
        if id_match and current:
            names[current] = id_match.group(1).strip()
    return header, names
