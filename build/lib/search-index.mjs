// build/lib/search-index.mjs
//
// Stage 5: Search index builder. Produces browser-ready, dependency-free
// search structures:
//
//   - yoruba.{exact,tone,ortho}: sorted (spelling, [entryIds]) lists, so the
//     browser can binary-search for exact AND prefix matches in O(log n).
//   - english: a classic inverted index (postings + document frequency +
//     document lengths) so the browser can score BM25 itself with no
//     server round-trip.

import { allForms, spellingsForEntry } from './orthography.mjs';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'or', 'and', 'in', 'on', 'as', 'is', 'be',
  'by', 'with', 'for', 'that', 'this',
]);

function tokenize(text, { keepStopwords = false } = {}) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t && t.length > 1 && (keepStopwords || !STOPWORDS.has(t)));
}

// Glosses are short, curated definitions, not free prose - for a real
// Yoruba conjunction/demonstrative, the entire correct gloss can just be
// "that"/"this"/"and"/"or" (confirmed: 10 real entries corpus-wide), so
// stopword-filtering must not apply there or those words become
// permanently unsearchable by their own definition. It's still correct for
// example-sentence translations, genuine natural-language prose where
// stopwords really are just noise.
function englishTextForEntry(entry) {
  const glossParts = [];
  const exampleParts = [];
  for (const sense of entry.senses) {
    glossParts.push(...(sense.glosses || []));
    glossParts.push(...(sense.rawGlosses || []));
    for (const ex of sense.examples) {
      if (ex.translation) exampleParts.push(ex.translation);
    }
  }
  return { glossText: glossParts.join(' '), exampleText: exampleParts.join(' ') };
}

// Every searchable spelling for an entry - headword, canonical form, and
// each alt form Wiktionary lists (e.g. iná's alt form uná) - each with its
// own exact/toneInsensitive/orthographyInsensitive tiers, all pointing back
// at the same entry. Without this, alt forms (and the raw headword, when it
// differs from the canonical spelling) are real, displayed/resolvable data
// that's simply never findable by search.
function searchableForms(entry) {
  return spellingsForEntry(entry).map(allForms);
}

function buildSortedTierIndex(entries, tierKey, formsByEntry) {
  const map = new Map(); // spelling -> Set(entryId)
  for (const entry of entries) {
    for (const formsObj of formsByEntry.get(entry.id)) {
      const spelling = formsObj[tierKey];
      if (!spelling) continue;
      if (!map.has(spelling)) map.set(spelling, new Set());
      map.get(spelling).add(entry.id);
    }
  }
  const sortedSpellings = [...map.keys()].sort();
  return {
    spellings: sortedSpellings,
    postings: Object.fromEntries(sortedSpellings.map((s) => [s, [...map.get(s)]])),
  };
}

function buildEnglishIndex(entries) {
  const postings = new Map(); // token -> Map(entryId -> tf)
  const docLengths = {};

  for (const entry of entries) {
    const { glossText, exampleText } = englishTextForEntry(entry);
    const tokens = [
      ...tokenize(glossText, { keepStopwords: true }),
      ...tokenize(exampleText),
    ];
    docLengths[entry.id] = tokens.length;
    const tf = new Map();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    for (const [tok, count] of tf.entries()) {
      if (!postings.has(tok)) postings.set(tok, new Map());
      postings.get(tok).set(entry.id, count);
    }
  }

  const totalDocs = entries.length;
  const totalLength = Object.values(docLengths).reduce((a, b) => a + b, 0);
  const avgDocLength = totalDocs > 0 ? totalLength / totalDocs : 0;

  const postingsOut = {};
  const df = {};
  for (const [tok, docMap] of postings.entries()) {
    postingsOut[tok] = [...docMap.entries()];
    df[tok] = docMap.size;
  }

  return { postings: postingsOut, df, docLengths, avgDocLength, totalDocs };
}

export function buildSearchIndex(entries) {
  const formsByEntry = new Map(entries.map((e) => [e.id, searchableForms(e)]));
  return {
    yoruba: {
      exact: buildSortedTierIndex(entries, 'exact', formsByEntry),
      tone: buildSortedTierIndex(entries, 'toneInsensitive', formsByEntry),
      ortho: buildSortedTierIndex(entries, 'orthographyInsensitive', formsByEntry),
    },
    english: buildEnglishIndex(entries),
  };
}
