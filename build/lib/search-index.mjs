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

// One document per GLOSS, not per entry. This is the fix for the bug that started this:
// searching "child" put ọmọ - the word for child - at #35.
//
// BM25 divides by document length, and pooling every sense of an entry into one document meant a
// word was penalised for having many senses, which is to say for being important. ọmọ's pooled
// document is 3.5x the corpus average, so it lost to ọmọkọ́mọ ("any child, naughty child": one
// sense, eight tokens). Measured across the corpus, rank correlated almost perfectly with document
// length: ojú (2 senses, 0.4x average) #1, ilé (4 senses, 2.2x) #28, igi (5 senses, 2.2x) #79.
//
// Per-gloss documents, with an entry scoring as its BEST gloss, put ọmọ and igi at #1. Verified
// against this corpus before the change was written.
//
// Example translations stay searchable but as their own documents, and they cannot earn the
// exact-gloss bonus below - finding a word through a sentence it appears in is a real feature, and
// it should not compete with what the word MEANS. This is one of the few places yorubadict and
// yoruba_student_dict_platform legitimately differ, because the platform's corpus rows carry no
// examples at all.
//
// Keep this in step with the platform's shared/src/englishRelevance.ts. The two engines had drifted
// into scoring English completely differently, which is how one query got broken in two different
// ways at once.
function buildEnglishIndex(entries) {
  const postings = new Map(); // token -> Map(docIdx -> tf)
  /** docIdx -> entryId. The client folds per-document scores back up to one score per entry. */
  const docEntryIds = [];
  const docLengths = [];
  /** An exact-clause inverted index: "child" -> [docIdx, ...].
   *
   * The bonus for "this gloss IS the query" needs to know a gloss's clauses at query time, and
   * shipping every clause per document would bloat the artifact. Inverting it costs one row per
   * distinct clause instead. */
  const exactClauses = new Map();

  const addDoc = (entryId, tokens, clauses) => {
    if (tokens.length === 0) return;
    const docIdx = docEntryIds.length;
    docEntryIds.push(entryId);
    docLengths.push(tokens.length);
    const tf = new Map();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    for (const [tok, count] of tf.entries()) {
      if (!postings.has(tok)) postings.set(tok, new Map());
      postings.get(tok).set(docIdx, count);
    }
    for (const clause of clauses) {
      if (!exactClauses.has(clause)) exactClauses.set(clause, []);
      exactClauses.get(clause).push(docIdx);
    }
  };

  // GLOSS documents first, then EXAMPLE documents, so one integer separates the two kinds and the
  // client can weight them differently without an extra per-document array.
  //
  // The weighting matters more than it looks. Once documents are per-gloss they are short, and a
  // three-word example translation mentioning "child" then outscores real glosses: measured, the
  // first pass at this put dẹ̀ ("to be soft in texture"), mu ("to drink") and akọ ("male") into the
  // top ten for "child", purely because each has an example sentence with a child in it. An example
  // is evidence that a word appears NEAR the query, not that it means it.
  for (const entry of entries) {
    for (const sense of entry.senses) {
      // Glosses keep stopwords, for the reason englishTextForEntry documents: a real Yoruba
      // demonstrative's entire correct gloss can be "that".
      for (const gloss of [...(sense.glosses || []), ...(sense.rawGlosses || [])]) {
        addDoc(entry.id, tokenize(gloss, { keepStopwords: true }), clausesOfGloss(gloss));
      }
    }
  }
  const glossDocCount = docEntryIds.length;

  for (const entry of entries) {
    for (const sense of entry.senses) {
      for (const ex of sense.examples) {
        if (ex.translation) addDoc(entry.id, tokenize(ex.translation), []);
      }
    }
  }

  const totalDocs = docEntryIds.length;
  const totalLength = docLengths.reduce((a, b) => a + b, 0);
  const avgDocLength = totalDocs > 0 ? totalLength / totalDocs : 0;

  const postingsOut = {};
  const df = {};
  for (const [tok, docMap] of postings.entries()) {
    postingsOut[tok] = [...docMap.entries()];
    df[tok] = docMap.size;
  }

  return {
    postings: postingsOut,
    df,
    docEntryIds,
    docLengths,
    avgDocLength,
    totalDocs,
    /** Documents below this index are glosses; at or above it, example translations. */
    glossDocCount,
    exactClauses: Object.fromEntries(exactClauses),
  };
}

/** The `;`/`,`-delimited clauses of a gloss, folded the way tokens are.
 *
 * A gloss is usually a list of near-synonyms ("child; offspring", "path, way, road"), so the unit
 * that can equal a query is a clause rather than the whole string. Mirrors glossClauses in the
 * platform's englishRelevance.ts. */
function clausesOfGloss(gloss) {
  return allForms(gloss || '')
    .orthographyInsensitive.replace(/["'’“”().]/g, '')
    .split(/[;,]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** For each entry, the non-bound morphemes it is built FROM, orthography-insensitively.
 *
 * Feeds the "root of other matching words" bonus: ọmọ should rank up partly because ọmọdé,
 * ọmọkọ́mọ and ọmọ àlè are built out of it, and Wiktionary's etymology records that directly.
 * Bound morphemes (prefixes like `a-`) are skipped - they are not words a search should promote. */
function buildComponentIndex(entries) {
  const out = {};
  for (const entry of entries) {
    const parts = (entry.etymologyMorphemes || [])
      .filter((m) => m && !m.bound && m.form)
      .map((m) => allForms(m.form).orthographyInsensitive)
      .filter(Boolean);
    if (parts.length > 0) out[entry.id] = [...new Set(parts)];
  }
  return out;
}

// Dialect synonyms are searchable, but on their own tier and pointing at the
// PARENT entry: hearing "ulé" in Ijebu and searching it should find ilé.
//
// Two deliberate limits keep this from cluttering results:
//
//   - A spelling already resolvable through the ortho tier is skipped. Most
//     dialect terms are just the standard spelling repeated across dozens of
//     varieties (~30 varieties spell inú as "inú"), and where a dialect form
//     does have its own entry, that entry carries a dialectOf back-link
//     instead. Measured: 537 distinct dialect terms collapse to ~871 new keys
//     corpus-wide rather than thousands of rows.
//   - Each key stores one posting per parent entry, with the variety names
//     that produced it, so a match renders as a single labelled row however
//     many varieties agreed.
//
// Keyed orthography-insensitively (the most forgiving tier) since someone
// recalling a spoken dialect word is the least likely to have tone marks.
function buildDialectTier(entries, orthoTier) {
  const alreadyFindable = new Set(orthoTier.spellings);
  const map = new Map(); // spelling -> Map(parentEntryId -> Set(variety))

  for (const entry of entries) {
    for (const set of entry.dialectSynonyms || []) {
      for (const group of set.groups || []) {
        for (const variety of group.varieties || []) {
          const label = variety.display || variety.name;
          for (const { term } of variety.terms || []) {
            const key = allForms(term).orthographyInsensitive;
            if (!key || alreadyFindable.has(key)) continue;
            if (!map.has(key)) map.set(key, new Map());
            const byEntry = map.get(key);
            if (!byEntry.has(entry.id)) byEntry.set(entry.id, new Set());
            byEntry.get(entry.id).add(label);
          }
        }
      }
    }
  }

  const spellings = [...map.keys()].sort();
  return {
    spellings,
    postings: Object.fromEntries(
      spellings.map((s) => [
        s,
        [...map.get(s).entries()].map(([id, varieties]) => ({ id, varieties: [...varieties] })),
      ])
    ),
  };
}

export function buildSearchIndex(entries) {
  const formsByEntry = new Map(entries.map((e) => [e.id, searchableForms(e)]));
  const ortho = buildSortedTierIndex(entries, 'orthographyInsensitive', formsByEntry);
  return {
    yoruba: {
      exact: buildSortedTierIndex(entries, 'exact', formsByEntry),
      tone: buildSortedTierIndex(entries, 'toneInsensitive', formsByEntry),
      ortho,
      dialect: buildDialectTier(entries, ortho),
    },
    english: buildEnglishIndex(entries),
    components: buildComponentIndex(entries),
  };
}
