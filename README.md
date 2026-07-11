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

**Status:** live at `yorubadict.com`, deployed via Cloudflare Pages -
auto-deploys on every push to `main`.

---

Everything below this line is implementation detail — useful if you're
contributing, auditing data quality, or just curious how it works.

## Quick start

```
npm run serve     # serves public/ at http://localhost:8080, using the data already built
```

To rebuild from [`kaikki-yoruba`](https://github.com/SpeakNigeriaOrg/kaikki-yoruba)'s
latest published data:

```
npm run build
```

`npm run build` with no arguments (and `npm start`, which calls it) fetches
kaikki-yoruba's latest GitHub Release and rebuilds from that. Pass a local
file instead for offline dev or to pin to a specific snapshot:

```
npm run build -- data/sample.entries.json   # 16-entry smoke-test fixture
npm run build -- path/to/entries.json       # any other local snapshot
```

`build:custom` in `package.json` is not actually a different code path - it
runs the exact same command as `build`; the only way to target a local file
is the `-- path/to/entries.json` argument shown above.

You need Node 18+ (for its built-in `fetch`) — no npm dependencies are
installed; everything here is vanilla Node/JS/HTML/CSS on purpose, so
there's nothing that can go out of date except the one real dependency this
now has: network access to GitHub, to fetch kaikki-yoruba's latest release.

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

## The pipeline: kaikki-yoruba's artifact → browser-ready JSON

```
kaikki-yoruba's entries.json (already-normalized entries, incl. resolved
  etymologyMorphemes/usedInCompounds - see that repo's README)
  -> build/lib/loadEntries.mjs    Stage 1: load a local file, or fetch
                                    kaikki-yoruba's latest GitHub Release
  -> build/lib/relationships.mjs  Stage 2: alias resolution + reciprocal
                                    synthesis for derivedTerms/relatedTerms/
                                    synonyms/antonyms/descendants (the *other*
                                    relation types - not etymology morphemes,
                                    which arrive already resolved)
  -> build/lib/validator.mjs      Stage 3: diagnostic report (never mutates data)
  -> build/lib/search-index.mjs   Stage 4: sorted Yorùbá tiers + English BM25 index
  -> public/data/*.json           Static browser assets
```

Parsing raw Kaikki JSONL and normalizing it into canonical entries (canonical-
form inference, garbled-table detection, per-field extraction, and etymology-
morpheme extraction/resolution) used to happen here - that's now
kaikki-yoruba's job, shared with `yoruba_student_dict_platform`. See its
README for what it owns and why.

`build/normalize.mjs` orchestrates all four stages. Run against
kaikki-yoruba's current published data (6,272 entries - Kaikki assigns the
same sense id to two structurally different records for one rare spelling,
`gọlọmiṣọ`, so one silently overwrites the other; a known, upstream data
quirk, not a bug in this pipeline), it produces:

- **777 entries** with an inferred rather than explicitly-tagged canonical
  spelling (see below).
- **374 entries** with no IPA in the source data.
- **2,760 unresolved relationship references** — a derived/related/synonym
  points to a spelling that isn't in this extract.
- **1,579 spellings** shared by more than one homograph once tone marks and
  underdots are stripped (checked across each entry's headword, canonical
  form, *and* alt forms - not just its canonical form alone).
- **1 circular derivation chain.**

All of these are visible live in the app via the "Data quality" button, not
just in this file — nothing about data quality is hidden from users.

### Canonical forms and homographs

Kaikki records don't always tag which form of a word is canonical (this is
common for single-letter "character" entries and some function words).
kaikki-yoruba's normalizer prefers an explicit `canonical` tag when Kaikki
provides one (confidence `1.0`); otherwise it falls back to the raw
headword itself (confidence `0.5`, logged to this repo's own validation
report). The original source value is always kept alongside the inferred
one — normalization supplements the data, it never discards anything.

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
normalizer (`extractRelationList` in kaikki-yoruba's `src/lib/normalizer.mjs`
- normalization itself now happens there, see "The pipeline" above) detects
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
etymology templates already capture this — extraction and resolution both
happen upstream now, in kaikki-yoruba's `src/lib/normalizer.mjs`
(`extractEtymologyMorphemes`, reading `record.etymology_templates` for
template names that decompose a word into same-language morphemes:
`compound`/`com`/`compound+`/`reduplication`/`blend`, plus `af`/`affix`/
`prefix` — these three were initially excluded on the wrong assumption they
only ever mark a single bound prefix; real data disproves that, with many
`af`/`affix` templates mixing a bound prefix with several free-standing real
words, `àmọ̀tẹ́kùn` being one) and `src/lib/morphemeResolution.mjs` (see that
repo's README for the full rationale). Each morpheme is tagged `bound` (a
grammatical prefix/suffix like `à-`, never an independent word — displayed
as plain unlinked text with its gloss) or free (a real word, potentially
already in this dictionary — filtering is per-morpheme, not per-template, so
one bound prefix in a template no longer discards the rest of that
template's genuine words). This entry's `etymologyMorphemes` field already
arrives with each free morpheme's `entryIds` resolved by the time it reaches
this repo - nothing left to compute here, just render.

Two refinements went into that upstream resolution:

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

The reverse direction is synthesized too (also upstream, in kaikki-yoruba):
if one entry's etymology decomposes to include another as a free-standing
component, the component's own `usedInCompounds` field lists every word
built from it, rendered here as a "Used in" section — derived purely from
etymology templates, so (unlike the `derived`/`related`/etc. synthesis
below, which *is* still this repo's own job) it doesn't depend on
Wiktionary's editors having also filled in a "derived terms" list on the
component's own page.

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

## Staying fresh: this build is not automated (kaikki-yoruba's is)

There is no scheduled job in *this* repo pulling new data - but there is one
in kaikki-yoruba, which fetches a current Kaikki extract and republishes a
new release weekly. Refreshing here is a two-step process:

1. Wait for (or manually trigger) kaikki-yoruba's own scheduled refresh.
2. `npm run build` (fetches its latest release automatically), then commit
   and push the regenerated `public/data/*.json` to `main` - Cloudflare
   Pages auto-deploys from there, no separate deploy step needed.

This is simpler than the old manual-download step, but the "how stale is
the shipped data" gap is now partly closed too: `npm run build`'s console
output prints the source release's tag and date, and the same two fields
(`kaikkiSourceDate`, `kaikkiReleaseTag`) are written into
`validation-report.json` and surfaced in the "Data quality" panel - so
there's a visible "data last refreshed" date now, at least when building
from the live release path (a local-file build has no such date, since
there's no release to attribute it to).

`data/dictionary-Yoruba.jsonl` and `data/sample.jsonl` (raw Kaikki JSONL)
are no longer valid input to this repo's own build - kaikki-yoruba now owns
parsing that format. They're kept as reference/legacy fixtures (kaikki-yoruba's
own test suite reads the real one as a convenience "sibling checkout"
fixture). `data/sample.entries.json` (16 entries, already in the
already-normalized shape this build now expects) is the real smoke-test
fixture going forward - generated by running kaikki-yoruba's own
`npm run build:sample` and copying its output here.

## Deployment: Cloudflare Pages

Live at `yorubadict.com`. There's no backend, no server-side routing, no
environment variables, and no secrets. Because routing is hash-based, the
URL fragment never reaches the server, so deployment is just "serve
`public/` as static files" — no `_redirects` rewrite rule needed, unlike a
typical single-page app using `history.pushState`.

**Currently configured**: Cloudflare Pages' build command is none, output
directory `public/` - it auto-deploys on every push to `main`, serving
exactly whatever `public/data/*.json` is committed at that point. This
means a fresh `npm run build` + commit + push is still a manual step (see
"Staying fresh" above) - pushing is what triggers the deploy, but nothing
currently triggers *that* push on its own.

**Alternative not currently used**: set the build command to `npm run build`
so Cloudflare regenerates `public/data` on every deploy by fetching
kaikki-yoruba's latest release directly, instead of relying on a committed
snapshot. This would need the build environment to have outbound network
access to GitHub (true of Cloudflare Pages' build environment) - a real new
dependency the old, pre-retargeting build never had (it only ever read a
locally committed file).

If you ever want path-based URLs instead of hash routes, that mainly means
adding a rewrite rule on your host (e.g. `/* /index.html 200` on Cloudflare
Pages) and swapping `location.hash` for `history.pushState` in `app.js` —
the entry-rendering code itself doesn't change.

## Project layout

```
data/
  dictionary-Yoruba.jsonl        legacy/reference: raw Kaikki extract (no
                                    longer a valid build input - see kaikki-yoruba)
  sample.jsonl                   legacy/reference: raw JSONL, same reason
  sample.entries.json             16-entry smoke-test fixture, already in
                                    kaikki-yoruba's normalized shape
build/
  normalize.mjs                  pipeline orchestrator (entry point)
  lib/
    orthography.mjs              tone/underdot stripping, spellingsForEntry
    loadEntries.mjs                Stage 1 (load a local file, or fetch
                                     kaikki-yoruba's latest release)
    relationships.mjs             Stage 2 (alias resolution + reciprocal
                                     synthesis for the relation types this
                                     repo still owns)
    validator.mjs                  Stage 3 (diagnostic report)
    search-index.mjs               Stage 4 (Yorùbá tiers + English BM25 index)
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
