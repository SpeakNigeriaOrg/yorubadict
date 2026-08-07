// public/english-relevance.js
//
// How well an English query matches an entry's meanings. Loaded by the browser before app.js, and
// require()d by build/check-search-agreement.mjs.
//
// ---------------------------------------------------------------------------
// Why this is its own file
// ---------------------------------------------------------------------------
// It used to live inside app.js's IIFE, which nothing outside a browser can reach - so the only way
// to check the ranking was to reimplement it in a script, and a reimplementation drifts from the
// thing it is checking. That is not hypothetical: this scorer and the equivalent in
// yoruba_student_dict_platform had drifted into two different algorithms with two different failure
// modes, and searching "child" was broken in both without either noticing. One file, two loaders.
//
// ---------------------------------------------------------------------------
// The rule, shared with the platform
// ---------------------------------------------------------------------------
// Mirror of yoruba_student_dict_platform/shared/src/englishRelevance.ts. Changing one without the
// other is drift - fixtures/search_agreement.json exists to catch that.
//
//   1. Documents are per-GLOSS, and an entry scores as its BEST gloss - never the sum.
//   2. BM25 term weighting within a gloss.
//   3. A bonus when a gloss (or a ;/,-delimited clause of one) IS the query.
//   4. A minor, damped, capped bonus for a word that other MATCHING words are built from.
//
// (1) is the fix for the reported bug. BM25 divides by document length, so pooling every sense of an
// entry into one document penalised a word for having many senses - which is to say for being
// important. ọmọ ("child") has five senses and a document 3.5x the corpus average, and sat at #35 for
// "child" behind ọmọkọ́mọ ("any child, naughty child": one sense, eight tokens). Per-gloss puts it
// first.

// Assigns to globalThis rather than using module.exports: package.json sets "type": "module", so
// Node treats a .js file as ESM - where `module` does not exist and top-level `this` is undefined -
// while the browser needs a plain <script> it can load without a module graph. globalThis is the one
// name both loaders agree on.
(function (root, factory) {
  root.EnglishRelevance = factory();
})(globalThis, function () {
  'use strict';

  var K1 = 1.5;
  var B = 0.75;

  /** How much a gloss that IS the query outranks one that merely mentions it. Large on purpose: no
   * amount of length normalisation distinguishes "the word means this" from "the word is described
   * using this". */
  var EXACT_GLOSS_BONUS = 2;

  /** The root bonus. Deliberately minor - it reorders near-ties, it does not override relevance. */
  var ROOT_WEIGHT = 0.5;
  var ROOT_CAP = 3;

  /** Example translations count, but far less than a definition.
   *
   * They are evidence a word appears NEAR the query, not that it means it. At full weight, once
   * documents became per-gloss and therefore short, a three-word example sentence mentioning a child
   * outscored real glosses: measured, dẹ̀ ("to be soft in texture"), mu ("to drink") and akọ ("male")
   * all reached the top ten for "child". Down-weighted, a word findable only through a sentence it
   * appears in still surfaces without competing with meaning. */
  var EXAMPLE_DOC_WEIGHT = 0.3;

  function tokenizeQuery(query) {
    return query.toLowerCase().split(/[^a-z0-9']+/).filter(function (t) { return t.length > 1; });
  }

  /** Scores an English query over the prebuilt per-gloss index and returns entry ids, best first.
   *
   * `orthographyInsensitive` and `formOfEntry` are injected so this file needs neither the
   * orthography module nor the entry store - the browser and the checker each supply their own. */
  function bm25Search(english, components, query, limit, helpers) {
    var orthographyInsensitive = helpers.orthographyInsensitive;
    var formOfEntry = helpers.formOfEntry;

    var tokens = tokenizeQuery(query);
    if (tokens.length === 0) return [];

    var docScores = new Map();
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var postings = english.postings[tok];
      if (!postings) continue;
      var df = english.df[tok] || postings.length;
      var idf = Math.log(1 + (english.totalDocs - df + 0.5) / (df + 0.5));
      for (var j = 0; j < postings.length; j++) {
        var docIdx = postings[j][0];
        var tf = postings[j][1];
        var docLen = english.docLengths[docIdx] || 1;
        var norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / english.avgDocLength)));
        var weight = docIdx >= english.glossDocCount ? EXAMPLE_DOC_WEIGHT : 1;
        docScores.set(docIdx, (docScores.get(docIdx) || 0) + idf * norm * weight);
      }
    }
    if (docScores.size === 0) return [];

    // Applied per document, before folding up to entries, so it lands on the gloss that earned it.
    var exactKey = orthographyInsensitive(query).trim();
    var exactDocs = english.exactClauses && english.exactClauses[exactKey];
    if (exactDocs) {
      for (var e = 0; e < exactDocs.length; e++) {
        var d = exactDocs[e];
        if (docScores.has(d)) docScores.set(d, docScores.get(d) + EXACT_GLOSS_BONUS);
      }
    }

    // BEST gloss per entry. Summing is what rewards verbosity.
    var byEntry = new Map();
    docScores.forEach(function (score, idx) {
      var entryId = english.docEntryIds[idx];
      if (!byEntry.has(entryId) || byEntry.get(entryId) < score) byEntry.set(entryId, score);
    });

    // Counted over THIS RESULT SET, which is what keeps it minor: a productive root is lifted only
    // when the query already matched it AND matched words built from it. So "wheelbarrow" finds
    // ọmọlan̄ke without dragging ọmọ along.
    var keyOf = function (entryId) {
      var form = formOfEntry(entryId);
      return form ? orthographyInsensitive(form) : '';
    };
    var matches = [];
    byEntry.forEach(function (_score, entryId) { matches.push({ id: entryId, key: keyOf(entryId) }); });

    var finalScores = [];
    byEntry.forEach(function (score, entryId) {
      var key = keyOf(entryId);
      var derived = 0;
      if (key) {
        for (var m = 0; m < matches.length; m++) {
          var other = matches[m];
          if (other.id === entryId || other.key === key) continue;
          var parts = components[other.id];
          if ((parts && parts.indexOf(key) !== -1) || (other.key.length > key.length && other.key.indexOf(key) !== -1)) {
            derived++;
          }
        }
      }
      var bonus = derived === 0 ? 0 : Math.min(ROOT_WEIGHT * Math.log2(1 + derived), ROOT_WEIGHT * ROOT_CAP);
      finalScores.push([entryId, score + bonus]);
    });

    finalScores.sort(function (a, b) { return b[1] - a[1]; });
    return finalScores.slice(0, limit).map(function (pair) { return pair[0]; });
  }

  return { bm25Search: bm25Search, EXAMPLE_DOC_WEIGHT: EXAMPLE_DOC_WEIGHT };
});
