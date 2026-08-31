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
  // A word inside a multi-word entry. 480 of 6,273 entries are phrases, and
  // each was only ever indexed whole, so searching ṣeun found nothing at all
  // while o ṣeun and ẹ ṣeun both contain it. Soft, and below a synonym: the
  // query is a part of the entry's name rather than the name, so it must never
  // outrank an entry that really is spelled that way.
  var WORD_TIER_SCORE = 8;

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

  /** A meaning reached because this entry's ADDRESS is named after the query.
   *
   * Every entry's web address carries one English word distilled from its definition by a model
   * (/yo/ibanuje/sadness). Second-hand evidence about meaning, like an inherited synonym, so it
   * sits at the same weight for the same reason.
   *
   * It cannot displace anything, and that is structural rather than tuned: an entry scores as its
   * BEST document, so a one-word document can only lift an entry that had nothing better. Measured
   * over the 400 most common definition clauses - no top result moves, no former top-five leaves
   * the top ten, 22 queries gain a result that was unreachable before. Safe up to 0.6; at 1.0 ten
   * top results move and nine top-fives fall out, which is where it stops being free. */
  var SLUG_DOC_WEIGHT = 0.4;

  /** How much of a match a partially-typed English word is.
   *
   * The Yoruba tiers have always done this - type `iban` and the sorted spelling list finds
   * ibanuje - but the English half looked its tokens up in a hash table, so `sadnes` found
   * nothing and `sad` could not reach ìbànújẹ́ ("sadness, depression"). A partial spelling is
   * weaker evidence than the word itself, and 0.4 is the same notch as a declared synonym for
   * the same reason: it is a guess about which word was meant.
   *
   * Scaled again by how much of the word the query covers, the same idea prefixMatchScore
   * applies on the Yoruba side, so `sadnes` -> `sadness` counts for far more than `sad` does. */
  var PARTIAL_TOKEN_WEIGHT = 0.4;

  /** Below this a query token is too short to guess from: two letters prefix half the dictionary. */
  var MIN_PARTIAL_LENGTH = 3;

  /** A cap on how many words one query token may expand to. Real fan-out is small - `sad` reaches
   * 4, `walk` 4, `eye` 10, and the worst measured over the corpus is `ru` at 35 - but a stub
   * should not walk the vocabulary. */
  var MAX_TOKEN_EXPANSIONS = 12;

  /** The reverse direction: an indexed word that STARTS the query, so `walking` reaches a
   * definition reading "to walk" and `runs` reaches "to run". Longer than the forward minimum,
   * because a short indexed word is the start of a great many longer ones. */
  var MIN_REVERSE_LENGTH = 4;

  function prefixMatchScore(queryLength, formLength) {
    if (formLength <= 0) return 0;
    return (queryLength / formLength) * PREFIX_SCALE;
  }

  /** The indexed words a query token should score against, each with what it is worth.
   *
   * The token itself at full weight, then the words it is a prefix of, then the one word that is
   * a prefix of IT. Everything partial is damped by PARTIAL_TOKEN_WEIGHT and by coverage, so an
   * exact hit always beats a guess and a near-complete guess beats a bare stub.
   *
   * Query time only. Nothing here adds a document, so df, totalDocs and avgDocLength are the same
   * numbers they were - which is what makes this provably inert for a query whose tokens expand to
   * nothing but themselves, and keeps the frozen-corpus invariants in check-search-agreement.mjs
   * true as written. */
  function expandToken(english, token) {
    var out = [];
    if (english.postings[token]) out.push([token, 1]);

    var tokens = english.tokens;
    // An index built before the sorted token list existed. Exact matching only, as before.
    if (!tokens || token.length < MIN_PARTIAL_LENGTH) return out;

    var start = lowerBound(tokens, token);
    var found = 0;
    for (var i = start; i < tokens.length && found < MAX_TOKEN_EXPANSIONS; i++) {
      var longer = tokens[i];
      if (longer.indexOf(token) !== 0) break;
      if (longer === token) continue;
      out.push([longer, PARTIAL_TOKEN_WEIGHT * (token.length / longer.length)]);
      found++;
    }

    // Walking back from the same point reaches the token's own prefixes in decreasing length, so
    // the first one that matches is the longest and there is no reason to keep looking. Bounded
    // because a token with no prefix in the index would otherwise scan to the start of the array.
    for (var j = start - 1; j >= 0 && j > start - 64; j--) {
      var shorter = tokens[j];
      if (shorter.length < MIN_REVERSE_LENGTH) continue;
      if (token.indexOf(shorter) === 0) {
        out.push([shorter, PARTIAL_TOKEN_WEIGHT * (shorter.length / token.length)]);
        break;
      }
    }

    return out;
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
    // Likewise for the distilled address word. Absent in an older index, in which case every
    // document at or past inheritedStart really is inherited and this test never fires.
    var slugStart = english.slugDocStart === undefined ? Infinity : english.slugDocStart;

    var tokens = tokenizeQuery(query);
    if (tokens.length === 0) return [];

    // Each query token stands for itself and for the words it is a partial spelling of. The idf is
    // the MATCHED word's, not the typed one's: "sadnes" is not a word the corpus has ever seen, and
    // what makes ìbànújẹ́ the answer is that "sadness" occurs exactly once.
    var docScores = new Map();
    for (var t = 0; t < tokens.length; t++) {
      var variants = expandToken(english, tokens[t]);
      // Documents where the typed word appears exactly. A partial spelling is a guess about which
      // word was meant, and there is nothing to guess in a definition that already contains the
      // word - so a partial match never stacks on top of an exact one WITHIN THE SAME DOCUMENT.
      // Without this, "house" scores ulé ("home, house, household") twice, once for house and
      // again for household, and a dialect form overtakes the definitions that just say house.
      // expandToken always yields the exact match first, so this set is complete before any
      // partial is scored.
      var exactDocs = null;
      for (var v = 0; v < variants.length; v++) {
        var tok = variants[v][0];
        var termWeight = variants[v][1];
        var isExact = tok === tokens[t];
        var postings = english.postings[tok];
        if (!postings) continue;
        if (isExact) exactDocs = new Set();
        var df = english.df[tok] || postings.length;
        var idf = Math.log(1 + (english.totalDocs - df + 0.5) / (df + 0.5));
        for (var j = 0; j < postings.length; j++) {
          var docIdx = postings[j][0];
          if (isExact) exactDocs.add(docIdx);
          else if (exactDocs !== null && exactDocs.has(docIdx)) continue;
          var tf = postings[j][1];
          var docLen = english.docLengths[docIdx] || 1;
          var norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / english.avgDocLength)));
          // Four bands, separated by three integers rather than a per-document array: definitions,
          // then example translations, then meanings inherited through a declared synonym, then the
          // one word this entry's own web address is named after.
          var weight = 1;
          if (docIdx >= slugStart) weight = SLUG_DOC_WEIGHT;
          else if (docIdx >= inheritedStart) weight = SYNONYM_DOC_WEIGHT;
          else if (docIdx >= english.glossDocCount) weight = EXAMPLE_DOC_WEIGHT;
          docScores.set(docIdx, (docScores.get(docIdx) || 0) + idf * norm * weight * termWeight);
        }
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
  /** Entries whose multi-word name contains this word. Same shape as the
   *  synonym tier, and offered alongside it. */
  function wordTierMatches(tier, key) {
    if (!tier || !tier.spellings) return [];
    var i = lowerBound(tier.spellings, key);
    if (i >= tier.spellings.length || tier.spellings[i] !== key) return [];
    var postings = tier.postings[key] || [];
    var out = [];
    for (var j = 0; j < postings.length; j++) {
      out.push([postings[j].id !== undefined ? postings[j].id : postings[j], WORD_TIER_SCORE]);
    }
    return out;
  }

  function synonymTierMatches(tier, key) {
    if (!tier || !tier.spellings) return [];
    var i = lowerBound(tier.spellings, key);
    if (i >= tier.spellings.length || tier.spellings[i] !== key) return [];
    var postings = tier.postings[key] || [];
    var out = [];
    for (var j = 0; j < postings.length; j++) out.push([postings[j].id, SYNONYM_TIER_SCORE]);
    return out;
  }

  /** Where a winning document came from, so a caller can show the right meaning and explain the row.
   *
   * Lives here rather than in app.js because it is knowledge about the index, not about the DOM - the
   * three document bands and the two integers that separate them are defined in this file, and a
   * second copy of that arithmetic in the UI is exactly the drift this file exists to prevent.
   *
   *   kind      'definition' | 'example' | 'inherited' | 'distilled'
   *   senseIndex  which of the entry's own meanings the document came from, when that is meaningful
   *   namedBy     [entryId, senseIndex] of the entry whose definition named this word, when inherited
   */
  function matchProvenance(english, docIdx) {
    if (!english || docIdx === undefined || docIdx === null) return null;
    var inheritedStart = english.inheritedDocStart === undefined ? Infinity : english.inheritedDocStart;
    var slugStart = english.slugDocStart === undefined ? Infinity : english.slugDocStart;
    // Tested before inherited, because the distilled band sits above it and would otherwise be
    // read as another entry's words - which would label the row "Another way to say" with nothing
    // to name. The distilled word is drawn from this entry's OWN definition, so the row wants no
    // explanation: showing that definition is already the whole story.
    if (docIdx >= slugStart) {
      var slugSense = (english.docSenseIdx || [])[docIdx];
      return { kind: 'distilled', senseIndex: slugSense === undefined ? null : slugSense, namedBy: null };
    }
    if (docIdx >= inheritedStart) {
      var source = (english.docSource || {})[docIdx];
      // An inherited document carries another entry's words, so it points at no meaning of this
      // entry's own. The label is what explains the row.
      return { kind: 'inherited', senseIndex: null, namedBy: source || null };
    }
    var senseIndex = (english.docSenseIdx || [])[docIdx];
    return {
      kind: docIdx >= english.glossDocCount ? 'example' : 'definition',
      senseIndex: senseIndex === undefined ? null : senseIndex,
      namedBy: null,
    };
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
    offer(wordTierMatches(y.word, helpers.orthographyInsensitive(trimmed)));
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
    wordTierMatches: wordTierMatches,
    matchProvenance: matchProvenance,
    EXAMPLE_DOC_WEIGHT: EXAMPLE_DOC_WEIGHT,
    SYNONYM_DOC_WEIGHT: SYNONYM_DOC_WEIGHT,
    SYNONYM_TIER_SCORE: SYNONYM_TIER_SCORE,
    WORD_TIER_SCORE: WORD_TIER_SCORE,
    PREFIX_SCALE: PREFIX_SCALE,
  };
});
