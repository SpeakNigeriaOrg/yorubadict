# Ọ̀rọ̀ | The Yoruba Dictionary (local build)

A fully static, client-side Yorùbá dictionary built from the Kaikki
Wiktionary JSONL extract, per the attached spec. No backend, no database —
an offline build pipeline compiles the raw extract into browser-ready JSON,
and the runtime does all searching locally in the browser.

This build ships with a 16-line sample (`data/sample.jsonl`) drawn from the
real Kaikki Yorùbá extract, so you can see the whole pipeline working
end-to-end today. Point it at the full extract and it scales the same way —
nothing about the pipeline is sample-specific.

## Quick start

```
npm run build     # runs the offline pipeline against data/sample.jsonl
npm run serve     # serves public/ at http://localhost:8080
```

Or both at once: `npm start`.

You need Node 18+. No dependencies are installed — everything here is
vanilla Node/JS/HTML/CSS on purpose, matching the spec's "no backend, no
database, deployable to static hosting" requirement.

**Why a dev server at all, if it's static?** Browsers block `fetch()`
against `file://` URLs (CORS), so `public/` needs to be served over
`http://` to test locally. `server/dev-server.mjs` is a ~50-line
zero-dependency static file server that exists *only* for this — it is not
part of the deployed app and does no server-side logic beyond "read the
file, return it." Deploy `public/` to Cloudflare Pages, Netlify, GitHub
Pages, or any static host and it works the same way, no dev server
involved.

## Using your own JSONL

```
npm run build -- path/to/your-kaikki-extract.jsonl
```

## Architecture

Matches the spec's compiler pipeline exactly:

```
Kaikki JSONL
  -> build/lib/parser.mjs         (Stage 1: parse JSONL, report errors)
  -> build/lib/normalizer.mjs     (Stage 2: canonical form inference,
                                    orthographic normalization, per-field
                                    extraction — never discards source data)
  -> build/lib/relationships.mjs  (Stage 3: alias resolution + reciprocal
                                    relationship synthesis, with provenance)
  -> build/lib/validator.mjs      (Stage 4: diagnostic report)
  -> build/lib/search-index.mjs   (Stage 5: sorted Yorùbá tier indices +
                                    English BM25 inverted index)
  -> public/data/*.json           (Static browser assets)
```

`build/normalize.mjs` orchestrates all five stages and writes:

- `public/data/entries.json` — canonical entries, keyed by stable id
- `public/data/search-index.json` — Yorùbá exact/tone/orthography tiers
  (sorted arrays, binary-searched for O(log n) exact + prefix lookups) and
  an English inverted index (postings + document frequency + document
  lengths, scored client-side with BM25)
- `public/data/validation-report.json` — same report, published for the
  in-app "Data quality" panel

### Entry IDs

Each entry's id is its first sense's Kaikki-assigned sense id (e.g.
`en-fa-yo-verb-OFVmd8R8`) — already a stable, source-derived identifier that
doesn't depend on our own spelling-normalization decisions, satisfying the
spec's "stable internal identifier independent of spelling" requirement
without inventing a new ID scheme.

### Orthographic normalization

Implements the spec's three independent dimensions exactly as specified
(verified against the spec's own worked example, `ilẹ̀ → ilẹ → ile`):

- **exact** — untouched
- **tone-insensitive** — tone marks (grave/acute/macron) stripped via NFD
  decomposition, underdots preserved
- **orthography-insensitive** — tone marks *and* underdots stripped,
  lowercased

The same normalization functions are duplicated (deliberately, not
imported) in `public/app.js` — the browser needs the exact same rules
applied to the user's query as the pipeline applied to the headwords, and
keeping them as plain, dependency-free functions in both places avoids a
build step for the frontend itself.

### Relationship synthesis and its honest limits

`derived`/`related`/`synonyms`/`antonyms`/`descendants` are resolved against
an alias index (spelling → entry ids) built from every entry's headword,
canonical form, and alternative forms. Unresolved references — the target
spelling isn't in the current dataset — are kept, tagged `resolved: false`,
and logged to the validation report rather than silently dropped. In the UI
they render as dashed, non-clickable pills instead of broken links.

**With only 16 sample entries, most cross-references will show as
unresolved** — e.g. `fà`'s derived term `ọfà` isn't in this sample, so it
renders as plain unresolved text. This is expected, not a bug: resolution
happens purely from spelling matches at build time, so rebuilding against
the full ~40k-entry extract resolves the large majority of them
automatically, with no changes to the pipeline or frontend.

Reciprocal links are synthesized where the source lists a relationship but
the target doesn't reference it back (e.g. A → derivedTerms → B without B →
derivedFrom → A). These are visually marked with a small ↺ and a tooltip
explaining they were inferred, not stated by Wiktionary — per the spec's
provenance-tracking requirement.

### Search ranking

Implements the spec's priority order exactly (`public/app.js`, `search()`):
exact Yorùbá match → tone-insensitive → orthography-insensitive → prefix →
English BM25, deduped by id, first-seen tier wins (deterministic).

### Routing

Uses hash-based routes (`#/entry/<id>`) rather than the spec's illustrative
path-based example (`/entry/ilé`). Two reasons: (1) spellings aren't unique
identifiers here — six different `de` homographs exist in the sample alone
— so an id-based route is more correct than a spelling-based one regardless
of URL style; (2) hash routes need zero server-side rewrite configuration
on any static host, keeping the "fully static, zero backend" property
airtight. Deep links, bookmarks, and the back button all work as specified.
If you'd rather have path-based URLs for a production deploy, that mainly
means adding a `_redirects`/`_headers` rule on your host (e.g. `/* /index.html
200` on Cloudflare Pages) and swapping `location.hash` for
`history.pushState` in `app.js` — the entry-rendering code doesn't change.

### What's genuinely untested at scale

This has only been run against 16 entries. Things worth checking once you
have the full extract:

- **Performance** at ~40k+ entries — the search-index build is O(n), and
  browser-side binary search is O(log n) per query, so it should hold up,
  but it hasn't been measured against the spec's <20ms / <3MB targets at
  real scale.
- **English index size** — the current inverted index is unpruned (every
  token, including fairly generic ones, gets a postings list). At full
  scale you may want a stopword list beyond the current minimal one, or to
  drop terms above a document-frequency ceiling.
- **Fuzzy search** (spec section 6.5) is explicitly out of scope for this
  version, matching the spec's own "may be added later."

## Project layout

```
data/sample.jsonl              16-line sample from the real Kaikki extract
build/
  normalize.mjs                 pipeline orchestrator (entry point)
  lib/
    orthography.mjs             tone/underdot stripping
    parser.mjs                  Stage 1
    normalizer.mjs               Stage 2
    relationships.mjs            Stage 3
    validator.mjs                 Stage 4
    search-index.mjs              Stage 5
  validation-report.json        (generated)
public/                          <- deploy this directory as-is
  index.html
  style.css
  app.js
  data/                          (generated: entries.json, search-index.json,
                                   validation-report.json)
server/
  dev-server.mjs                local-testing-only static file server
```
