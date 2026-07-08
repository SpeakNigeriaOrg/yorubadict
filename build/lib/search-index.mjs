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

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'or', 'and', 'in', 'on', 'as', 'is', 'be',
  'by', 'with', 'for', 'that', 'this',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t));
}

function englishTextForEntry(entry) {
  const parts = [];
  for (const sense of entry.senses) {
    parts.push(...(sense.glosses || []));
    parts.push(...(sense.rawGlosses || []));
    for (const ex of sense.examples) {
      if (ex.translation) parts.push(ex.translation);
    }
  }
  return parts.join(' ');
}

function buildSortedTierIndex(entries, tierKey) {
  const map = new Map(); // spelling -> Set(entryId)
  for (const entry of entries) {
    const spelling = entry.forms[tierKey];
    if (!spelling) continue;
    if (!map.has(spelling)) map.set(spelling, new Set());
    map.get(spelling).add(entry.id);
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
    const tokens = tokenize(englishTextForEntry(entry));
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
  return {
    yoruba: {
      exact: buildSortedTierIndex(entries, 'exact'),
      tone: buildSortedTierIndex(entries, 'toneInsensitive'),
      ortho: buildSortedTierIndex(entries, 'orthographyInsensitive'),
    },
    english: buildEnglishIndex(entries),
  };
}
