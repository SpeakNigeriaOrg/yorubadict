#!/usr/bin/env python3
"""Propose the English word in each entry's web address.

    /gba/receive          /ile/home          /ro/ache
     ^^^                   ^^^                ^^
     build/lib/address.mjs decides this half. This script proposes the other.

Runs once, offline, and writes its answers to data/url-slugs.json. It is not part
of `npm run build` and must not become part of it: the build has no dependencies
and gives the same answer every time, and an address that moved because a model
was asked twice is a dead page.

Asks about a whole spelling group at a time - all nine entries of gba in one
request - for one reason. Every address collision measured against the shipped
data was two entries inside one group; a group named against itself cannot
produce one. It also produces better words, because "to receive" and "to sweep"
are only obviously the right pair when you can see both.

Where a person already chose a name for the etymology on Wiktionary, that wins
and no question is asked. Those decisions were made while reading the whole page.

Two routes to the same answer, and the ledger cannot tell them apart:

  Agents      write the questions to files, hand each file to a subagent, read
              the answers back. No account, no key, no bill. This is the route
              that named the dictionary.

  Batches API one request per group through the Anthropic Batches API. Costs a
              few dollars. Kept for the reserved holdout - a subset deliberately
              left unnamed so a second opinion can be measured against work
              already done, rather than trusted in advance.

Usage:
    python3 tools/slugs/propose.py -plan            what would be asked, and cost
    python3 tools/slugs/propose.py -batches         write question files for agents
    python3 tools/slugs/propose.py -batches -generic  re-ask only the over-general ones
    python3 tools/slugs/propose.py -ingest          read agent answers into the ledger
    python3 tools/slugs/propose.py -submit          Batches API: create the batch
    python3 tools/slugs/propose.py -collect         Batches API: write results in

    -limit:<n>       only the first n groups, for a trial run
    -per:<n>         groups per batch file (default 200)
    -reserved        act on the holdout instead of skipping it
    -model:<id>      default claude-opus-5, Batches API only
    -batch:<id>      collect a specific batch instead of the last submitted

Needs credentials only for -submit and -collect: ANTHROPIC_API_KEY, or an
`ant auth login` profile. Everything else is offline.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import data, etymid, ledger  # noqa: E402

MODEL = "claude-opus-5"
WORK = Path(__file__).resolve().parent / "work"
STATE_PATH = WORK / "batch.json"
QUESTIONS_DIR = WORK / "questions"
ANSWERS_DIR = WORK / "answers"

# One group in thirty, held back on purpose.
#
# Not a sample of what is left to do - a sample of what has been done, kept
# unanswered so a different model can be pointed at it and its answers compared
# against ones already in the ledger. Naming everything first would leave nothing
# to measure a second opinion against except taste.
#
# Chosen by a hash of the spelling rather than by position, so it stays the same
# set as the dictionary grows, and spreads across the alphabet instead of taking
# a contiguous slice of it.
RESERVED_IN = 30

# The longest an address's second half may be. Not a style rule: a reader sees
# the address in a search result and has to recognise their word in it, and
# something has gone wrong upstream long before 40 characters.
MAX_WORD = 40

# The most words an address's second half may hold. Three is already a lot; the
# twenty-five four-word addresses in the shipped ledger were 96% the model's own
# invention rather than the rule's, so this is a ceiling on enthusiasm.
MAX_PARTS = 3

# A word this many pages already share has stopped telling anyone anything.
# Measured against the shipped ledger: 3,298 pages (53%) hold a word no other
# page uses, and only 49 words reach six. Those 49 cover 570 pages between them -
# deity, plant, title, name, chief - and they are where a second word earns its
# place.
WORN_OUT_AT = 6

# A word ending in a digit. Legal, unique, and useless to a reader: /o/him and
# /o/him-2 say nothing about which is which.
NUMBERED = __import__("re").compile(r"-\d+$")  # searched, not matched: the digit is at the end


def is_reserved(spelling):
    import hashlib

    digest = hashlib.sha256(spelling.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % RESERVED_IN == 0

def instructions(chosen_by_people):
    """The brief, built around real examples rather than rules about them.

    Written this way after measuring the first version's output. That one was
    fifteen rules; the defects it produced were not the ones it failed to
    mention, they were the ones it mentioned abstractly. Three changes:

      - It shows the names people have already chosen on Wiktionary instead of
        describing them. 130 of those 141 are a single bare word - ache, arrive,
        wrap, teach, hoe - and one look at the list conveys that register better
        than "one word is much better than two" did.
      - The failures are worked pairs, wrong beside right, taken from what the
        first version actually produced. A rule says what not to do; a pair shows
        what to do instead.
      - It stops telling anyone that capitals and accents are stripped, and shows
        the addresses instead - see the question format below.

    The second version then overshot. Pushed on brevity, it produced /abarisa/deity
    where /abarisa/sky-deity had been right, /abajo/wonder for "no wonder", and
    /aadamo/given-name for a word whose meaning is Adam. Measured over 117 entries
    named twice: shorter on average, and worse. So brevity is no longer argued
    for - the two conditions under which a second word earns its place are stated,
    and both are facts the caller can compute.
    """
    return f"""\
You are naming pages in a Yorùbá-English dictionary.

Every page's address is two parts: the spelling with its tone marks and \
underdots removed, then one English word.

    /gba/take     /ile/home     /owo/money     /ro/ache

You are given every entry that shares one stripped spelling, and you choose the \
English word for each. The word is what tells a reader which of them they are \
looking at, and it is permanent - once a page is linked to, changing its address \
loses whatever that page had earned.

HOW THESE ARE NAMED

Editors have already named {len(chosen_by_people)} of these by hand, on Wiktionary. \
This is the register to write in:

    {chosen_by_people}

Almost every one is a single bare word. Not "be-sharp" but "sharp"; not \
"act-of-writing" but "write"; not "type-of-drum" but "drum".

WHAT TO WRITE

- Lowercase a-z and 0-9, hyphen between words, nothing else. Three words at the
very most, and that is a ceiling rather than a target.
- Take it from the definition. Do not translate the Yorùbá, do not invent a \
meaning, do not describe the entry.
- The most ordinary English word that fits, because a reader is going to type it \
or read it in a link: "receive" over "acquisition", "money" over "currency", \
"hurt" over "nociception".

ONE WORD OR TWO

One word, unless a second word earns its place. There are two ways to earn it:

1. The one-word answer is already taken by another entry in this group. The \
group is listed for you, so you can see when that happens.

   Only within the group. A word used by some other group is not taken - the \
spelling in front of it is different, so the address is different. /aja/dog, \
/kita/dog and /olokili/dog are three separate pages and all three are correct. \
Do not reach for "canine" because you saw "dog" somewhere else; reach for it \
only if another entry spelled the same way already has "dog".
2. The one-word answer names a category rather than a meaning. "the supreme sky \
deity of the Ekiti people" is not "deity" - hundreds of Yorùbá words could \
answer to that - it is "sky-deity". "a male given name meaning \u201cRoyalty befits \
me\u201d" is not "given-name", it is "royalty-befits-me".

Otherwise: one word. Do not add a second for emphasis, for completeness, or \
because the definition is long. "no wonder" is "no-wonder" and not "wonder", \
because the second word is the meaning; but "a slap with the hand" is "slap", \
because "with the hand" is not.

The test for both is the same one: does this word name what the entry means, or \
does it name the kind of thing the entry is? Name the meaning.

THE ONES THAT GO WRONG

Each of these was produced by someone doing this task before you.

    definition                              wrong               right
    ------------------------------------    ----------------    -----------
    a type of hairstyle                     type-of-hairstyle   hairstyle
    the act of saying                       act-of-saying       say
    to become sharp, fully awake            be-sharp            sharp
    a male given name meaning               male-given-name     royalty-befits-me
      "Royalty befits me"                   adeyemi
    alternative form of tuntun              alternative         be-new
      ("to be new")
    a drum, called batá                     bata                drum
    he/she/it                               hesheit             he-she-it
    "One who is begged for to have"         one-who-is-begged   begged-for
    a particle placed before a noun         precedes-a-noun     the meaning, not
                                                                the grammar

Two more, and these are the ones that cost the most:

- Never the Yorùbá word itself. "batá" is not an English word for batá, and \
neither is "bata" - that is just the spelling again, and the address already \
has the spelling in it.
- Never a sentence. If the definition is a long explanation of what a name \
means, take the two or three words at its heart.

WHEN TWO ENTRIES MEAN NEARLY THE SAME THING

This is the hard part and it is why you see a whole group at once.

Look for what the definitions actually say tells them apart, in this order:

1. A later definition. Where one entry is only "to fear" and another is "to \
fear" AND "to show respect, to venerate", the second is "venerate".
2. A different sense of the one idea. An adjective "little (in quantity)" and \
a noun "a little bit, few" are "little" and "few".
3. What the definition says about when the word is used. Two object pronouns, \
one after a high-tone verb and one after a low-tone verb, are "him-after-high" \
and "him-after-low" - not both "him". Three words is the ceiling, so say the \
distinguishing part and drop what can be inferred.
4. Only if nothing above works: say in words that it is a variant. \
"hospital" and "hospital-alt-spelling".

Never a number. "library-2" is not an answer, it is the absence of one written \
down, and a reader learns nothing from it.

A suggestion is shown for each entry. It comes from a rule that reads the first \
few words of the first definition, so it is often exactly right and sometimes \
clumsy. Use it when it is right. It is not a vote.
"""


SCHEMA = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "word": {"type": "string"},
                },
                "required": ["id", "word"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}


def _needs_asking(group, ledger_entries, etymid_names, entries_by_id, ask_all=False, generic=None):
    """The entries in one group with no address yet, and the context for all of them.

    Every member of the group is described in the prompt, including the ones
    already settled, because a word has to be distinct from those too.
    """
    asked, settled = [], []
    for item in group["entries"]:
        existing = ledger_entries.get(item["id"])
        # A provisional record is a placeholder the rule produced so the build
        # would always have an address, not an answer anybody gave. Those are
        # exactly what this is here to replace, so having one does not count as
        # being settled - it only used to, and then there was nothing to ask.
        #
        # Nor does a word ending in a number. /ile-ikawe/library-2 is not an
        # answer, it is the absence of one written down: whoever produced it had
        # nothing left to say and stuck a digit on the end. Sometimes that is the
        # honest outcome - two entries the source defines identically - but it is
        # never the first answer to accept, so these are always asked again.
        if (
            existing
            and not ask_all
            and not existing.get("provisional")
            and not NUMBERED.search(existing["word"])
            and not (generic and existing["word"] in generic)
        ):
            settled.append((item, existing["word"], "ledger"))
            continue
        if item["derivedWord"]:
            settled.append((item, item["derivedWord"], "rule"))
            continue
        chosen = etymid.for_entry(etymid_names, entries_by_id[item["id"]])
        if chosen:
            settled.append((item, chosen["name"], "etymid"))
            continue
        asked.append(item)
    return asked, settled


def _dedupe_settled(settled):
    """Two settled entries wanting one word means neither is settled.

    An {{etymid}} names an etymology section and a section can hold four entries -
    ẹ etymology 4 does - so all four inherit one name. The name is right and the
    address cannot be, so the group has to name them after all.
    """
    counts = {}
    for _, word, _ in settled:
        counts[word] = counts.get(word, 0) + 1
    keep, bounced = [], []
    for item, word, source in settled:
        (bounced if counts[word] > 1 else keep).append(
            item if counts[word] > 1 else (item, word, source)
        )
    return keep, bounced


def _prompt(spelling, asked, settled):
    """One group, written as the addresses it will produce.

    Addresses, not words, and that is the whole design of this format. Someone
    naming the /e/ group answered "E" for one entry and "e" for another, which
    are the same address, because nothing they could see told them the address is
    lowercased. Ten answers in that one group were refused for it.

    Telling them would have been a fifteenth rule in a list of fourteen. Showing
    them costs nothing: every decided entry is printed as the address it occupies
    and every open one as the address to be completed, so a repeat is visible
    rather than described.
    """
    lines = []
    lines.append(f"GROUP: every entry below is served at /{spelling}/<word>")
    lines.append("")
    lines.append("Addresses are lowercase, unaccented, and hyphenated - what you write is")
    lines.append("reduced to that before it is used. So two answers that differ only in")
    lines.append("capitals or accents are one address, and one of these entries would have")
    lines.append("no page at all.")
    lines.append("")

    if settled:
        lines.append(f"TAKEN in /{spelling}/ - a word here is not available to you:")
        for item, word, source in settled:
            detail = " · ".join(
                str(x) for x in (item["written"], item["pos"]) if x
            )
            lines.append(f"    /{spelling}/{word:<26}  {detail}  (from the {source})")
        lines.append("")

    lines.append(f"TO NAME - {len(asked)} of them, all different from each other and from the above:")
    lines.append("")
    for item in asked:
        detail = " · ".join(
            str(x)
            for x in (
                item["written"],
                item["pos"],
                f'etymology {item["etymologyNumber"]}' if item["etymologyNumber"] else None,
            )
            if x
        )
        lines.append(f"    /{spelling}/________     {detail}")
        lines.append(f"        id: {item['id']}")
        if item["ruleWord"]:
            lines.append(f"        a rule suggests: {item['ruleWord']}")
        for i, definition in enumerate(item["definitions"], 1):
            lines.append(f"        {i}. {definition}")
        lines.append("")
    return "\n".join(lines)


# Two names on Wiktionary that this project wrote and then found to be bugs: the
# old naming rule deleted punctuation instead of splitting on it, so "he/she/it"
# became "hesheit". They are still live on the wiki, and they must not be shown to
# anyone as an example of the register to write in - a bad exemplar is copied far
# more reliably than a rule is followed.
KNOWN_BAD_NAMES = {"hesheit", "himherit"}


def register(etymid_names):
    """The names editors chose, minus the ones we know are wrong."""
    return {v["name"] for v in etymid_names.values()} - KNOWN_BAD_NAMES


def worn_out(book=None):
    """Words so many pages already share that they identify nothing.

    A DIAGNOSTIC, and deliberately not part of the brief any more.

    It was in the brief once, as a list of words not to use. That regenerated the
    whole dictionary and made it worse: told which 49 words were banned, the model
    avoided them and reached for equally general words that happened not to be
    listed. "alternative" went from 3 pages to 36, "unknown" from 1 to 13,
    "entry" from 0 to 7, and three different Nigerian states all became
    /<spelling>/nigeria. A blocklist does not produce specificity; it produces
    evasion into unlisted vocabulary.

    So it is measured on the way out instead of handed over on the way in. What
    it is for is choosing which entries to ask about again - see -generic - which
    converges without giving anyone a list to route around.
    """
    from collections import Counter

    entries = (book or ledger.load())["entries"]
    counts = Counter(r["word"] for r in entries.values())
    return sorted(w for w, n in counts.items() if n >= WORN_OUT_AT)


def current_brief(etymid_names=None):
    """The brief, with the register taken from the repository rather than written
    down here, so it stays true as more etymologies get named on Wiktionary."""
    names = etymid_names if etymid_names is not None else etymid.load()
    return instructions(", ".join(sorted(register(names))))


def build_requests(limit=None, model=MODEL, reserved=False, ask_all=False, generic=None):
    groups = data.load_groups()
    book = ledger.load()
    etymid_names = etymid.load()
    brief = current_brief(etymid_names)
    entries_by_id = json.loads(
        (data.REPO_DIR / "public/data/entries.json").read_text(encoding="utf-8")
    )

    requests, plan = [], []
    for group in groups["groups"]:
        if is_reserved(group["spelling"]) != reserved:
            continue
        asked, settled = _needs_asking(
            group, book["entries"], etymid_names, entries_by_id, ask_all, generic
        )
        settled, bounced = _dedupe_settled(settled)
        asked = asked + bounced
        if not asked:
            continue
        prompt = _prompt(group["spelling"], asked, settled)
        plan.append({"spelling": group["spelling"], "asked": len(asked), "chars": len(prompt)})
        # Plain dicts, not the SDK's Request/MessageCreateParamsNonStreaming:
        # those are TypedDicts, so this is the same payload, and it means -plan
        # runs without the SDK installed. Planning is offline work.
        requests.append(
            {
                "custom_id": f'g-{group["spelling"]}',
                "params": {
                    "model": model,
                    "max_tokens": 4096,
                    "system": [{"type": "text", "text": brief,
                                "cache_control": {"type": "ephemeral"}}],
                    "thinking": {"type": "adaptive"},
                    "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}},
                    "messages": [{"role": "user", "content": prompt}],
                },
            }
        )
        if limit and len(requests) >= limit:
            break
    return requests, plan


def plan(limit=None, model=MODEL, reserved=False):
    requests, rows = build_requests(limit, model, reserved)
    entries = sum(r["asked"] for r in rows)
    chars = sum(r["chars"] for r in rows)
    # Rough, and rough is enough to decide with. Batch pricing halves both rates;
    # the shared instructions cache, so most of the input is the group itself.
    in_tokens = chars / 3.6 + len(rows) * 40
    out_tokens = entries * 22
    cost = (in_tokens / 1e6) * 2.50 + (out_tokens / 1e6) * 12.50
    print(f"groups to ask about : {len(rows)}")
    print(f"entries to name     : {entries}")
    print(f"model               : {model}")
    print(f"estimated cost      : about ${cost:.2f} (batch rates, {in_tokens/1000:.0f}k in, {out_tokens/1000:.0f}k out)")
    print()
    biggest = sorted(rows, key=lambda r: -r["asked"])[:5]
    print("biggest groups:", ", ".join(f'{r["spelling"]} ({r["asked"]})' for r in biggest))
    if rows:
        print(f'\nOne request, as it will be sent ({rows[0]["spelling"]}):\n')
        print("  " + "\n  ".join(requests[0]["params"]["messages"][0]["content"].splitlines()[:24]))
    return requests


def submit(limit=None, model=MODEL, reserved=True):
    import anthropic

    requests, rows = build_requests(limit, model, reserved)
    if not requests:
        raise SystemExit("Nothing to ask about - every entry already has a word.")
    client = anthropic.Anthropic()
    batch = client.messages.batches.create(requests=requests)
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps({"id": batch.id, "model": model, "groups": len(requests)}, indent=2),
        encoding="utf-8",
    )
    print(f"batch {batch.id}: {len(requests)} groups, {sum(r['asked'] for r in rows)} entries")
    print(f"status {batch.processing_status}")
    print(f"\nCollect it with:  python3 tools/slugs/propose.py -collect")
    return batch.id


def collect(batch_id=None, wait=True):
    import anthropic

    if not batch_id:
        if not STATE_PATH.exists():
            raise SystemExit("No batch on record. Pass -batch:<id>.")
        batch_id = json.loads(STATE_PATH.read_text(encoding="utf-8"))["id"]

    client = anthropic.Anthropic()
    while True:
        batch = client.messages.batches.retrieve(batch_id)
        if batch.processing_status == "ended" or not wait:
            break
        counts = batch.request_counts
        print(f"  {batch.processing_status}: {counts.succeeded} done, {counts.processing} running")
        time.sleep(60)
    if batch.processing_status != "ended":
        raise SystemExit(f"batch {batch_id} is {batch.processing_status}, not ready")

    groups = {g["spelling"]: g for g in data.load_groups()["groups"]}
    book = ledger.load()
    tallies = {"added": 0, "kept": 0, "moved": 0}
    problems = []

    for result in client.messages.batches.results(batch_id):
        spelling = result.custom_id[2:]  # strip the "g-" that keeps ids readable
        if result.result.type != "succeeded":
            problems.append(f"{spelling}: {result.result.type}")
            continue
        message = result.result.message
        if message.stop_reason == "refusal":
            problems.append(f"{spelling}: refused")
            continue
        text = next((b.text for b in message.content if b.type == "text"), "")
        try:
            answer = json.loads(text)
        except json.JSONDecodeError:
            problems.append(f"{spelling}: unreadable answer")
            continue

        group = groups.get(spelling)
        if not group:
            problems.append(f"{spelling}: no such group any more")
            continue
        by_id = {e["id"]: e for e in group["entries"]}
        for item in answer.get("words") or []:
            source_entry = by_id.get(item["id"])
            if not source_entry:
                problems.append(f'{spelling}: unknown id {item["id"]}')
                continue
            word = _fold_word(item["word"])
            if not word:
                problems.append(f'{spelling}: empty word for {item["id"]}')
                continue
            outcome = ledger.merge(
                book,
                item["id"],
                ledger.record(
                    spelling,
                    word,
                    "model",
                    source_entry["written"],
                    source_entry["pos"],
                    source_entry["etymologyNumber"],
                ),
            )
            tallies[outcome] += 1

    ledger.save(book)
    print(f'wrote data/url-slugs.json: {tallies["added"]} added, '
          f'{tallies["kept"]} unchanged, {tallies["moved"]} moved')
    print(f"ledger now holds {len(book['entries'])} addresses")
    if problems:
        print(f"\n{len(problems)} groups had a problem and were left alone:")
        for line in problems[:20]:
            print("  " + line)
    print("\nNow: python3 tools/slugs/check.py")


def batches(limit=None, per=200, reserved=False, ask_all=False, generic=None):
    """Write the questions to files, one per agent.

    A file, not a prompt in a message, because the answer has to be checked
    against the question and both have to still be there afterwards. An agent
    that misreads an id, invents one, or gives two entries the same word is
    caught in -ingest by comparing the two files - which is the same reason
    tools/wiktionary writes a worksheet rather than asking a question.
    """
    requests, rows = build_requests(limit, MODEL, reserved, ask_all, generic)
    if not requests:
        print("Nothing to ask about - every entry in scope already has a word.")
        return []

    QUESTIONS_DIR.mkdir(parents=True, exist_ok=True)
    ANSWERS_DIR.mkdir(parents=True, exist_ok=True)
    # Both directories, not just the questions. Leaving old answers behind meant
    # a numbered file from a previous round sat next to a new question file of
    # the same name, and -ingest would read answers about groups that were never
    # asked this time. An agent noticed before the tool did.
    for stale in list(QUESTIONS_DIR.glob("*.json")) + list(ANSWERS_DIR.glob("*.json")):
        stale.unlink()

    written = []
    for start in range(0, len(requests), per):
        chunk = requests[start : start + per]
        number = len(written) + 1
        path = QUESTIONS_DIR / f"{number:03d}.json"
        path.write_text(
            json.dumps(
                {
                    "batch": number,
                    "instructions": current_brief(),
                    "answerTo": str((ANSWERS_DIR / f"{number:03d}.json").resolve()),
                    "groups": [
                        {
                            "spelling": request["custom_id"][2:],
                            "question": request["params"]["messages"][0]["content"],
                        }
                        for request in chunk
                    ],
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        written.append(path)

    entries = sum(r["asked"] for r in rows)
    print(f"{len(requests)} groups, {entries} entries, {len(written)} files")
    print(f"  questions: {QUESTIONS_DIR}")
    print(f"  answers:   {ANSWERS_DIR}")
    return written


def ingest(reserved=False):
    """Read the agents' answers, check every one, and write what survives.

    Nothing is taken on trust. An id that is not in the group it was asked
    about, a word that is not URL-safe, two entries in one group given the same
    word - each is dropped and counted, and whatever is dropped simply stays
    unanswered, so a later pass picks it up. A wrong address is far worse than a
    missing one: a missing one is a rule-derived placeholder, and a wrong one is
    a permanent promise to the wrong page.
    """
    groups = {g["spelling"]: g for g in data.load_groups()["groups"]}
    book = ledger.load()
    entries_by_id = json.loads(
        (data.REPO_DIR / "public/data/entries.json").read_text(encoding="utf-8")
    )
    tallies = {"added": 0, "kept": 0, "confirmed": 0, "replaced": 0, "moved": 0}
    rejected = []
    seen_files = 0

    for path in sorted(ANSWERS_DIR.glob("*.json")) if ANSWERS_DIR.exists() else []:
        seen_files += 1
        try:
            answer = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            rejected.append(f"{path.name}: not readable as JSON ({error})")
            continue

        for item in answer.get("groups") or []:
            spelling = item.get("spelling")
            group = groups.get(spelling)
            if not group:
                rejected.append(f"{path.name}: no group spelled {spelling!r}")
                continue
            if is_reserved(spelling) != reserved:
                rejected.append(f"{path.name}: /{spelling}/ is in the reserved holdout")
                continue

            by_id = {e["id"]: e for e in group["entries"]}

            def settled_elsewhere(this_id):
                """Words held by the OTHER entries in this group.

                Excluding the entry being named, which is not optional: its own
                current word is not a collision with itself. Including it meant
                re-running -ingest over a file already ingested refused every
                answer in it as "claimed twice" - and -ingest has to be safe to
                re-run, because answers arrive a batch at a time.
                """
                return {
                    book["entries"][e["id"]]["word"]
                    for e in group["entries"]
                    if e["id"] != this_id
                    and e["id"] in book["entries"]
                    and not book["entries"][e["id"]].get("provisional")
                }

            taken = set()

            for named in item.get("words") or []:
                entry_id = named.get("id")
                source_entry = by_id.get(entry_id)
                if not source_entry:
                    rejected.append(f"{path.name}: /{spelling}/ has no entry {entry_id!r}")
                    continue
                raw = named.get("word") or ""
                # Must be plain ASCII before anything is folded away. The fold
                # turns "bààlúù" into "baaluu" and "batá" into "bata", which are
                # legal addresses and useless ones - they are the Yorùbá handed
                # back rather than an English word for it. Non-ASCII in the
                # answer is the reliable sign of that, and of a definition quoted
                # wholesale with its curly quotes.
                if not raw.isascii():
                    rejected.append(f"{path.name}: {entry_id} answered in Yorùbá, not English ({raw!r})")
                    continue
                word = _fold_word(raw)
                if not word:
                    rejected.append(f"{path.name}: empty word for {entry_id}")
                    continue
                # An address nobody can read, type or recognise in a search
                # result. One answer was a 200-character sentence explaining what
                # a name means; folded, it is a 200-character address.
                if len(word) > MAX_WORD:
                    rejected.append(f"{path.name}: {entry_id} answered with {len(word)} characters")
                    continue
                # Three is the ceiling. Every four-word address in the shipped
                # ledger was written by a model rather than produced by the rule,
                # which makes it enthusiasm rather than necessity.
                if word.count("-") + 1 > MAX_PARTS:
                    rejected.append(
                        f"{path.name}: {entry_id} answered with {word.count('-') + 1} words ({word})"
                    )
                    continue
                # Yorùbá in the Arabic script has to say so somewhere in its
                # address. Nobody can type the spelling, and nothing links to
                # these pages, so the address is the only place a reader finds
                # out what they are looking at. Either segment counts - the
                # alphabet's own letters already say it in the first one.
                if data.is_ajami(entries_by_id[entry_id]) and "ajami" not in (
                    f"{spelling}/{word}"
                ):
                    rejected.append(
                        f'{path.name}: /{spelling}/{word} is Ajami and does not say so'
                    )
                    continue
                if word in taken or word in settled_elsewhere(entry_id):
                    # Two entries at one address means one of them has no page.
                    rejected.append(f"/{spelling}/{word} claimed twice")
                    continue
                taken.add(word)
                tallies[
                    ledger.merge(
                        book,
                        entry_id,
                        ledger.record(
                            spelling, word, "model",
                            source_entry["written"], source_entry["pos"],
                            source_entry["etymologyNumber"],
                        ),
                    )
                ] += 1

    ledger.save(book)
    named = tallies["added"] + tallies["replaced"] + tallies["moved"] + tallies["confirmed"]
    print(f"{seen_files} answer files, {named} addresses settled "
          f"({tallies['replaced']} placeholders replaced, "
          f"{tallies['confirmed']} placeholders confirmed as they were, "
          f"{tallies['added']} new, {tallies['moved']} moved), "
          f"{tallies['kept']} already settled")
    still = sum(1 for r in book["entries"].values() if r.get("provisional"))
    print(f"{still} of {len(book['entries'])} still placeholders")
    if rejected:
        print(f"\n{len(rejected)} answers refused and left unanswered:")
        for line in rejected[:20]:
            print("  " + line)
        if len(rejected) > 20:
            print(f"  … {len(rejected) - 20} more")
    print("\nNow: python3 tools/slugs/check.py")
    return tallies


def _fold_word(word):
    """Same reduction build/lib/address.mjs applies, for a word typed by a model."""
    import re
    import unicodedata

    text = unicodedata.normalize("NFD", (word or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", text))


def main(argv):
    flags = {a.split(":", 1)[0]: (a.split(":", 1)[1] if ":" in a else True) for a in argv}
    limit = int(flags["-limit"]) if "-limit" in flags else None
    per = int(flags["-per"]) if "-per" in flags else 200
    model = flags.get("-model") if isinstance(flags.get("-model"), str) else MODEL
    reserved = "-reserved" in flags
    if "-batches" in flags:
        # -generic re-asks about the addresses that came out over-general, chosen
        # by counting the result rather than by handing anyone a list to avoid.
        # A round of this converges; a blocklist in the brief did not.
        batches(limit, per, reserved, "-all" in flags, set(worn_out()) if "-generic" in flags else None)
    elif "-ingest" in flags:
        ingest(reserved)
    elif "-submit" in flags:
        submit(limit, model, reserved)
    elif "-collect" in flags:
        collect(flags.get("-batch") if isinstance(flags.get("-batch"), str) else None)
    else:
        plan(limit, model, reserved)


if __name__ == "__main__":
    main(sys.argv[1:])
