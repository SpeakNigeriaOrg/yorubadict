# Frequency data

Build inputs only. Nothing here is served to the browser — they are read by
`build/lib/building-blocks.mjs` to decide which derived words make good examples
on the Key Building Block Words page.

Both files are filtered to words that actually appear in this dictionary, which
is why they are tens of kilobytes rather than megabytes.

## Why frequency data at all

Ranking the building blocks themselves needs none: ordering the roots by how
many words they build, or by a weighted prominence score, returns 24 of the same
25 words either way. The list is stable.

Choosing *examples* is a different problem, and signals from inside our own
corpus fail at it. Sense count, usage examples, IPA and dialect coverage all
measure how much attention a Wiktionary editor gave a word, which tracks
cultural notability rather than commonness. Ranked that way, the examples for
`ọmọ` ("child") come out as `agẹmọ` (chameleon), `ọmọdó` (pestle) and `Agẹmọ`
(an orisha) — the exact obscurity the page exists to avoid. With the files here,
they come out as `ọmọdé` (child), `ọmọ ilé ìwé` (student) and `ọmọ ẹgbẹ́`
(member).

## `yoruba.json` — `{ spelling: corpus count }`

Derived from the **Leipzig Corpora Collection**, corpus `yor_wikipedia_2021_10K`.

- Source: <https://downloads.wortschatz-leipzig.de/corpora/yor_wikipedia_2021_10K.tar.gz>
- Licence: **CC BY 4.0** — attribution required, and credited on the Key
  Building Block Words page itself.
- Citation: D. Goldhahn, T. Eckart, U. Quasthoff. *Building Large Monolingual
  Dictionaries at the Leipzig Corpora Collection.* LREC 2012.

This is the only Yorùbá list Leipzig publishes; the 30K, 100K and 300K variants
and the news and web corpora all return 404. It covers about 38% of the derived
words in our corpus and is dependable where the count is 5 or more. Below that
the Wikipedia bias shows: monarch titles and orisha names outrank ordinary
vocabulary.

## `english.json` — `{ word: rank }`, rank 0 = most common

The fallback for the other 62%, covering 84% of derived words. It scores how
common a *concept* is, on the assumption that a learner's syllabus follows
concepts, so a word defined as "school" is a better early example than one
defined as "unparliamentary language".

- Source: <https://github.com/first20hours/google-10000-english> (`google-10000-english-usa.txt`),
  derived from the Google Trillion Word Corpus.

Used with care: scoring a definition by its most common word rewards long
encyclopedic definitions, because a sentence about an orisha is bound to contain
some very common English word. `building-blocks.mjs` therefore averages over the
definition and drops proper names and definitions longer than six words before
scoring at all.

## Refreshing

Neither source changes often and neither is fetched at build time, deliberately
— the build stays offline apart from kaikki-yoruba's release. To refresh, take
the tarball and the English list, filter both to the spellings and definition
words in `public/data/entries.json`, and rewrite these two files.
