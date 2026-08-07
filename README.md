# Sọ̀rọ̀ Sókè — The People’s Yorùbá Dictionary

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

Sọ̀rọ̀ Sókè starts from the same underlying data (via [Kaikki](https://kaikki.org),
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
| `data/entries.json` | ~10.5 MB | every entry, keyed by id, for O(1) lookup |
| `data/search-index.json` | ~3.6 MB | Yorùbá tier indices + English inverted index |
| `data/validation-report.json` | ~580 KB | data-quality work queue (below), **not fetched on boot** |
| `data/building-blocks.json` | ~19 KB | the Key Building Block Words list, **not fetched on boot** |

That's roughly 14 MB fetched up front for ~6,270 entries. This is a
deliberate tradeoff for simplicity and a genuinely offline-after-load
experience, but it hasn't been tested at meaningfully larger scale. Neither
the quality report nor the building-block list is part of it: nothing on the
reading path needs either, so each is fetched the first time someone opens the
page that shows it.

## The pages we write ourselves

Everything else here comes from Wiktionary. These five don't, and they live as
render functions in `public/app.js` dispatched from a `STATIC_ROUTES` table:

| Route | Page |
|---|---|
| `#/about` | About the Dictionary — what this is and where the data comes from |
| `#/speak-nigeria` | About Speak Nigeria — the nonprofit behind it |
| `#/learners` | For Learners — learn roots, then read what they build |
| `#/teachers` | For Teachers — curriculum sequencing, and *when* to explain a compound |
| `#/building-blocks` | Key Building Block Words — **generated**, see below |
| `#/contribute` | A Wiktionary work queue — **generated**, see below |

They render from markup already in `app.js`, so they paint on first load
without the dictionary — `boot()` calls `handleRoute()` before fetching it for
exactly this reason. Any new page must keep that property, and must set its own
`document.title` and call `onEntryRendered()`.

**Voice:** simple sentences, concrete vocabulary, and an example rather than a
description of one. Every claim about how Yorùbá builds words is followed by a
real word linked to its entry. Nothing that reads like an advert.

All six nav entries live in one dropdown at every width. It used to be an
inline row on desktop and a dropdown only below 700px, which worked with two
items; the note by the narrow-viewport header block records that the wordmark
plus *two* buttons already left the search field 30px of readable text at
800px. Making the dropdown universal also gave the search field its width back
on desktop.

### Contribute is a work queue, and it never edits anything

`build/lib/wiktionary-tasks.mjs` turns "we can't tell which meaning this came
from" into specific Wiktionary edits with the text to add. **Nothing in it ever
writes to Wiktionary** — no API, no bot account, no auto-submission, now or
later. A wrong edit applied at scale by a machine damages the shared resource
this dictionary is built on.

The unit of work is one **page**, not one pass, because the halves have to be
applied together: anchoring `pa`'s seven sections is useless until compounds
point at those anchors, and pointing at `kill` is wrong if the editor typed
`killing`. Pages are ordered by references unlocked — 20 pages carry 415 of the
664, and 8 of those 20 are on the building-block list, so the first hour of
editing is worth far more than the tenth.

References are tiered by how safely they can be inferred:

| tier | count | |
|---|---|---|
| A "suggested" | 386 | the compound's own recorded meaning matches exactly one section — the `idN=` is filled in |
| B1/B2 "you decide" | 222 | a meaning is given but doesn't single out a section |
| C "needs research" | 56 | no meaning recorded at all |

Tier A is the tier a reviewer trusts instead of re-deriving, so the match is
deliberately strict and two failures shaped it. A word-overlap rule put `ita`'s
"to be spicy" against "to shoot, fire (from a weapon)" on one incidental word.
A raw substring test matched `Mọgbà`'s component meaning `"I"` against `mọ`'s
"alternative form of mu", because *alternative* contains an i — fixed with
word-boundary matching rather than a length floor, since a floor would also
have killed "war" against "war, battle". Pointer definitions are excluded from
matching entirely.

Because an anchor names a whole section, each proposal shows everything that
section covers. `ta` etymology 6 runs "to shoot" / "to sting" / "to be spicy" /
"to kick" / "to pick" — a reviewer shown only the first would reject a correct
proposal for a component meaning "spicy".

The queue clears itself: once an edit lands and the data refreshes, that page
stops being emitted, the same way the `root-meaning-dropped` check did.

### Key Building Block Words is generated

`build/lib/building-blocks.mjs` picks the 25 roots that build the most other
words, each with five examples of what they build. Two decisions in it are
worth knowing about, both settled by measurement:

**A building block is a meaning, not a spelling.** `gba` is not a word; `gbá`
("to hit") and `gbà` ("to accept") are different words that build different
families. So roots are keyed on entry ids via `etymologyMorphemes[].chosenEntryId`, the
one field that names a single meaning — `usedInCompounds` and `possiblyUsedIn`
are the display split described under "Used in" below, and counting the second
of them would credit `gbà` "to rescue" for words built from `gbà` "to accept".
`ní` correctly appears twice in the list, as the verb and as the preposition.

**Choosing the examples needs outside frequency data.** Ranking the roots
themselves does not — by raw count or by weighted prominence, 24 of the same 25
words come back. But every signal available inside our own corpus (sense count,
usage examples, IPA, dialect coverage) measures *editor attention*, which
follows cultural notability rather than commonness. Ranked that way the examples
for `ọmọ` ("child") are `agẹmọ` (chameleon), `ọmọdó` (pestle) and `Agẹmọ` (an
orisha). With `data/frequency/` they are `ọmọdé` (child), `ọmọnìyàn` (humanity)
and `mọ̀lẹ́bí` (extended family). See `data/frequency/README.md` for provenance
and the licence that has to be honoured.

Given names, definitions longer than six words, pointer definitions
("archaic spelling of…") and absurdly long headwords are all excluded — and
`assertBuildingBlocksAreUsable` fails the build if any slip through, rather than
letting a bad list reach the page. `data/building-blocks.overrides.json` is an
optional hand-edit layer (exclude, pin, or replace a block's examples); it does
not exist yet, and the list is fully programmatic until it does.

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
- **2,111 unresolved relationship references** — a derived/related/synonym
  points to a spelling that isn't in this extract. (Was 2,762 before the
  flattened dialect tables stopped being counted as relations, and 2,363
  before descendants stopped being matched against the Yorùbá index — every
  descendant in the corpus carries a non-Yorùbá `langCode`, so resolving them
  here could only ever produce a false positive, and it did: English *dodo*
  was resolving to eight Yorùbá *dòdò* homographs.)

  These are triaged rather than listed flat, because "2,111 problems" isn't
  something anyone can start on. **189 are diacritic typos** where the
  intended target is already known (a reference to `ẹ̀fá` where the entry is
  `ẹfa`); 679 are multi-word phrases that were never going to have entries;
  the remaining **1,046 are the real content gap** — words Wiktionary
  genuinely doesn't have yet.
- **6,426 dialect terms** across 138 entries, imported from Wiktionary's own
  dialect-synonym modules — see "Dialect tables" below.
- **1,579 spellings** shared by more than one homograph once tone marks and
  underdots are stripped (checked across each entry's headword, canonical
  form, *and* alt forms - not just its canonical form alone).
- **1 circular derivation chain.**

All of these are visible live in the app via the "Data quality" button, not
just in this file — nothing about data quality is hidden from users.

The report is built as a **work queue, not a census**, because a total is not
something anyone can act on. Every issue carries what it would actually take
to fix — `easy` (the right answer is already known), `mechanical` (no judgment,
just volume), `expertise` (needs someone who knows Yorùbá), `info` (not a
defect) — whether it's ours to fix or Wiktionary's, a one-line statement of
why it matters, a concrete instruction, and a deep link to the section to edit.
Issues sort easiest-first, so the 189 items where we already know the intended
word come before the 1,046 that need new entries written. Two of the current
items are ours: descendants being matched against the Yorùbá index (fixed), and
kaikki-yoruba reading `t1`/`t2` for reduplication glosses when every
`{{reduplication}}` template in the corpus passes a bare `t` — silently
dropping 96 morpheme glosses in precisely the word class where several
identically-spelled roots compete.

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

Keeping them apart is the right call for Yorùbá — `dá` "to create" and `dá`
"to hit" are no more one entry than English *bank* and *bank* — but it created
a problem of its own: **1,161 entries (18.5%) share an exact, tone-marked
spelling with another, and nothing on the page said so.** You could read one
of eleven `dá` entries and never learn the other ten existed. Every such entry
now carries an **"Other entries with this spelling"** section directly after
its definitions, listing each sibling with its part of speech, etymology
number, and first gloss — enough to tell them apart at a glance.

Grouping is on `forms.exact`, never on a normalized form. Identical spelling
*and* identical diacritics is one written word carrying several senses;
different diacritics is a different word. Putting `gbà` and `gbá` in one list
would teach the opposite of how the language works, so tone variants are
deliberately excluded from this section.

### Dialect tables: read from source, not salvaged

Some Yorùbá Wiktionary entries carry regional-dialect comparison tables.
Kaikki renders those tables and flattens them to text, emitting every text run
— caption, footnotes, body cells — as a separate "synonym", with cells glued
together by a separator. Measured on the corpus: of the 57 entries that had any
synonyms, **55 were table dumps**, and exactly 2 had a real synonym.

That text can't be repaired, because the separator is an arbitrary Wiktionary
page title substituted by an expansion-index desync, and it changes every
build — `慵` and `SPACE SHUTTLE` in one build, `礀` and `啀` in the next, also
`UNITED ARAB EMIRATES`, `IPSE DIXIT`, `VIFÖ`, `FA`, `T`. Some are Han
ideographs and some are plain ASCII, so no character rule catches them. An
earlier version of this project tried `length > 50` and `contains ". "`
heuristics; on the real corpus they missed 277 table items while deleting real
content (bibliography entries, example sentences).

So the data is read from where it isn't broken. `{{dialect synonyms|yo|inú}}`
transcludes `Module:dialect synonyms/yo/inú`, a Lua table of region → terms;
140 such pages exist, and the variety hierarchy lives in
`Module:dialect synonyms/yo`. kaikki-yoruba fetches them
(`src/fetch-dialect-synonyms.mjs`, snapshot committed for reproducible builds),
parses them (`src/lib/dialectSynonyms.mjs`), and attaches a structured
`dialectSynonyms` field — 6,426 dialect terms across 138 entries. Recognising
the flattened tables then needs no guesswork either: a relation list that
contains one of the table's own marker strings (its caption, its footnote, a
variety-group header — all read from that same metadata module) *is* that
table's text, and is dropped whole (`src/lib/relationDebris.mjs`).

Dialect synonyms are kept deliberately separate from alternative forms. An alt
form claims two spellings are the same word and so belongs in the alias index;
a dialect synonym claims a variety uses a *different* word, and putting those in
the alias index would make a `derivedTerms` reference to "ulé" resolve to "ilé"
and fabricate links. Instead they get their own lowest-priority search tier
(searching `ababuton` finds **ọpọlọ**, labelled `Oǹdó`) and, where a dialect
form has an entry of its own, a synthesized `dialectOf` back-link on it.

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

#### Which sense did it come from? The one exact answer

Wiktionary can state this precisely, and it is the only non-inferential signal
in the whole pipeline. `{{etymid|yo|kill}}` at the top of an etymology section
names it; a compound then points at that name with `id1=kill` on
`{{compound}}`/`{{af}}`. Someone who knows the word wrote both halves down.

An anchor therefore **wins outright** over every heuristic below it —
`chosenBy: 'anchor'` is the top tier in `annotateMorphemeConfidence`, above
gloss matching and above the fall-through, and it suppresses the ambiguity
badge honestly rather than by assumption.

It resolves **9 references today**, which is the entire current yield, because
Yorùbá has 533 multi-etymology pages and 16 of them carry any anchor at all.
`agbẹjọro` is the shape of the gap: someone wrote `gbà id=take`, `ẹjọ́ id=law`,
`rò id=think` — exactly right — and no page ever got the matching
`{{etymid}}`. Three careful references pointing at nothing. That is what
`#/contribute` exists to fix; see "Contribute" below.

Two details worth knowing if you touch this. Anchors are keyed on every
spelling an entry answers to (`spellingsForEntry`), not the page title — the
anchor lives on a page called `odo` while the compound writes `odò`. And one
anchor can name several entries, because Kaikki splits a section into one
record per part of speech and they all carry its `{{etymid}}`; `de`'s "arrive"
is both a verb and a preposition. The meaning tiebreak then runs *inside* what
the anchor allowed, which is how `Kọlade` correctly gets the verb.

#### When there is no anchor

A resolved reference names a *spelling*, and a spelling can belong to
several entries. Wiktionary lists `gbígbá` as a derived term under all five
`gbá` etymology sections — which isn't wrong, since partial reduplication is
productive and every one of those verbs can form it, but the `gbígbá` entry
documents exactly one sense, so only one derivation is lexically real. The
source never records which. Kaikki's `_dis1` vector looks like the answer and
isn't: it's all-zero on 2,611 of 2,638 derived items, and where it is
populated the *same* vector repeats for every derived term on the page, so it
cannot distinguish one from another.

So synthesized `derivedFrom` relations are grouped by the target's spelling
and part of speech, and each group resolves as far as the evidence goes:

- **One candidate** — a normal link.
- **Several, and the derived word's own etymology glosses the root** —
  scored against each candidate's definitions. `gbígbà`'s etymology says
  "to take, accept, allow", which matches `gbà` etymology 2 and nothing else.
  This settles 4 of the 24 ambiguous groups.
- **Several, and nothing distinguishes them** — all candidates are kept and
  the relation is marked ambiguous. `gbígbá`'s etymology says "to beat" and
  no `gbá` entry glosses "beat" (sense 5 is "to hit, kick, slap"), so nothing
  can honestly pick one. The UI shows one pill with a count badge that opens
  the full candidate list and says the source doesn't specify.

Two things that look like further signals and aren't, both measured over the
whole corpus rather than assumed: the upstream etymology-morpheme resolver
filters homographs on `canonicalForm.value`, which *is* `forms.exact` for all
6,272 entries, so the set it produces is exactly the group already formed here
— it narrows a group in 0 cases, and what looks like disambiguation in the
Component words UI is just the first candidate being displayed. And neither
crude English stemming ("beating" → "beat") nor scoring the derived word's own
gloss against the candidates resolves a single additional group.

An entry with no etymology section at all (`ìgbá`, `ìré`) is **not** evidence
that the derivation is false — it means nobody has written one, which is
exactly the gap these back-links exist to expose. Those are reported as
`derived-without-etymology`, a different action item from `ambiguous-derivation`.

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
true semantic matching. Worse, the tie-break only *ranks* — it never removes a
candidate, and the homograph filter it runs first can't narrow within a tone
group at all (see "Which sense did it come from?" above). So on a shared
spelling, a Component words pill is showing you the first of several, and it
is right by luck as often as by evidence.

**A badge marks doubt, not homography.** 1,707 morpheme pills stand for more
than one candidate entry, but on 1,138 of them the etymology recorded what the
root means and that settled it — badging all of them put a count on 22% of all
pages, and a warning that common stops being read as a warning. So a badge
appears only where we genuinely guessed: no recorded meaning, or one that
doesn't separate the candidates. That's 836 badges on 10% of pages, and the
badge expands in place to every candidate with its own definition.

Dropping it elsewhere is safe because the recovery path is now universal
rather than per-pill: follow a link to the wrong `orí` and *that* page lists
its own siblings. The badge only has to flag where we had nothing to go on.
Clicking the pill itself additionally populates the search box with that
spelling, as before.

Which candidate a meaning points at is decided by word overlap, with one
refinement that removes the need for a stopword list: **a word is only
evidence if it fails to appear in every candidate.** Filtering short words
throws away "on, at", which is the whole meaning of the preposition `ní`;
keeping everything lets "to" match every verb in the language, so "to beat"
scores equally against all five `gbá` entries and the tie reads as a match.
Dropping words common to all candidates kills "to" while keeping "at", and
says no exactly when the candidates really are indistinguishable.

**Competing decompositions get a line each.** 81 entries record more than one
way of breaking the same word down, and they are alternatives rather than
parts of a single longer word. Run together in one list they read as nonsense:
`mùwé` is `mọ̀ + ùwé` in Èkìtì and Oǹdó *or* `mù + ùwé` in Ìjẹ̀bú, and flat
that becomes a four-part word nobody has proposed. Each decomposition now gets
its own row with its parts joined by `+`, which is also what makes the section
teach anything — the structure is the point:

```
Wiktionary records 2 different ways of breaking this word down.

  ní ⁴  +  ìtorí
  ní "on, at"  +  ti "of"  +  orí "head, reason"
```

The grouping comes from kaikki-yoruba (`analysis` / `analysisTemplate` on each
morpheme), because template boundaries are only visible while the templates
are being walked — re-deriving them here would mean copying the rules for
which args are morphemes, reduplication's special case included, which is the
duplication that repo exists to remove. Data published before that field
lands keeps the older flat rendering, with repeated parts folded together.

The reverse direction is synthesized too: if one entry's etymology decomposes
to include another as a free-standing component, the component lists every
word built from it, rendered as a "Used in" section. It is derived purely from
etymology templates, so (unlike the `derived`/`related`/etc. synthesis below,
which depends on editors having filled in a list) it doesn't need the
component's own page to say anything.

**It comes in two fields, because most of these attributions are inferences.**
A compound's etymology names a *spelling*, and several meanings usually share
it. `annotateMorphemeConfidence` picks one; `attributeUsedIn` then files the
result by how it was picked:

| field | when | today |
|---|---|---|
| `usedInCompounds` | only one candidate existed, or an `{{etymid}}` anchor or a meaning match chose it | 3,327 items, one root each |
| `possiblyUsedIn` | the pick was a tiebreak or a fallback | 1,933 items — the same 562 compounds listed under **every** candidate |

Filing a guess under one meaning does two harms at once: the word appears
under a meaning it doesn't belong to, *and* disappears from the one it does.
Listing it under all of them, in a section headed "Possibly used in" with the
reason on an info button, is wrong in only the first way — and that half is
visible to the reader rather than hidden. It also keeps the two lists worth
different amounts: "Used in" can be read as a fact.

Anchoring an etymology on Wiktionary moves items from the second list to the
first, permanently. That is what `#/contribute` asks people to do.

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

#### English documents are per-GLOSS, and a word scores as its best one

Searching "child" used to put **ọmọ** — the word for child — at **#35**. BM25
divides by document length, and the index pooled every sense of an entry into
one document, so a word was penalised for having many senses, which is to say
for being important. Rank tracked document length almost exactly: `ojú`
(2 senses, 0.4× the average) #1, `ilé` (4 senses, 2.2×) #28, `ọmọ` (5 senses,
3.5×) #35, `igi` (5 senses, 2.2×) #79.

One document per gloss, with an entry scoring as its **best** gloss, puts
`ọmọ` and `igi` first. Two bonuses sit on top: a gloss that *is* the query
outranks one that merely mentions it, and a word that other **matching** words
are built from gets a minor, damped, capped lift — so `ọmọ` benefits from
`ọmọdé`, `ọmọkọ́mọ` and `ọmọ àlè` also matching. That bonus counts only other
members of the same result set, which is what keeps it minor: searching
"wheelbarrow" finds `ọmọlan̄ke` without dragging `ọmọ` along.

Example translations stay searchable but at **0.3 weight**. Once documents are
per-gloss they are short, and a three-word example sentence mentioning a child
otherwise outscores real definitions — measured, `dẹ̀` ("to be soft in
texture"), `mu` ("to drink") and `akọ` ("male") all reached the top ten for
"child" before the weighting.

The scorer lives in `public/english-relevance.js` rather than inside `app.js`,
so Node can load the same file the browser does. It is mirrored by
`shared/src/englishRelevance.ts` in **yoruba_student_dict_platform**, and
`npm run check:search` asserts `build/fixtures/search_agreement.json` — a
fixture checked into *both* repos. The two engines had drifted into scoring
English completely differently, which is how one query ended up broken in both,
in two different ways, with nothing to notice. That fixture is not full parity:
it records the differences the two are allowed to have, and fails on the ones
they are not.

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

`public/_headers` puts every file on `max-age=0, must-revalidate`, replacing
the `max-age=14400` Pages applies to static assets by default. **Nothing here
is fingerprinted** — the files are `app.js`, `style.css`, `data/entries.json`,
by those names — so a `max-age` is a promise that can't be withdrawn: no
purge or redeploy reaches a browser that already stored the file. The default
let a visitor pair four-hour-old JavaScript with current markup and a current
dictionary, and those aren't independent (`entries.json` and `app.js` ship as
a matched pair). A 304 costs no body and ~715 bytes of headers, multiplexed
onto the connection already open for the HTML, so a warm cache pays about one
extra round trip — and a cold cache pays it regardless.

If repeat-visit latency ever justifies real caching, fingerprint the
filenames *first* and then use `max-age=31536000, immutable`; lengthening the
window without fingerprints just widens the blast radius of a bad deploy. The
file itself explains the trade in full.

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
