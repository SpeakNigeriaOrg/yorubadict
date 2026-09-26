# tools/slugs — the English word in every web address

Every entry in this dictionary lives at an address in two parts:

```
/yo/gba/take     /yo/ile/home     /yo/ro/ache     /yo/owo/money
     ───  ────
      │     └── this half: one English word, chosen here
      └──────── the spelling, tone marks and underdots removed,
                decided by build/lib/address.mjs

The /yo/ prefix keeps the root free for pages that are not dictionary entries.
```

This directory is what chooses the English word, writes it down in
`data/url-slugs.json`, and lets you read and change every one before it becomes
a URL.

## Weekly

The refresh workflow runs every Monday, on its own, and never stops for an
address question. Everything Wiktionary changed is served the safe way at once,
and listed for a person in **one pull request, "Dictionary changes"**, holding
one sheet. Nothing here needs a terminal.

### Why one sheet

An entry's Kaikki id is its first sense's id: page, part of speech, and a hash
of that sense's text. So an id changes when a page moves, when a part of speech
is corrected, when a sense is added above the first or senses are reordered, when
a `{{senseid}}` is added - and when a single word of the first definition is
edited. Deleting "Èkìtì" from ẹrẹja's definition gave it a new id. To the ledger,
each of those first looks like one word leaving and another arriving.

`build/lib/continuity.mjs` pairs them on everything the data carries: the old id
surviving among the new entry's sense ids, the id hash surviving a move, how much
of one entry's definitions the other's cover, spelling, written form, part of
speech, page section. Clear cases are matched automatically. Everything else is
shown to a person - and it is shown grouped by spelling, old and new definitions
side by side, because a word that left and a word that arrived with the same
spelling in the same week are usually one word, edited, and that is only visible
when both are on the page together.

### What the sheet asks

| Item | Served meanwhile as | The one line to change |
|---|---|---|
| **NEW WORD** | a rule-made address, out of the sitemap | `word:` - the English word. Or `same as:` an address from the WORD LEFT items, if it is that word under a new id (prefilled when there is one likely match). Empty both to leave it alone for good. |
| **WORD LEFT** | its address redirects (302) to the page for its spelling, or to a search when no word is spelled that way any more | `gone: yes` once you are sure it is not one of the new words. |
| **SPELLING CHANGED** | still at its old address | `move: yes` to move it; the old address keeps redirecting. |
| **WORD MAY NOT FIT** | at its address, whose word no longer appears in its definitions (Okù at `/oku/contextually`, when its definition became "Ancestors...") | `word:` - change it to rename; the old address redirects. |
| **MATCHED** | at its old address, matched automatically | `same word: no`, only if the match is wrong. It is undone and never offered again. |

A line left empty waits for next week; items are worked out from the ledger as
it stands, so nothing is lost by waiting. Each edit to the sheet gets a comment
from a check: exactly what merging will do (✓), or what to fix (✗). Merging is
the sign-off; `.github/workflows/changes.yml` writes it into the ledger.

### When a person is told something else

**An issue, "Dictionary refresh needs you"**, opens only when a refresh stopped -
a test, the ranking check or the download failed, or hundreds of addresses lost
their entries at once, which is the id scheme changing upstream and wants a
programmer rather than a sheet. It closes itself the next time a refresh needs
nothing.

Opening the pull request automatically needs **"Allow GitHub Actions to create
and approve pull requests"**, under Settings > Actions > General > Workflow
permissions - first in the SpeakNigeriaOrg organization's settings (while it is
off there, the repository's own checkbox is greyed out), then in the
repository's. Without it nothing is lost: the sheet's branch is still pushed,
and the issue carries a one-click link to open the pull request by hand. Locally,
`node tools/slugs/changes.mjs write` makes the same sheet and
`node tools/slugs/changes.mjs apply FILE` reads it back.

Everything below is how the ledger was first written and why it works the way
it does. Week to week, the section above is all of it.

## Why the word is written down rather than worked out

It would be easy to derive it on every build — take the first few words of the
first definition, which is what `build/lib/address.mjs` does as a floor. For a
while that is exactly what happened.

The problem is that an address is a promise. Once a page is linked to from
somewhere, or indexed, moving it costs whatever that page had earned. And the
dictionary is rebuilt from a weekly kaikki-yoruba release, so a Wiktionary editor
rewording one definition would move a page — silently, with nothing reporting it,
in a commit that looks like a data refresh.

Written down, the word survives the rewording. **The build reads
`data/url-slugs.json` and never writes it.** If an entry is missing from it, the
build fails rather than inventing an address, because inventing one is the
failure this whole arrangement exists to prevent.

Proof that it works: a mid-development refresh moved the source from one
kaikki-yoruba release to another, and the ledger reported `0 added, 6273
unchanged, 0 moved`.

## The four scripts

Run them in this order. All of them are offline except `propose.py -submit`
and `-collect`.

```
python3 tools/slugs/seed.py       every entry gets an address, from what is
                                  already known. No credentials needed.
python3 tools/slugs/propose.py    a model proposes a better word for the ones
                                  that are still placeholders.
python3 tools/slugs/review.py     worksheets, one per letter. You read them.
python3 tools/slugs/check.py      everything that must be true before deploying.
```

### seed.py

Fills every gap using three sources, in order:

1. **A rule in `build/lib/address.mjs`.** Ajami spellings (`/funfun/ajami`), the
   Ajami alphabet's own letters (`/ajami-letter/twenty-fourth`), and the tone
   marks (`/tone-mark/low`). These are derivable, so nobody is asked.
2. **An `{{etymid}}` a person already chose on Wiktionary.** 149 of them. These
   were picked while reading the whole page and are better than anything a rule
   or a model comes up with — `ache` where the rule said `pain`, `teach` where it
   said `build`.
3. **The first few words of the first definition.** The floor. Marked
   `provisional`, because it is a placeholder rather than a decision.

The point of running this first is that the site has a complete set of addresses
before anything else happens, so it is never half-built and `check.py` always has
something to check.

It reports how many needed a number stuck on the end. A numbered address is a bad
address — `/o/him` and `/o/him-2` tell a reader nothing about which is which — so
those are counted and listed rather than quietly applied, and they are the first
thing to fix in review.

### propose.py

Asks a model for a better word for every entry still holding a placeholder.

**It asks about a whole spelling group at a time** — all nine entries spelled
`gba` in one request — and requires a different word for each. That is not an
optimisation. Every address collision measured against the shipped data was two
entries inside one group, so a group named against itself cannot produce one. It
also gives better words, because "to take" and "to sweep" are only obviously the
right pair when you can see both.

There are two routes to the same answer, and the ledger cannot tell them apart.

#### Agents — no account, no key, no bill

This is how the dictionary was named.

```
python3 tools/slugs/propose.py -batches -per:200
```

writes the questions to `work/questions/NNN.json` — 21 files for 4,195 groups.
Hand each file to a subagent with the naming rules and the answer path; it writes
`work/answers/NNN.json`. Then:

```
python3 tools/slugs/propose.py -ingest
```

Questions and answers are **files, not messages**, and that is the point: the
answer can be checked against the question, and both are still there afterwards.
`-ingest` trusts nothing. An id that was not in the group it was asked about, a
word that is not URL-safe, two entries in one group given the same word — each is
dropped, counted, and left unanswered for a later pass. A wrong address is far
worse than a missing one: a missing one is a rule-derived placeholder, and a
wrong one is a permanent promise to the wrong page. It caught a duplicate `him`
on the first batch.

#### Batches API — for the reserved holdout

```
python3 tools/slugs/propose.py -plan -reserved      what would be asked, and cost
python3 tools/slugs/propose.py -submit -reserved    create the batch
python3 tools/slugs/propose.py -collect             write the answers in
```

One group in thirty is held back, chosen by a hash of the spelling so the set
stays stable as the dictionary grows and spreads across the alphabet rather than
taking a slice of it. **139 groups, 191 entries, about 10 cents.**

It is not a sample of what is left to do. It is a sample of what has been done,
kept unanswered so a different model can be pointed at it and its answers
compared against ones already in the ledger. Naming everything first would leave
nothing to measure a second opinion against except taste.

Credentials for this route only: `ANTHROPIC_API_KEY`, or an `ant auth login`
profile. `pip install -r tools/slugs/requirements.txt`.

#### Either way

**The model never runs during `npm run build`,** and must not. The build has no
dependencies and gives the same answer every time. An address that moved because
a model was asked twice is a dead page.

### review.py

Writes `tools/slugs/work/<letter>.md`, one file per first letter, holding every
group under that letter with its full definitions and the word currently proposed.
Edit the `word:` lines.

Approval is **per file**, not per entry: set `reviewed: no` to `yes` at the top
and every word in the file counts as checked. A letter is a sitting. Requiring a
mark per entry would mean the common case — "these forty are all fine" — takes
forty edits, and nobody would do it.

```
python3 tools/slugs/review.py             write the worksheets
python3 tools/slugs/review.py -letter:a   just that one
python3 tools/slugs/review.py -apply      read them back into the ledger
```

The site works with unreviewed words in the meantime. They are just not promises
yet, and `check.py` prints how many are still unchecked.

Regenerating will not clobber a file you have open and have not applied.

### check.py

Ordered by how much damage each fault does. The first is the worst: **two entries
at one address** means the build writes one file twice and the loser has no page,
and nothing else in the system would say so.

Also refuses: a word that is not URL-safe; an address that would shadow a page of
the site (`/about`, `/app.js`); a ledger that disagrees with `address.mjs` about a
spelling; an entry with no address at all; a retired address that is also a live
one; and more than 1,500 retirements, because Cloudflare Pages allows 2,100
static redirects.

## Changing a word later

Edit it in the worksheet and `-apply`, or edit `data/url-slugs.json` directly. A
record that has been reviewed or proposed keeps its old address in `retired`, and
`build/lib/prerender.mjs` turns that into a 301 in `public/_redirects`, so the old
link keeps working.

A `provisional` record is replaced outright with no redirect, because nobody ever
had that link.

## Where things live

| | |
|---|---|
| `data/url-slugs.json` | the ledger. Committed. The point of all this. |
| `build/lib/address.mjs` | the first segment, and the only thing that decides it |
| `build/lib/slugs.mjs` | reads the ledger during the build, and fails loudly |
| `build/print-address-groups.mjs` | how these scripts see the grouping — by running `address.mjs`, not by copying it |
| `tools/slugs/work/` | worksheets. Not committed. |

There is deliberately no Python copy of the folding rule. A copy would have to
agree with `address.mjs` exactly and forever, and a disagreement would not fail —
it would file a word at an address the site never serves.

## Its sibling

`tools/wiktionary/` does the same shape of job for `{{etymid}}` names on
Wiktionary itself: propose, review in a Markdown worksheet, then act. The two now
share the naming rule (`wordFromDefinition` in `address.mjs`), which is how a bug
was found: the old copy in `wiktionary-tasks.mjs` deleted punctuation instead of
splitting on it, so `he/she/it` became `hesheit` — and that name is on
en.wiktionary now, on `o`'s third etymology.

What they do not share is identity. An `{{etymid}}` names an etymology section,
which can hold four entries; a slug names one entry. Different counts, different
uniqueness rules.
