# Writing etymology names to Wiktionary

This tool proposes edits, shows you the exact diff, and sends one page when you
confirm it. It is not automated contribution. There is no batch mode, no queue
runner, and no scheduled job. Every edit is one page you chose, with a diff you
read first.

Nothing here is served to the web. It does not run during `npm run build`.

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
and what would point at them; this tool turns that into edits.

## Setting up credentials

One minute, once. You need a Wiktionary account already.

1. Go to **https://en.wiktionary.org/wiki/Special:BotPasswords** (log in first).
2. Under *Create a new bot password*, enter the name **`yorubadict`** and press
   *Create*.
3. Tick exactly two grants:
   - **Basic rights**
   - **Edit existing pages**

   Nothing else. This tool never creates pages, never moves them, never deletes
   anything, and never edits outside the main namespace unless you point it at
   your own sandbox.
4. Leave the IP range and OAuth fields alone and press *Create*.
5. The next screen shows a username like `YourName@yorubadict` and a
   32-character password. **It is shown once.**

Then, in the repo:

```bash
cp tools/wiktionary/.credentials.example.json tools/wiktionary/.credentials.json
```

and put the two values in it:

```json
{
  "username": "YourName@yorubadict",
  "password": "abcdefghijklmnopqrstuvwxyz123456"
}
```

`.credentials.json` is gitignored. It is not your account password — it can be
revoked on its own from the same page, and it cannot log in to the website.

Only `submit` reads this file. `propose`, `check` and `preview` never
authenticate and never send anything.

## Using it

```
node tools/wiktionary/cli.mjs propose kọ    # write the worksheet
node tools/wiktionary/cli.mjs check   kọ    # read it back — no network at all
node tools/wiktionary/cli.mjs preview kọ    # show the exact diff — no write
node tools/wiktionary/cli.mjs submit  kọ    # send it, then record what happened
```

**`propose`** reads the page from Wiktionary and writes
`work/<page>/worksheet.md`. That file lists every etymology on the page with its
definitions, the words that would point at it, and a proposed name:

```
## Etymology 5

    id: write

    kọ · verb · /kɔ/
    1. to write

    would be pointed at by:
      àkọtọ́  "orthography"  (id2)
      àròkọ  "essay"  (id3)
```

Edit the `id:` lines. Everything else is reference material and is ignored.
A blank `id:` skips that etymology. The words that would point at a name are
shown under it because you cannot judge a name without seeing what it is for.

**`check`** parses the worksheet and prints back exactly what it understood. It
uses the wikitext `propose` already read, so it makes no requests.

**`preview`** re-reads the live page, applies your names, and prints the diff —
both its own and the one Wiktionary's `action=compare` produces. If those two
disagree it stops, because that means our idea of the change is wrong.

**`submit`** does all of that again against a fresh read, then asks you to type
the page name. Only then does it log in. Afterwards it fetches the diff the
server recorded and writes it to `records/`, which is committed.

### Rehearsing

```
node tools/wiktionary/cli.mjs submit kọ --target-page sandbox
```

sends the edit to `User:<you>/sandbox` instead. The sandbox page has to already
contain the section being edited — copy the Yorùbá section of the real page into
it first — because the tool refuses to create pages.

## What it will not do

The gates below stop the run and write nothing. They exist because each one has
already happened on a real page in the queue.

| | |
|---|---|
| **The section is not where you think** | `a` has no Yorùbá section: en.wiktionary split that entry into `a/languages M to Z`, transcluded. The tool asks the API which page holds the section and edits that one, or stops. |
| **The page moved since the worksheet** | Etymology numbering shifts under you. Regenerate. |
| **The numbering disagrees with our data** | Every etymology is checked against the definitions we hold for it. Measured across all 536 sections in the queue: no false stops, and 112 of 113 pages are caught when their etymologies are renumbered by one. The exception is `eye`, whose two etymologies are defined in almost the same words — nothing that compares definitions can tell those apart, and swapping their names would matter little. |
| **A name already exists** | Never written over — judged on live wikitext, not on our data, which can be a week old. `sun` etymology 2 is already named `to roast, burn`, which is not what our rules would generate; renaming it would break the four words that point at it. |
| **Two names would be the same** | Including against names already on the page. |
| **We have no data for an etymology** | `ga` has an Etymology 2 that Kaikki extracted nothing from. It is listed in the worksheet and left unnamed, so the gap is a decision rather than an oversight. |

## Etiquette

These are properties of `lib/mediawiki.mjs`, not options, so no call site can
forget them:

- A `User-Agent` naming the tool with a contact address, per Wikimedia policy.
- `maxlag=5`, and `Retry-After` honoured.
- `assert=user` on every write — a dropped session fails loudly instead of
  quietly editing as an IP address.
- **Never `bot=1`.** These are human-confirmed edits from a human account.
  en.wiktionary requires approval for the bot flag, and claiming it would
  misdescribe how the edit was made.
- One page per invocation.

It is worth putting a line on your Wiktionary user page saying you use this and
linking the repo. It is the first thing anyone checks.

## Adding another job

`cli.mjs` knows nothing about etymology names. A job supplies six functions —
`pages`, `collect`, `renderItems`, `parseItems`, `verify`, `apply` — and
`lib/jobs/etymid.mjs` is the worked example. `apply` is pure text in, text out,
so the part that decides what changes on someone else's page is testable without
a network.

The next job is the other half of this one: putting `id2=write` on each word
built from `kọ`. It touches the parent page plus one page per derived word, so
it returns more than one entry from `pages()` — which is why the driver already
loops.
