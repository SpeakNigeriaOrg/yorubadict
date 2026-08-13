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

  /** A meaning reached because another entry's definition named this word as another way to say it.
   *
   * Evidence that some other word means this, not that this word does - so stronger than appearing
   * near the query in an example sentence, and still second-hand. One notch above the example weight
   * for exactly that reason.
   *
   * Measured over the 400 most common definition clauses, with the corpus statistics frozen and the
   * exact-clause bonus withheld: at 0.3 three entries entered a top-three slot, at 0.4 four, at 1.0
   * twenty-one and èwe ("adolescent, youth") starts climbing on the query "child". No top result
   * moves at any of those weights. 0.4 buys the recall without disturbing what already worked. */
  var SYNONYM_DOC_WEIGHT = 0.4;

  /** A word the query IS, according to some entry that listed it as a synonym.
   *
   * Soft, not hard. The three whole-string tiers are identifications - you typed the word, you get
   * the word - whereas this says the word you typed means roughly what some OTHER entry means, which
   * is the same kind of claim as an English definition match and belongs where semantics compete.
   *
   * Sits above every achievable prefix score and below a typical third-place English score. Measured
   * over the same 400 clauses: English #1 runs 9.9 at the tenth percentile and 12.9 at the median,
   * English #3 medians 11.6, and a prefix match cannot exceed PREFIX_SCALE because coverage is always
   * below 1. So 10 beats every partial-spelling guess and lands after the definitions that are
   * actually about the query. */
  var SYNONYM_TIER_SCORE = 10;

  /** Scales a partial-spelling (prefix) match onto this score's range, so the two can be compared.
   *
   * A prefix match used to outrank every English match automatically, however little of the word the
   * query covered. Searching "eye" filled the whole first page with Yoruba - it IS ẹyẹ (bird)
   * orthography-insensitively, and a prefix of eyeye/èyé/yéye - so ojú, whose gloss is literally
   * "eye", was pushed off it.
   *
   * Coverage is always below 1 for a prefix, since a full-length match would have been the
   * whole-string tier. 9 puts a near-complete prefix above a strong English match and a
   * three-of-eight-character one below it.
   *
   * The three whole-string tiers stay ABSOLUTE - if you typed the word, you get the word. Softening
   * those too was measured in the platform: it lifts ojú to first but pushes the Yoruba query `owo`
   * from #5 to #11, trading a Yoruba answer for an English one in a Yoruba dictionary. */
  var PREFIX_SCALE = 9;

  function prefixMatchScore(queryLength, formLength) {
    if (formLength <= 0) return 0;
    return (queryLength / formLength) * PREFIX_SCALE;
  }

  function tokenizeQuery(query) {
    return query.toLowerCase().split(/[^a-z0-9']+/).filter(function (t) { return t.length > 1; });
  }

  /** Scores an English query over the prebuilt per-gloss index and returns entry ids, best first.
   *
   * `orthographyInsensitive` and `formOfEntry` are injected so this file needs neither the
   * orthography module nor the entry store - the browser and the checker each supply their own. */
  function bm25Search(english, components, query, limit, helpers, out) {
    var orthographyInsensitive = helpers.orthographyInsensitive;
    var formOfEntry = helpers.formOfEntry;
    // Documents at or above this index are inherited from a declared synonym. Absent in an index
    // built before that existed, in which case nothing is inherited and every document is direct.
    var inheritedStart = english.inheritedDocStart === undefined ? Infinity : english.inheritedDocStart;

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
        // Three bands, separated by two integers rather than a per-document array: definitions, then
        // example translations, then meanings inherited through a declared synonym.
        var weight = 1;
        if (docIdx >= inheritedStart) weight = SYNONYM_DOC_WEIGHT;
        else if (docIdx >= english.glossDocCount) weight = EXAMPLE_DOC_WEIGHT;
        docScores.set(docIdx, (docScores.get(docIdx) || 0) + idf * norm * weight);
      }
    }
    if (docScores.size === 0) return [];

    // Applied per document, before folding up to entries, so it lands on the gloss that earned it.
    //
    // Never on an inherited document. The bonus means "this word IS the query"; inherited text only
    // says a word this word is a synonym of is the query. oṣù ("month") is a declared synonym of
    // òṣùpá ("moon"), and letting it take the +2 for the clause "moon" put month ahead of the actual
    // word for moon. The index also withholds inherited documents from exactClauses, so this is the
    // second of two locks on the same door.
    var exactKey = orthographyInsensitive(query).trim();
    var exactDocs = english.exactClauses && english.exactClauses[exactKey];
    if (exactDocs) {
      for (var e = 0; e < exactDocs.length; e++) {
        var d = exactDocs[e];
        if (d < inheritedStart && docScores.has(d)) docScores.set(d, docScores.get(d) + EXACT_GLOSS_BONUS);
      }
    }

    // BEST gloss per entry. Summing is what rewards verbosity.
    //
    // `directMatches` records the entries the query matched ITSELF, as opposed to those it reached
    // through someone else's synonym list. The root bonus below is defined as counting over "this
    // result set", and inherited documents quietly widen that set to entries the query never touched -
    // see the note there.
    var byEntry = new Map();
    var winningDoc = new Map();
    var directMatches = new Set();
    docScores.forEach(function (score, idx) {
      var entryId = english.docEntryIds[idx];
      if (idx < inheritedStart) directMatches.add(entryId);
      if (!byEntry.has(entryId) || byEntry.get(entryId) < score) {
        byEntry.set(entryId, score);
        winningDoc.set(entryId, idx);
      }
    });
    // Which document won, so a result row can show the meaning that actually matched rather than the
    // entry's first one, and can say when it was reached through another word.
    if (out) out.winningDoc = winningDoc;

    // Counted over THIS RESULT SET, which is what keeps it minor: a productive root is lifted only
    // when the query already matched it AND matched words built from it. So "wheelbarrow" finds
    // ọmọlan̄ke without dragging ọmọ along.
    var keyOf = function (entryId) {
      var form = formOfEntry(entryId);
      return form ? orthographyInsensitive(form) : '';
    };
    // Built from the DIRECT matches only. rootBonusMustNotPromote depends on "this result set" meaning
    // entries the query itself matched: an inherited document puts an entry into byEntry that the
    // query never touched, so counting those would let a synonym-reached word vote on some other
    // word's root bonus. Synonym-reached entries are still scored below; they just do not vote.
    var matches = [];
    byEntry.forEach(function (_score, entryId) {
      if (directMatches.has(entryId)) matches.push({ id: entryId, key: keyOf(entryId) });
    });

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
    // Scores, not just ids: search() merges these with scored prefix matches, so it needs both.
    return finalScores.slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // The full ranking, so a checker can exercise what a user actually gets
  // ---------------------------------------------------------------------------
  // The tier lookups and the hard/soft merge live here rather than in app.js's search() because
  // otherwise nothing outside a browser can reach them - and a check that only covers the English
  // scorer misses the tier interaction entirely. That is not a hypothetical gap either: it let a
  // claim that "eye -> ojú reaches #1 in yorubadict but not the platform" stand for a while, when in
  // fact both put it around #9 once the Yoruba tiers are included.
  //
  // app.js still owns the dialect tier, because matching there has a side effect (recording which
  // varieties produced a hit, for the result row to explain itself). It passes the ids in.

  function lowerBound(arr, target) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (arr[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function exactMatch(tier, query) {
    var i = lowerBound(tier.spellings, query);
    if (i < tier.spellings.length && tier.spellings[i] === query) return tier.postings[tier.spellings[i]];
    return [];
  }

  /** [entryId, score] pairs, scored by how much of the matched word the query covers. */
  function prefixMatches(tier, prefix, limit) {
    var start = lowerBound(tier.spellings, prefix);
    var results = [];
    var byId = new Map();
    for (var i = start; i < tier.spellings.length; i++) {
      var spelling = tier.spellings[i];
      if (spelling.indexOf(prefix) !== 0) break;
      var score = prefixMatchScore(prefix.length, spelling.length);
      var postings = tier.postings[spelling];
      for (var j = 0; j < postings.length; j++) {
        var id = postings[j];
        // The same entry can be reached under several spellings; keep its best coverage.
        if (byId.has(id)) {
          var prior = byId.get(id);
          if (score > prior[1]) prior[1] = score;
        } else {
          var pair = [id, score];
          byId.set(id, pair);
          results.push(pair);
        }
      }
      if (results.length >= limit) break;
    }
    return results;
  }

  /** [entryId, score] for entries whose definitions name this spelling as another word for something.
   *
   * Exact match only. A synonym declaration is a claim about a whole word, and prefix-matching it
   * would turn "the word you typed is a name for this" into "a word starting how you typed might be".
   *
   * Postings are {id, sense} rather than bare ids, so a caller that wants to explain the row can say
   * which meaning did the naming. */
  function synonymTierMatches(tier, key) {
    if (!tier || !tier.spellings) return [];
    var i = lowerBound(tier.spellings, key);
    if (i >= tier.spellings.length || tier.spellings[i] !== key) return [];
    var postings = tier.postings[key] || [];
    var out = [];
    for (var j = 0; j < postings.length; j++) out.push([postings[j].id, SYNONYM_TIER_SCORE]);
    return out;
  }

  /** Entry ids, best first: the three whole-string tiers and the dialect tier are absolute, then
   * prefix, the synonym tier and English compete on score. */
  function rankQuery(index, components, query, limit, helpers) {
    var trimmed = query.trim();
    if (!trimmed) return [];
    var y = index.yoruba;
    var seen = new Set();
    var ordered = [];
    var push = function (ids) {
      for (var i = 0; i < ids.length; i++) {
        if (!seen.has(ids[i])) { seen.add(ids[i]); ordered.push(ids[i]); }
      }
    };

    push(exactMatch(y.exact, trimmed));
    push(exactMatch(y.tone, helpers.toneInsensitive(trimmed)));
    push(exactMatch(y.ortho, helpers.orthographyInsensitive(trimmed)));
    push(helpers.dialectIds || []);

    var soft = new Map();
    var offer = function (pairs) {
      for (var i = 0; i < pairs.length; i++) {
        var id = pairs[i][0], score = pairs[i][1];
        if (seen.has(id)) continue; // a hard match already claimed it
        if (!soft.has(id) || soft.get(id) < score) soft.set(id, score);
      }
    };
    offer(prefixMatches(y.ortho, helpers.orthographyInsensitive(trimmed), limit));
    // The entry that owns a spelling was already claimed by a hard tier above, and `offer` skips
    // anything `seen`, so a declaring entry can only ever appear BELOW the word itself. That is
    // structural rather than a matter of tuning: searching wì gives wì first and sun (which calls wì
    // another word for "to roast") further down.
    offer(synonymTierMatches(y.synonym, helpers.orthographyInsensitive(trimmed)));
    offer(bm25Search(index.english, components, trimmed, limit, helpers, helpers.out));

    var softList = [];
    soft.forEach(function (score, id) { softList.push([id, score]); });
    softList.sort(function (a, b) { return b[1] - a[1]; });
    push(softList.map(function (pair) { return pair[0]; }));

    return ordered.slice(0, limit);
  }

  return {
    bm25Search: bm25Search,
    prefixMatchScore: prefixMatchScore,
    prefixMatches: prefixMatches,
    exactMatch: exactMatch,
    lowerBound: lowerBound,
    rankQuery: rankQuery,
    synonymTierMatches: synonymTierMatches,
    EXAMPLE_DOC_WEIGHT: EXAMPLE_DOC_WEIGHT,
    SYNONYM_DOC_WEIGHT: SYNONYM_DOC_WEIGHT,
    SYNONYM_TIER_SCORE: SYNONYM_TIER_SCORE,
    PREFIX_SCALE: PREFIX_SCALE,
  };
});
