# Writing etymology names to Wiktionary

A Pywikibot script that proposes edits, shows you the diff, and saves one page
when you confirm it.

It runs under **your own account**, not a bot account. That is en.wiktionary's
own advice — if a task looks like it wants a bot, try Pywikibot under your own
account first and see whether it helps. A separate bot account and a bot flag
are for unattended, high-volume work, which this is not.

Nothing here is served to the web, and none of it runs during `npm run build`.

## What it is for

A word like `kọ` has seven meanings on one Wiktionary page. When another word
says it was built from `kọ`, it names a spelling, not a meaning — so the
dictionary has to guess which of the seven was meant, and it is often wrong.

`{{etymid}}` fixes that at the source. It gives each etymology a name, so other
pages can point at one meaning:

```wikitext
===Etymology 5===
{{etymid|yo|write}}
```

Once that exists, a compound can say `id2=write` and the guess disappears
permanently. `build/lib/wiktionary-tasks.mjs` works out which names are missing
and what would point at them; this script carries out what you approve.

## Setting up

```bash
cd tools/wiktionary
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp user-config.py.example user-config.py     # then put your username in it
```

`user-config.py` needs one real edit — your Wiktionary username:

```python
usernames['wiktionary']['en'] = 'YourWiktionaryUsername'
```

Then log in once, from this directory. Pywikibot stores a session cookie in
`pywikibot.lwp`, so your password is never written to disk:

```bash
.venv/bin/pwb login
```

Pywikibot keeps its config and state — that cookie, the API cache, the logs,
the throttle file — in a "base directory", and picks it from the current
directory unless told otherwise. `etymid.py` sets it to its own directory, so
you can run the script from anywhere and everything it writes stays here, under
the .gitignore entries. `pwb login` is a separate program and has no such
setting, so run that one from this directory (or pass `-dir:.`).

## Using it

```bash
cd tools/wiktionary

.venv/bin/python etymid.py -page:kọ -propose     # write the worksheet
.venv/bin/python etymid.py -page:kọ -check       # read it back — no network
.venv/bin/python etymid.py -page:kọ -simulate    # show the diff, save nothing
.venv/bin/python etymid.py -page:kọ              # show the diff, ask, save
```

**`-propose`** reads the page and writes `work/<page>/worksheet.md`, listing
every etymology with its definitions, the words that would point at it, and a
proposed name:

```
## Etymology 5

    id: write

    kọ · verb · /kɔ/
    1. to write

    would be pointed at by:
      àkọtọ́  "orthography"  (id2)
      àròkọ  "essay"  (id3)
```

Edit the `id:` lines. Everything else is reference material and is ignored. A
blank `id:` skips that etymology. The words that would point at a name are
shown beneath it because you cannot judge a name without seeing what it is for.

**`-check`** parses the worksheet and prints back exactly what it understood,
using the page text `-propose` already read. It makes no requests.

**`-simulate`** is Pywikibot's own dry run: it does everything including
building the diff, and saves nothing.

**No flag** shows the diff, asks, and saves. One page per run — there is no
batch mode and no generator over the queue.

## What Pywikibot does, and what is ours

Pywikibot is a MediaWiki framework, not a dictionary one. `textlib` will hand
you the headings on a page, but nothing in it has heard of an etymology, and
nothing knows that a Yorùbá compound points at a meaning. So the split is:

**Pywikibot's** — login and session, tokens, the diff display, the y/n prompt,
the ten-second throttle, edit-conflict detection, `-simulate`, the User-Agent,
and `mwparserfromhell` for parsing wikitext.

**Ours** — which etymology deserves which name, and whether the page still
means by "Etymology 5" what our data means by it. That is `lib/align.py` and
`lib/wikitext.py`, and it is the part no framework could supply.

## What it will not do

Each gate exists because the case is real, and none of them appears on `kọ` —
which is why `kọ` alone was not enough to design against.

| | |
|---|---|
| **The section is not on that page** | `a` has no Yorùbá section: en.wiktionary moves the smaller languages of a "mammoth page" onto `a/languages M to Z` and transcludes them back. The script finds the subpage that actually holds the section, or stops. |
| **The page moved since the worksheet** | Etymology numbering shifts under you. Regenerate. |
| **The numbering disagrees with our data** | Every etymology is checked against the definitions we hold for it. Measured over all 536 sections in the queue: no false stops, and 112 of 113 pages are caught when their etymologies are renumbered by one. |
| **A name already exists** | Never written over, and never normalised — judged on the live page, not on our data, which can be a week old. `sun` etymology 2 is already named `to roast, burn`, which is not what our rules would generate, and a word already points at it. |
| **Somebody named it while you were deciding** | Their name stands, and the script says so rather than dropping yours in silence. |
| **Two names would be the same** | Including against names already on the page. |
| **We have no definition for an etymology** | `ga` etymology 2 and `gbe` etymology 7 have nothing extractable. They are listed in the worksheet and left unnamed, so the gap is a decision rather than an oversight. |

The one page that can defeat the numbering check is `eye`, whose two
etymologies are defined in almost the same words. Nothing that compares
definitions can tell those apart, and swapping their names would matter little.

## Etiquette

Most of this is Pywikibot's by default. What we set:

- `user_agent_description` in `user-config.py` carries the tool name and a
  contact address, per Wikimedia's User-Agent policy.
- `put_throttle = 10` — ten seconds between saves.
- **`bot=False` and `minor=False` on every save.** Pywikibot's `page.save()`
  defaults to `bot=True, minor=True`; both are wrong here. These edits are
  confirmed by a person, en.wiktionary requires approval before an account may
  flag edits as a bot's, and adding an anchor other pages will point at is not
  a minor edit.
- `-always`, which would skip the confirmation, is accepted only together with
  `-simulate`. On a real save it would defeat the one gate the design rests on.

Consider a line on your Wiktionary user page saying you use this, linking the
repo. It is the first thing anyone checks.

## Records

`records/` holds one JSON and one `.diff` per edit that actually happened —
what was sent, and the diff the server recorded afterwards. Simulated runs and
refused saves do not write records. It is committed, so a reviewer asking what
this script has done can be shown every edit it has made.

## Adding another job

`etymid.py` is one job. The next is the other half of it: putting `id2=write`
on each word built from `kọ`. It touches the parent page plus one page per
derived word, so it runs Pywikibot's generator over several pages instead of
one — the confirmation stays per page. The reusable parts are already in `lib/`:
`wikitext.py` for reading and changing a language's section, `align.py` for the
numbering check, `worksheet.py` for the file you edit, `data.py` for the build
output, `record.py` for the audit trail.
