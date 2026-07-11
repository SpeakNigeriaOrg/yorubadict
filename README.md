# Ọ̀rọ̀ | The Yoruba Dictionary

A free, fast Yorùbá ↔ English dictionary, built from Wiktionary's data but
designed the way a dictionary should work. It's a project of
[Speak Nigeria](https://speaknigeria.org), the nonprofit behind free courses
and resources for Nigerian heritage languages.

## Why this exists

Wiktionary's raw data is one of the best resources anywhere for learning
Yorùbá. That's not really about vocabulary — it's because Yorùbá habitually
builds larger words out of smaller building-block words, and Wiktionary's
etymology breakdowns capture that better than any other resource online.
Understanding those building blocks isn't historical trivia; Yorùbá is a
living language, and it's one of the things students in Speak Nigeria's own
classes love most about it. It's fundamental to real fluency.

The Wiktionary website itself, though, is genuinely hard to use for this. To
find a word you have to type it a very specific way — no tone marks, but
with underdots, and no other combination works. Any search surfaces results
in every language Wiktionary covers, not just Yorùbá. And because it's
crowdsourced, its etymology links are inconsistent — sometimes a parent word
documents the words derived from it, sometimes only the derived word
documents where it came from, sometimes both, sometimes neither, entirely
depending on which page a contributor happened to edit. Tracing a family of
related words means guessing which page has the link and searching for it by
hand. Most dictionaries also make you
pick a direction — Yorùbá-to-English or English-to-Yorùbá — instead of
letting you search both at once.

Ọ̀rọ̀ starts from the same underlying data (via [Kaikki](https://kaikki.org),
which does its own cleanup pass on Wiktionary's raw wikitext) and fixes the
rest:

- **Search it the way you'd write it.** With or without tone marks, with or
  without underdots — every spelling of a Yorùbá word finds the same entry.
- **Search both directions at once**, or lock to either Yorùbá-only or
  English-only.
- **Links that go both ways.** Whichever side of a relationship Wiktionary
  happens to document — parent or derived word — we automatically synthesize
  the missing reverse link, turning its inconsistent, crowdsourced etymology
  links into a real, two-way, navigable path through the language.
- **Everything runs in your browser.** No search requests leave your device
  after the page loads.

See the in-app [About page](public/index.html) (`#/about`) for the
user-facing version of this pitch.

**Status:** pre-launch. Currently a local/static build; the plan is to
deploy it at `yorubadict.com`.

---

Everything below this line is implementation detail — useful if you're
contributing, auditing data quality, or just curious how it works.

## Quick start

```
npm run serve     # serves public/ at http://localhost:8080, using the data already built
```

To rebuild the real dictionary from the committed Kaikki extract:

```
npm run build -- data/dictionary-Yoruba.jsonl
```

`npm run build` with no arguments (and `npm start`, which calls it) defaults
to `data/dictionary-Yoruba.jsonl` — the real dictionary. Pass
`-- data/sample.jsonl` explicitly if you want the 16-record smoke-test
fixture instead. (This wasn't always true: earlier, the no-argument default
was the sample file, and it was easy to silently overwrite
`public/data/*.json` with 16 entries by running a bare `npm start`. The
default was flipped for exactly that reason.) `build:custom` in
`package.json` is not actually a different code path — it runs the exact
same command as `build`; the only way to target a different file is the
`-- path/to/file.jsonl` argument shown above.

You need Node 18+ — no dependencies are installed; everything here is
vanilla Node/JS/HTML/CSS on purpose, so there's nothing to `npm install` and
nothing that can go out of date.

**Why a dev server at all, if it's static?** Browsers block `fetch()`
against `file://` URLs (CORS), so `public/` needs to be served over
`http://` to test locally. `server/dev-server.mjs` is a ~50-line
zero-dependency static file server that exists *only* for this — it is not
part of the deployed app and does no server-side logic beyond "read the
file, return it."

## What actually ships to the browser

There is no backend and no database. On first load, `public/app.js` fetches
three static JSON files and does everything else — search, ranking,
rendering, routing — locally:

| File | Current size | Contents |
|---|---|---|
| `data/entries.json` | ~6.6 MB | every entry, keyed by id, for O(1) lookup |
| `data/search-index.json` | ~2.6 MB | Yorùbá tier indices + English inverted index |
| `data/validation-report.json` | ~450 KB | data-quality diagnostics (below) |

That's roughly 9.6 MB fetched up front for ~6,270 entries. This is a
deliberate tradeoff for simplicity and a genuinely offline-after-load
experience, but it hasn't been tested at meaningfully larger scale, and one
thing is an outright inefficiency worth fixing: `validation-report.json` is
fetched on *every* visit just so the "Data quality" panel can render if
someone clicks it — it should be lazy-loaded on demand instead, not on boot.

## The pipeline: Kaikki JSONL → browser-ready JSON

```
Kaikki JSONL (data/dictionary-Yoruba.jsonl)
  -> build/lib/parser.mjs         Stage 1: parse JSONL, collect line-level errors
  -> build/lib/normalizer.mjs     Stage 2: canonical form inference, per-field
                                    extraction, garbled-table detection
  -> build/lib/relationships.mjs  Stage 3: alias resolution + reciprocal
                                    relationship synthesis, with provenance
  -> build/lib/validator.mjs      Stage 4: diagnostic report (never mutates data)
  -> build/lib/search-index.mjs   Stage 5: sorted Yorùbá tiers + English BM25 index
  -> public/data/*.json           Static browser assets
```

`build/normalize.mjs` orchestrates all five stages. Run against the current
`data/dictionary-Yoruba.jsonl` (6,273 raw Kaikki records, already filtered
to Yorùbá), it produces:

- **0 parse errors** — the extract is clean JSONL.
- **778 entries** with an inferred rather than explicitly-tagged canonical
  spelling (see below).
- **374 entries** with no IPA in the source data.
- **2,760 unresolved relationship references** — a derived/related/synonym
  points to a spelling that isn't in this extract.
- **724 spellings** shared by more than one homograph once tone marks and
  underdots are stripped.
- **1 circular derivation chain.**

All of these are visible live in the app via the "Data quality" button, not
just in this file — nothing about data quality is hidden from users.

### Canonical forms and homographs

Kaikki records don't always tag which form of a word is canonical (this is
common for single-letter "character" entries and some function words). The
normalizer prefers an explicit `canonical` tag when Kaikki provides one
(confidence `1.0`); otherwise it falls back to the raw headword itself
(confidence `0.5`, and logged to the validation report). The original source
value is always kept alongside the inferred one — normalization supplements
the data, it never discards anything.

The fallback case shows up in the UI as a "no canonical tag" badge on the
entry header and a "No explicit canonical tag" row in the Data Quality
panel — deliberately not called "inferred spelling," since in most cases
nothing was actually guessed: Wiktionary simply never tagged an alternative,
so there was nothing to disambiguate (falling back to the headword is the
only possible answer, not a guess among competing options).

Etymology is handled the same way: we don't re-derive or re-parse it. Kaikki
already splits a word into separate records when Wiktionary documents
multiple, unrelated etymologies for the same spelling (via `etymology_number`
— e.g. one `ilé` meaning "house" and a different, unrelated `ilé` from a
different root). We preserve that split by using Kaikki's own per-sense id as
our entry id, so homographs stay distinct, independently searchable entries
with their own etymology text rather than getting merged into one confusing
entry.

### Detecting broken tables and linking out to Wiktionary

Some Yorùbá Wiktionary entries carry complex regional-dialect comparison
tables. Kaikki's wikitext-to-JSON conversion doesn't always survive those
tables intact — they can come through as mangled text (a stray mojibake
marker character), an oddly long "word" (anything over 50 characters is
almost never an actual term), or a full sentence (anything containing `. `).

Rather than render garbage or silently drop the whole relationship, the
normalizer (`extractRelationList` in `build/lib/normalizer.mjs`) detects
these cases and replaces them with a single fallback pill that links directly
to that word's own Yorùbá section on Wiktionary ("View complex dialect data
on Wiktionary"). Nothing is lost — it's just deferred to the source, which
can render its own tables correctly.

### Relationship synthesis and its honest limits

`derived`/`related`/`synonyms`/`antonyms`/`descendants` are resolved against
an alias index (spelling → entry ids) built from every entry's headword,
canonical form, and alternative forms. Unresolved references are kept —
tagged `resolved: false` and logged to the validation report — rather than
silently dropped; the UI renders them as dashed, non-clickable pills instead
of broken links.

Because Wiktionary is crowdsourced, which side of a relationship gets
documented is inconsistent — sometimes the parent lists the derived word,
sometimes only the derived word documents its own origin, sometimes both
sides already link each other, sometimes neither does structurally and the
connection only exists in freeform etymology prose. The synthesis step
(`build/lib/relationships.mjs`) is direction-agnostic: it walks every
entry's own declared relations exactly as written, without assuming which
side is "the parent," and adds the missing reciprocal onto whichever entry
doesn't already have it — so it doesn't matter which page happened to carry
the structured link, the connection ends up navigable from both entries
either way. These synthesized links are visually marked with a small ↺ and a
tooltip explaining they were inferred, not stated by Wiktionary, so the
data's real provenance stays legible.

The one thing this can't do: if a relationship exists only in unstructured
etymology prose, with no `derived`/`related`/`synonyms`/`antonyms` list on
*either* entry, we don't mine the prose text for it, so no link gets
synthesized in either direction. That's a real limit of the current
pipeline, not a design choice.

### Etymology decomposition: Component words

Yorùbá habitually builds larger words out of smaller ones — `àmọ̀tẹ́kùn`
("leopard") decomposes to `à-` (nominalizing prefix) + `mọ̀` ("to know") +
`tó` ("that") + `tó` ("is equal to, similar to") + `ẹkùn` ("leopard"),
literally "the one that we know is similar to a leopard." Kaikki's own
etymology templates already capture this — `normalizer.mjs`'s
`extractEtymologyMorphemes` reads `record.etymology_templates` for template
names that decompose a word into same-language morphemes
(`compound`/`com`/`compound+`/`reduplication`/`blend`, plus `af`/`affix`/
`prefix` — these three were initially excluded on the wrong assumption they
only ever mark a single bound prefix; real data disproves that, with many
`af`/`affix` templates mixing a bound prefix with several free-standing real
words, `àmọ̀tẹ́kùn` being one). Each morpheme is tagged `bound` (a
grammatical prefix/suffix like `à-`, never an independent word — displayed
as plain unlinked text with its gloss) or free (a real word, potentially
already in this dictionary — filtering is per-morpheme, not per-template, so
one bound prefix in a template no longer discards the rest of that
template's genuine words).

Free morphemes are resolved against the same alias index described above,
with two refinements specific to this feature:

- **Tonal-exact match always wins.** A morpheme's spelling frequently
  coincides with another entry's raw, untoned Wiktionary headword (the page
  titled "mọ" is also indexed under that spelling even though its real
  canonical form is "mọ̀" or "mọ́") — an entry whose *own* canonical spelling
  exactly matches the morpheme always wins over one that only matched via
  that looser headword/alt-form alias.
- **Gloss-overlap tiebreak among true homographs.** When several entries
  share the exact same spelling and tone (e.g. `gbà` has real senses "to
  rescue"/"to accept"/"to combust"), the one whose own sense glosses share
  the most words with the morpheme's own gloss is preferred — a `gbà`
  morpheme glossed "accept" prefers the "to accept" sense.

Neither refinement is exhaustive: cross-language mismatches in Wiktionary's
own template data (a real, if rare, case: one word's etymology glosses a
morpheme "I" using a spelling that's actually a different, unrelated word)
can't be fixed algorithmically, and gloss-overlap is a lexical heuristic, not
true semantic matching. For exactly this reason, clicking a resolved
"Component words" pill both navigates to the ranked-best entry *and*
populates the search box with that spelling, so every homograph is one look
away if the default guess is wrong.

The reverse direction is synthesized too: if one entry's etymology decomposes
to include another as a free-standing component, the component's own page
gets a "Used in" section listing every word built from it — derived purely
from etymology templates, so (unlike the `derived`/`related`/etc. synthesis
above) it doesn't depend on Wiktionary's editors having also filled in a
"derived terms" list on the component's own page.

### Orthographic normalization

Yorùbá orthography has three independent dimensions, and `build/lib/orthography.mjs`
generates all three for every headword (worked example: `ilẹ̀ → ilẹ → ile`):

- **exact** — untouched, as written
- **tone-insensitive** — tone marks (grave/acute/macron) stripped via NFD
  decomposition, underdots preserved
- **orthography-insensitive** — tone marks *and* underdots stripped,
  lowercased

The same normalization functions are duplicated (deliberately, not imported)
in `public/app.js` — the browser needs to apply the exact same rules to the
user's query as the build pipeline applied to the headwords, and keeping
them as small, dependency-free functions in both places avoids adding a
frontend build step just to share code.

### Search ranking

Priority order (`public/app.js`, `search()`): exact Yorùbá match →
tone-insensitive → orthography-insensitive → prefix → English BM25, deduped
by id, first-seen tier wins. This is what makes "search both directions at
once" work without a special-cased merge step — it's just running the
Yorùbá tiers and the English index and keeping first-seen order.

Every Yorùbá tier indexes each entry's alt forms as well as its canonical
spelling (`build/lib/search-index.mjs`'s `searchableForms`) — an alt form is
real, displayed data (e.g. `iná` "fire" lists `uná` as an alternative form),
and without this it was findable on the page but not by searching for it.

The English index deliberately does *not* apply stopword-filtering to
glosses (only to example-sentence translations, genuine prose where
"the"/"and" are just connective noise). A gloss is a short, curated
definition, and for a real Yorùbá conjunction or demonstrative the entire
correct gloss can legitimately just be "that"/"this"/"and"/"or" — filtering
those out as noise words meant the word was defined correctly on the page
but could never be found by searching for its own definition.

### Entry IDs and routing

Each entry's id is its first sense's Kaikki-assigned sense id (e.g.
`en-fa-yo-verb-OFVmd8R8`) — a stable, source-derived identifier that doesn't
depend on our own spelling-normalization decisions, and stays stable across
rebuilds even if a headword's canonical spelling changes.

Routing is hash-based (`#/entry/<id>`, `#/about`) rather than path-based.
Two reasons: spellings aren't unique — many homographs share a spelling —
so an id-based route is more correct regardless of URL style; and hash
routes need zero server-side rewrite configuration on any static host,
keeping the "fully static, zero backend" property airtight. Deep links,
bookmarks, and the back button all work.

## Staying fresh: the build is *not* automated

There is no scheduled job pulling new data. `data/dictionary-Yoruba.jsonl` is
a manually-downloaded snapshot of Kaikki's Yorùbá extract, committed as-is.
Refreshing it is a manual, three-step process:

1. Download a current extract from [kaikki.org](https://kaikki.org).
2. `npm run build -- path/to/new-extract.jsonl`
3. Commit and redeploy the regenerated `public/data/*.json`.

There's currently no automated way to know how stale the shipped data is
short of downloading a fresh extract and diffing entry counts. A scheduled
rebuild (a periodic GitHub Action, say) plus a visible "data last refreshed"
date is the obvious next step, but neither exists yet.

`data/sample.jsonl` (16 records) is a separate, tiny fixture kept around for
fast pipeline smoke-testing — it's not related to the real dictionary build.

## Deployment: built for Cloudflare Pages (or any static host)

There's no backend, no server-side routing, no environment variables, and no
secrets. Because routing is hash-based, the URL fragment never reaches the
server, so deployment is just "serve `public/` as static files" — no
`_redirects` rewrite rule needed, unlike a typical single-page app using
`history.pushState`.

Two ways to run this in CI:

- **Commit the generated `public/data/*.json`** (what this repo currently
  does) and set the host's build command to none, output directory `public/`.
  What's in the repo is exactly what ships.
- **Or** set the build command to `npm run build` so the host regenerates
  `public/data` on every deploy from whatever `data/*.jsonl` is committed.

If you ever want path-based URLs instead of hash routes, that mainly means
adding a rewrite rule on your host (e.g. `/* /index.html 200` on Cloudflare
Pages) and swapping `location.hash` for `history.pushState` in `app.js` —
the entry-rendering code itself doesn't change.

## Project layout

```
data/
  dictionary-Yoruba.jsonl        the real, committed Kaikki Yorùbá extract (6,273 records)
  sample.jsonl                   16-record fixture for pipeline smoke-testing
build/
  normalize.mjs                  pipeline orchestrator (entry point)
  lib/
    orthography.mjs              tone/underdot stripping
    parser.mjs                   Stage 1
    normalizer.mjs                Stage 2 (canonical forms, garbled-table detection)
    relationships.mjs             Stage 3 (alias resolution, reciprocal synthesis)
    validator.mjs                  Stage 4 (diagnostic report)
    search-index.mjs               Stage 5 (Yorùbá tiers + English BM25 index)
  validation-report.json          (generated, pretty-printed copy for local inspection)
public/                            <- deploy this directory as-is
  index.html
  style.css
  _tokens.css                     shared design tokens (also used by speaknigeria.org)
  favicon.svg
  app.js
  data/                            (generated: entries.json, search-index.json,
                                     validation-report.json)
server/
  dev-server.mjs                  local-testing-only static file server
```
