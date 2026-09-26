"""The review worksheet: one Markdown file per letter, both briefing and input.

Markdown, not JSON, because somebody has to read every one of these while
deciding what a page should be called, and 6,273 of them is a lot of reading. The
parser looks only at an entry's id line and the `word:` under it, so the prose
around them can be as long as it needs to be.

Two things learned from tools/wiktionary/lib/worksheet.py, which does the same
job for etymology names:

  - Bind by id, never by position. Its pointers worksheet keyed on (page,
    argument) and silently lost two of iro's three etymologies when they all
    wanted id2. A reviewer who deletes or reorders a block should get an error,
    not a wrong address.
  - Nothing outside the machine-read lines can affect the outcome, so the
    reference material can be generous.

Approval is per file, not per entry, because a reviewer works through a letter in
one sitting: flip `reviewed: no` to `yes` at the top and every word in the file
counts as checked. Requiring a per-entry mark would mean the common case -
"these forty are all fine" - takes forty edits, and nobody would do it.
"""

import re

ID_LINE = re.compile(r"^\s*(en-\S+)\s*$")
WORD_LINE = re.compile(r"^\s*word:\s*(.*)$")
GROUP_HEADING = re.compile(r"^##\s+/(\S*)/")
HEADER_FIELDS = ("letter", "groups", "entries", "reviewed")


def render(letter, groups, totals, why=None):
    """One worksheet. `letter` is a bucket name - a letter, or "priority"."""
    title = "web addresses worth a second look" if why else "web addresses"
    lines = [f"# {letter} — {title}", ""]
    lines += ["```"]
    lines += [f"letter:   {letter}"]
    lines += [f'groups:   {totals["groups"]}']
    lines += [f'entries:  {totals["entries"]}']
    lines += ["reviewed: no"]
    lines += ["```", ""]
    if why:
        lines += why + [""]
    lines += [
        "Every heading below is one web address prefix, and every `word:` under it",
        "finishes an address: `## /gba/` plus `word: receive` serves /gba/receive.",
        "",
        "The words in one group must all differ - that is what tells a reader which",
        "entry they are looking at, since the address has dropped the tone marks.",
        "Lowercase letters, digits and single hyphens; one word where one will do.",
        "",
        "Change what needs changing, leave the rest, then set `reviewed:` to `yes`",
        "above and run:",
        "",
        "    python3 tools/slugs/review.py -apply",
        "",
        "Nothing except an entry's id line and the `word:` under it is read by the",
        "tool. A word already approved is marked ✓ and stays unless you change it.",
        "",
    ]

    for group in groups:
        lines += _render_group(group)
    return "\n".join(lines)


def _render_group(group):
    out = [f'## /{group["spelling"]}/', ""]
    for item in group["entries"]:
        out.append(f'    {item["id"]}')
        identity = " · ".join(
            str(x)
            for x in (
                item["written"],
                item["pos"],
                f'etymology {item["etymologyNumber"]}' if item["etymologyNumber"] else None,
                None if item["source"] == "rule" else f'from the {item["source"]}',
            )
            if x
        )
        out.append(f"      {identity}")
        for i, definition in enumerate(item["definitions"], 1):
            out.append(f"      {i}. {definition}")
        # The rule's answer, shown when it differs, so a reviewer can see what
        # was changed on their behalf and put it back if the change was wrong.
        if item.get("ruleWord") and item["ruleWord"] != item["word"]:
            out.append(f'      the rule alone would say: {item["ruleWord"]}')
        if item.get("flags"):
            out.append(f'      ⚠ {"; ".join(item["flags"])}')
        mark = " ✓" if item.get("approved") else ""
        out.append(f'      word: {item["word"]}{mark}')
        out.append("")
    return out


def parse(markdown):
    """Returns (header, {entry_id: word}, problems)."""
    header = {}
    fenced = re.search(r"```\n(.*?)```", markdown, re.S)
    for line in (fenced.group(1) if fenced else "").splitlines():
        match = re.match(r"^\s*([a-z]+):\s*(.*)$", line)
        if match and match.group(1) in HEADER_FIELDS:
            header[match.group(1)] = match.group(2).strip()

    words, problems = {}, []
    current = None
    for number, line in enumerate(markdown.splitlines(), 1):
        if GROUP_HEADING.match(line) or line.startswith("## "):
            current = None
            continue
        id_match = ID_LINE.match(line)
        if id_match:
            current = id_match.group(1)
            continue
        word_match = WORD_LINE.match(line)
        if not word_match:
            continue
        if not current:
            # A word with nothing to attach it to. Reported rather than guessed:
            # a guess here writes an address onto the wrong entry.
            problems.append(f"line {number}: `word:` with no entry above it — {line.strip()}")
            continue
        value = word_match.group(1).replace("✓", "").strip()
        if current in words:
            problems.append(f"line {number}: {current} has two `word:` lines")
        words[current] = value
        current = None
    return header, words, problems
