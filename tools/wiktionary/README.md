# Writing etymology names to Wiktionary

A Pywikibot script that proposes edits, shows you the diff, and saves one page
when you confirm it.

It runs under **your own account**, not a bot account. That is en.wiktionary's
own advice — if a task looks like it wants a bot, try Pywikibot under your own
account first and see whether it helps. A separate bot account and a bot flag
are for unattended, high-volume work, which this is not.

(It does use a *bot password*, which despite the name is not a bot account but
a scoped second password on your own account. See
[below](#why-a-bot-password-when-this-runs-under-your-own-account).)

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
cp user-config.py.example user-config.py
```

Now edit **`user-config.py`** — the copy, not the `.example` — and put your
Wiktionary username in it:

```python
usernames['wiktionary']['en'] = 'YourWiktionaryUsername'
```

Then create a **bot password** at
<https://en.wiktionary.org/wiki/Special:BotPasswords>, logged in as that
account. Name it `yorubadict` and tick exactly three grants:

- **Basic rights** — needed for any API access at all. It also carries
  `editsemiprotected`, which is why *Edit protected pages* is not on this list:
  a busy entry is semi-protected, and this covers that.
- **Edit existing pages** — where the `edit` right actually lives.
- **Edit your watchlist** — the script saves with `watchlist='watch'`.
  MediaWiki's note on this grant reads "some actions will still add pages even
  without this right", and "some" is not a guarantee.

Nothing else is needed. Not *High-volume (bot) access*, which carries the `bot`
right this tool deliberately never uses; not *Create, edit, and move pages*,
since it only ever edits pages that already exist; and none of the grants marked
as a vandalism or security risk. (*View your watchlist* is harmless if you tick
it — read-only and unmarked — but nothing here reads a watchlist.) It shows you
a 32-character password once.

One thing to know for later: **changing your Wiktionary account password stops
every bot password working** until you reset it, and `Special:BotPasswords`
flags the ones awaiting a reset. If logins start failing out of nowhere, that
is the first thing to check.

```bash
cp user-password.py.example user-password.py
chmod 600 user-password.py
```

Put the password in it, then log in once:

```bash
.venv/bin/pwb login
```

Pywikibot stores a session cookie in `pywikibot.lwp`, so the password is read
only at login.

### Why a bot password, when this runs under your own account

A bot password is **not a bot account**. It is a second, scoped password on
your own account. Edits still appear in page history as you, there is no
separate account, and there is no bot flag — so this still is what
en.wiktionary recommends, which is to try Pywikibot under your own account
before asking for anything more.

What it avoids is a deprecation. MediaWiki has deprecated main-account login
via `action=login`, and Pywikibot chooses between that and the supported
`action=clientlogin` with this test:

```python
botpassword = '@' in user or '@' in password
```

So an ordinary account password that merely happens to contain an `@` is read
as a bot password, and the login silently takes the deprecated path — which is
what happened here the first time. A bot password makes that choice correct
instead of accidental, and it is the route MediaWiki's own warning points to.

It also means this machine never stores the password to the account itself.
The bot password is revocable on its own, from the same page that issued it.

## Using it

Four stages, run one at a time. The work happens between the first and the
second — the script proposes names, you correct them, and only then does
anything reach Wiktionary.

**1. Propose.** Reads the page and writes a worksheet.

```bash
cd tools/wiktionary
.venv/bin/python etymid.py -page:kọ -propose
```

It prints the path it wrote, e.g. `work/kọ/worksheet.md`.

**2. Decide.** Open that file. This is the part no script can do. Each
etymology has an `id:` line holding a proposed name, along with its
definitions and the words that would point at it:

```
## Etymology 5

    id: write

    kọ · verb · /kɔ/
    1. to write

    would be pointed at by:
      àkọtọ́  "orthography"  (id2)
      àròkọ  "essay"  (id3)
```

Change the `id:` lines you disagree with. Blank one to skip that etymology.
Everything that is not an `id:` line is reference material and is ignored, so
the names are the only thing you can get wrong. The words that would point at a
name are listed under it because you cannot judge a name without seeing what it
is for.

**3. Check.** Reads your worksheet back and prints exactly what it understood.
No network at all, so run it as often as you like.

```bash
.venv/bin/python etymid.py -page:kọ -check
```

**4. Look at where each name lands, then save.** `-simulate` does everything
except save:

```bash
.venv/bin/python etymid.py -page:kọ -simulate
```

Each insertion is shown under the heading it falls in, with the meanings that
heading covers, so you can check the name against the section rather than
against a line number:

```
  Etymology 2 — to build, construct / to learn, teach, instruct, acquire
        ===Etymology 2===
      + {{etymid|yo|teach}}
        Cognates include {{cog|its|kọ́}}, {{cog|ife|kɔ́}}
```

This replaces Pywikibot's own diff, which `userPut` renders with zero context
lines and no way to ask for more — it tells you a line was added at 65, not
which etymology that is. The view above is built from the same before-and-after
text that is about to be saved, so it still shows a misplaced name rather than
what we intended; and a name landing anywhere but directly after a heading
aborts the run.

Drop the flag when it looks right. It asks, and saves only if you agree:

```bash
.venv/bin/python etymid.py -page:kọ
```

One page per run. There is no batch mode and no generator over the queue.

| flag | |
|---|---|
| `-propose` | write the worksheet |
| `-regenerate` | refresh a worksheet, keeping the `id:` lines you edited |
| `-check` | read it back — no network |
| `-simulate` | show the diff, save nothing |
| *(none)* | show the diff, ask, save |

## What Pywikibot does, and what is ours

Pywikibot is a MediaWiki framework, not a dictionary one. `textlib` will hand
you the headings on a page, but nothing in it has heard of an etymology, and
nothing knows that a Yorùbá compound points at a meaning. So the split is:

**Pywikibot's** — login and session, tokens, the y/n prompt, the ten-second
throttle, edit-conflict detection, `-simulate`, the User-Agent, and
`mwparserfromhell` for parsing wikitext.

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
- The `-always` flag, which skips confirmation, is accepted only together with
  `-simulate`. It is set before you have seen anything, so on a real run it
  would defeat the gate the design rests on.

  The interactive **`a`** at the prompt does the same thing from that page
  onward, and is not blocked — it is Pywikibot's own control and suppressing it
  would be surprising. The difference is that you have seen at least one diff
  before choosing it. On a run of near-identical mechanical edits that already
  passed every gate, that is a reasonable thing to do; on anything you have not
  seen the shape of, it is not.

Consider a line on your Wiktionary user page saying you use this, linking the
repo. It is the first thing anyone checks.

## Checking the account

```bash
.venv/bin/python account.py
```

Prints the rights the account currently holds and anything AbuseFilter has
logged against it. Worth running before a session and after any refusal.

`autoconfirmed` is the one to watch. An AbuseFilter `blockautopromote` action
withholds it, which is what a run of edits at bot pace earned here — filter 205
("ac2") after eight saves ten seconds apart. It returns on its own when the
action expires; there is nothing to apply for, and editing by hand meanwhile
is fine.

## Records

`records/` holds one JSON and one `.diff` per edit that actually happened —
what was sent, and the diff the server recorded afterwards. Simulated runs and
refused saves do not write records. It is committed, so a reviewer asking what
this script has done can be shown every edit it has made.

## The second job: pointing the compounds back

`etymid.py` names the etymologies on one page. `pointers.py` puts the matching
`idN=` on the words built from them, which is what actually removes the guess:

```bash
.venv/bin/python pointers.py -parent:kọ -propose
.venv/bin/python pointers.py -parent:kọ -check
.venv/bin/python pointers.py -parent:kọ -simulate
.venv/bin/python pointers.py -parent:kọ
```

Same four stages, same worksheet. The difference is that it edits one page per
compound rather than one page in total, so Pywikibot asks about each in turn —
sixteen questions for `kọ`, not one.

**It reads the names off the parent page, never out of our data.** Our snapshot
proposes `build` for `kọ` etymology 2; the page says `teach`, because a person
read the evidence and chose better. Nine pointers would have been born pointing
at a name that does not exist. So `-propose` fetches the parent first and lists
the names that are actually there, and a worksheet naming anything else is
refused before a single page is opened.

What it will not do:

| | |
|---|---|
| **Point at a name that is not on the parent** | Checked before any page is opened, so a typo costs nothing. |
| **Overwrite a pointer that already exists** | `akẹ́kọ̀ọ́` already carries `id1=agent prefix`; that is left exactly as it is. |
| **Guess which template** | The template must match by name *and* have the expected component at the expected argument. Anything but exactly one match is refused. `id4` means positional argument 5, since the language code is argument 1. |
| **Touch another language** | The replacement happens inside the Yorùbá section and the page is rebuilt from its sections, so an identical template in another language's entry cannot be hit. |
| **Point at an unnamed etymology** | Compounds the queue could not tie to a section — `ayékòótọ́`, `kọjá` — come through with a blank `id:` and an explanation, rather than a guess. |
| **Point at a name the spelling cannot reach** | `ayékòótọ́` writes its component untoned as `kọ`, which reaches etymologies 5, 6 and 7. `negation particle` is etymology 3, spelled `kọ́` — a real name on the page, and still wrong here. Tone is usually why: a differently toned etymology is a different word. |

Records for this job hold one entry per compound, each with the diff the server
recorded for *that* page.

## Adding another job

`etymid.py` is one job. The next is the other half of it: putting `id2=write`
on each word built from `kọ`. It touches the parent page plus one page per
derived word, so it runs Pywikibot's generator over several pages instead of
one — the confirmation stays per page. The reusable parts are already in `lib/`:
`wikitext.py` for reading and changing a language's section, `align.py` for the
numbering check, `worksheet.py` for the file you edit, `data.py` for the build
output, `record.py` for the audit trail.
