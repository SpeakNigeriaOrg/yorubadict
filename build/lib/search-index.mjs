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

// Every searchable spelling for an entry - headword, canonical form, and
// each alt form Wiktionary lists (e.g. iná's alt form uná) - each with its
// own exact/toneInsensitive/orthographyInsensitive tiers, all pointing back
// at the same entry. Without this, alt forms (and the raw headword, when it
// differs from the canonical spelling) are real, displayed/resolvable data
// that's simply never findable by search.
function searchableForms(entry) {
  return spellingsForEntry(entry).map(allForms);
}

// Each word of a multi-word entry, so a phrase is findable by any word in it.
//
// 480 of 6,273 entries are phrases and every one was indexed only whole, so
// searching ṣeun returned nothing while both o ṣeun and ẹ ṣeun contain it.
// Orthography-insensitive, matching the loosest whole-string tier, so it works
// with or without tone marks and underdots.
//
// Single-word entries are deliberately absent: they are already found whole by
// the three tiers above, and adding them here would only duplicate postings.
function buildWordTier(entries, formsByEntry) {
  const map = new Map();
  for (const entry of entries) {
    for (const formsObj of formsByEntry.get(entry.id)) {
      const spelling = formsObj.orthographyInsensitive;
      if (!spelling || !spelling.includes(' ')) continue;
      for (const word of spelling.split(/\s+/)) {
        if (word.length < 2) continue; // "o", "a" - every phrase would match
        if (!map.has(word)) map.set(word, new Set());
        map.get(word).add(entry.id);
      }
    }
  }
  const sorted = [...map.keys()].sort();
  return {
    spellings: sorted,
    postings: Object.fromEntries(sorted.map((w) => [w, [...map.get(w)]])),
  };
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
function buildEnglishIndex(entries, inheritedDocs = [], distilledWords = new Map()) {
  const postings = new Map(); // token -> Map(docIdx -> tf)
  /** docIdx -> entryId. The client folds per-document scores back up to one score per entry. */
  const docEntryIds = [];
  const docLengths = [];
  /** docIdx -> which of that entry's senses the document came from.
   *
   * One small integer per document, 1.4 KB brotli for all of them, and it is what
   * lets a result row show the meaning that actually matched instead of the first
   * one. Without it, searching "stomach" finds ikùn and then displays "abdomen,
   * belly", which reads as a mistake. */
  const docSenseIdx = [];
  /** An exact-clause inverted index: "child" -> [docIdx, ...].
   *
   * The bonus for "this gloss IS the query" needs to know a gloss's clauses at query time, and
   * shipping every clause per document would bloat the artifact. Inverting it costs one row per
   * distinct clause instead. */
  const exactClauses = new Map();

  const addDoc = (entryId, tokens, clauses, senseIdx = 0) => {
    if (tokens.length === 0) return;
    const docIdx = docEntryIds.length;
    docEntryIds.push(entryId);
    docLengths.push(tokens.length);
    docSenseIdx.push(senseIdx);
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
  // Glosses keep stopwords. They are short, curated definitions, not free prose: for a real Yoruba
  // conjunction or demonstrative the entire correct definition can just be "that"/"this"/"and"/"or"
  // (confirmed: 10 real entries corpus-wide), so stopword-filtering there makes those words
  // permanently unsearchable by their own meaning. It stays correct for example translations, which
  // are genuine natural-language prose where stopwords really are noise.
  //
  // rawGlosses are NOT indexed, though they were until this was measured. They are the same string
  // with a grammar-tag prefix - "(transitive, intransitive) to pull" against "to pull" - so indexing
  // both gave every sense two near-identical documents (glossDocCount was 16,326 for 8,162 gloss
  // strings, exactly 2x) and doubled the postings payload for nothing. Worse, it made grammar
  // metadata searchable as if it were meaning: clausesOfGloss strips parenthesis characters but not
  // their contents, so "(transitive) to buy" yielded the clause "transitive", which then earned the
  // full exact-clause bonus. Querying "transitive" returned rà, lọ̀ and gbò.
  for (const entry of entries) {
    entry.senses.forEach((sense, senseIdx) => {
      for (const gloss of sense.glosses || []) {
        addDoc(entry.id, tokenize(gloss, { keepStopwords: true }), clausesOfGloss(gloss), senseIdx);
      }
    });
  }
  const glossDocCount = docEntryIds.length;

  for (const entry of entries) {
    entry.senses.forEach((sense, senseIdx) => {
      for (const ex of sense.examples) {
        if (ex.translation) addDoc(entry.id, tokenize(ex.translation), [], senseIdx);
      }
    });
  }

  // ------------------------------------------------------------------
  // The corpus statistics are frozen HERE, before inherited documents.
  // ------------------------------------------------------------------
  // This is a correctness requirement, not an optimization. BM25 divides by
  // avgDocLength and weighs a token by how rare it is across totalDocs, so
  // appending documents changes the score of every query - including queries with
  // no synonym evidence at all, which should be untouched by this feature.
  //
  // Measured: appending the 1,793 inherited documents at WEIGHT ZERO, pure
  // statistical perturbation with no synonym scoring whatsoever, still moved the
  // top result for one of 400 test queries and pushed 25 entries into a top-ten
  // slot, because avgDocLength fell from 6.045 to 5.877 and every df inflated.
  // Frozen, the feature is provably inert for any query it has nothing to say
  // about, which is what makes the agreement fixture meaningful rather than lucky.
  const totalDocs = docEntryIds.length;
  const totalLength = docLengths.reduce((a, b) => a + b, 0);
  const avgDocLength = totalDocs > 0 ? totalLength / totalDocs : 0;
  const df = {};
  for (const [tok, docMap] of postings.entries()) df[tok] = docMap.size;

  // INHERITED documents: a meaning reached because some other entry's definition
  // named this word as another way to say it. Third band, after glosses and
  // examples, so one more integer separates it and the client can weigh it.
  //
  // clausesOfGloss is deliberately NOT called, so nothing here can enter
  // exactClauses and earn the exact-clause bonus. That bonus means "this word IS
  // the query", and inherited text never says that - it says a word this word is
  // a synonym of is the query. The difference is not theoretical: oṣù ("month") is
  // a declared synonym of òṣùpá ("moon"), and letting it take the +2 for the
  // clause "moon" put month ahead of the actual word for moon, breaking the
  // fixture's own flagship assertion.
  const inheritedDocStart = docEntryIds.length;
  const docSource = {};
  for (const doc of inheritedDocs) {
    const tokens = tokenize(doc.gloss, { keepStopwords: true });
    if (tokens.length === 0) continue;
    docSource[docEntryIds.length] = [doc.sourceId, doc.sourceSenseIndex];
    // Sense 0 for display: the source named the whole word, not one of its meanings, so
    // there is nothing to point at. The row label is what explains an inherited hit.
    addDoc(doc.targetId, tokens, [], 0);
  }

  // DISTILLED-WORD documents: the one English word this entry's web address is named
  // after, chosen from its definition by a model and written down in data/url-slugs.json.
  // ìbànújẹ́ is /yo/ibanuje/sadness, so it gets a one-word document reading "sadness".
  //
  // Fourth band, after inherited, so a third integer separates it and the client can weigh it.
  // Appended after the freeze above for the same reason everything else is: this must not move
  // a query it has nothing to say about.
  //
  // It cannot disturb a working search, and that is a property of the scorer rather than a guard
  // added here: an entry scores as its BEST document, never the sum, so a one-word document at
  // weight 0.4 can only lift an entry that had nothing better - it can never raise one that
  // already matched on its own definition. Measured over the 400 most common definition clauses:
  // no top result moves, no former top-five leaves the top ten, and 22 queries gain an entry in
  // the top ten that could not be reached at all before (misery -> àre, redden -> pupa,
  // mama -> èyé, approach -> wín).
  //
  // clausesOfGloss is deliberately not called, exactly as for the inherited band: the +2 bonus
  // means "this word IS the query", and 2,683 distilled words are already a whole clause of the
  // entry's own definition, so letting them in would pay that bonus twice for the same evidence.
  //
  // Most of what this says is already said: for 5,527 of 6,273 entries every token of the
  // distilled word is in the entry's own definitions. The 746 that are not are the point.
  const slugDocStart = docEntryIds.length;
  for (const entry of entries) {
    const word = distilledWords.get(entry.id);
    if (!word) continue;
    addDoc(entry.id, tokenize(word, { keepStopwords: true }), [], 0);
  }

  const postingsOut = {};
  for (const [tok, docMap] of postings.entries()) {
    postingsOut[tok] = [...docMap.entries()];
    // A token that occurs ONLY in inherited documents has no frozen df, and
    // idf would divide by zero-ish. Measured over the corpus there are none -
    // every inherited word already appears in some entry's own definition, which
    // makes sense given the text is another entry's definition - but a synthetic
    // df of 1 keeps it findable and finite rather than relying on that holding.
    if (df[tok] === undefined) df[tok] = 1;
  }

  return {
    postings: postingsOut,
    df,
    docEntryIds,
    docLengths,
    docSenseIdx,
    avgDocLength,
    totalDocs,
    /** Documents below this index are glosses; at or above it, example translations. */
    glossDocCount,
    /** Documents at or above this index are inherited from a declared synonym. */
    inheritedDocStart,
    /** Documents at or above this index are the entry's distilled address word. */
    slugDocStart,
    /** Every token in the index, sorted, so the browser can binary-search for the words a
     * partially-typed query is a prefix of. 8,916 strings, 23 KB brotli - the same structure
     * and the same lookup the Yoruba tiers have had all along, which the English half never
     * got. Without it "sadnes" finds nothing and "sad" cannot reach ìbànújẹ́ ("sadness,
     * depression"), because a query token is an exact hash lookup that silently skips a miss. */
    tokens: [...postings.keys()].sort(),
    /** inherited docIdx -> [entryId that named this word, which of its senses did]. */
    docSource,
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
 * Bound morphemes (prefixes like `a-`) are skipped - they are not words a search should promote.
 *
 * Two passes, because the same relationship is recorded from both ends and neither end sees all
 * of it. `etymologyMorphemes` is what a COMPOUND says about its own parts. `usedInCompounds` is
 * what a ROOT says about the compounds it appears in - and it carries resolved entry ids rather
 * than spellings, so attributeUsedIn could settle a link that the compound's own morpheme list
 * left as an unresolved form. Folding the second into the first costs no shape change: "R is a
 * part of C" is the same claim whichever side wrote it down.
 *
 * Measured over the corpus: 3,340 of the 3,374 usedInCompounds links are already visible through
 * the first pass, so this adds 34 (pópó -> òpópónà, ire -> Adédure, hóró -> wóróbo). Small today,
 * and it grows with upstream etymology coverage rather than needing this file to change again.
 *
 * possiblyUsedIn is deliberately NOT folded in. Its 1,757 links are the ones attributeUsedIn
 * could not settle (confidence meaningTied or noMeaning), and measured over 400 queries adding
 * them changes nothing at all - so they would be a second, weaker source of truth bought for
 * no gain. */
function buildComponentIndex(entries) {
  const out = {};
  const add = (entryId, form) => {
    const key = allForms(form || '').orthographyInsensitive;
    if (!key) return;
    if (!out[entryId]) out[entryId] = [];
    if (!out[entryId].includes(key)) out[entryId].push(key);
  };

  for (const entry of entries) {
    for (const morpheme of entry.etymologyMorphemes || []) {
      if (!morpheme || morpheme.bound || !morpheme.form) continue;
      add(entry.id, morpheme.form);
    }
  }

  // The same spelling the root bonus will look this entry up by - see keyOf in
  // english-relevance.js. A different choice here would record a part nothing can match.
  const formOf = (entry) => (entry.canonicalForm ? entry.canonicalForm.value : entry.headword);
  for (const entry of entries) {
    for (const item of entry.usedInCompounds || []) {
      if (!item || !item.entryId) continue;
      add(item.entryId, formOf(entry));
    }
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

// A definition that only points at another entry says nothing about meaning, so
// it must not be inherited: ìgò ("bottle") is a declared synonym of a word whose
// first definition is "alternative form of koríko (grass, weed)", and inheriting
// that would make ìgò findable by "grass".
const META_DEFINITION = /^(alternative (form|spelling)|obsolete form|misspelling|archaic spelling|dated form) of\b/i;

// What a declared synonym is worth to search, in two quite different ways.
//
// A sense saying "another word for this meaning is X" supports two claims, and
// which one applies depends entirely on whether X has an entry of its own:
//
//   X has no entry (1,836 items) - then searching X finds nothing today, and the
//     useful answer is the entry that named it. That is the synonym TIER.
//   X has an entry (2,739 items) - then searching X already finds X, and what is
//     new is that X's page can be reached by what the NAMING sense means. That is
//     INHERITED English.
//
// Both directions come from the same pass, and every item feeds the tier while
// only some feed inheritance, because the tier's posting is the declaring entry -
// never ambiguous - while inheritance puts meaning onto another word's page and
// has to be much more careful about which word.
//
// No debris filter here. kaikki-yoruba's classifyRelationList drops flattened
// dialect tables whole before publishing, and measured against the shipped
// artifact nothing survives it: 0 of 4,575 items look like a variety name, a
// family label or a bare dash. A second filter on this side would be dead code
// pretending to be a safeguard.
function senseSynonymData(entries, byId) {
  const tier = new Map(); // key -> Map(declaringEntryId -> senseIndex)
  const inherited = [];
  const seenDoc = new Set();
  const report = {
    items: 0,
    tierKeys: 0,
    unresolvedToTier: 0,
    inheritedDocs: 0,
    skippedAmbiguous: 0,
    skippedProperName: 0,
    skippedMetaDefinition: 0,
    skippedForeign: 0,
  };

  for (const entry of entries) {
    (entry.senses || []).forEach((sense, senseIndex) => {
      for (const rel of sense.synonyms || []) {
        report.items += 1;
        if (rel.foreign) {
          report.skippedForeign += 1;
          continue;
        }

        // Behaviour 1, for every item. Keyed orthography-insensitively, like the
        // dialect tier and for the same reason: someone recalling a word they
        // heard called a synonym is the least likely to have the tone marks.
        const key = allForms(rel.text || '').orthographyInsensitive;
        if (key) {
          if (!tier.has(key)) tier.set(key, new Map());
          // One posting per (key, declaring entry) however many of its meanings
          // agree, and the first meaning wins so the label is stable.
          if (!tier.get(key).has(entry.id)) tier.get(key).set(entry.id, senseIndex);
          if (!rel.resolved) report.unresolvedToTier += 1;
        }

        // Behaviour 2, for the items that have somewhere to put the meaning.
        if (!rel.resolved) continue;

        // A spelling shared by several entries says nothing about which is meant,
        // and fanning the meaning out to all of them is how "iye" (value, price)
        // came to be findable by "mother". One candidate is enough; so is a
        // candidate the meaning itself picked out, which is strictly better
        // evidence than first-of-N and adds 419 documents.
        const method = (rel.resolution || {}).method;
        if (rel.entryIds.length > 1 && method !== 'glossOverlap') {
          report.skippedAmbiguous += 1;
          continue;
        }
        const target = byId.get(rel.entryIds[0]);
        if (!target) continue;
        // A place or a person does not acquire a meaning by being listed as
        // someone's synonym.
        if (target.pos === 'name') {
          report.skippedProperName += 1;
          continue;
        }

        // The document carries the NAMING meaning, attached to the named word.
        // The direction is easy to get backwards, and backwards is useless:
        // indexing the target's own definitions under the target just re-indexes
        // what is already there. oro means "venom, poison, sting" and calls
        // majele another word for it, so majele gets a document reading "venom,
        // poison, sting" - and becomes findable by "venom", which its own
        // definition ("poison") never says.
        for (const gloss of sense.glosses || []) {
          // A definition that only points at another entry says nothing about
          // meaning, so it has nothing to pass on.
          if (META_DEFINITION.test(gloss)) {
            report.skippedMetaDefinition += 1;
            continue;
          }
          // Several sources naming one target is fine and common - one word here
          // is named by eight - but two of them offering the same text must not
          // become two documents, because that is a document count, not evidence.
          const dedupe = `${target.id} ${gloss}`;
          if (seenDoc.has(dedupe)) continue;
          seenDoc.add(dedupe);
          inherited.push({
            targetId: target.id,
            sourceId: entry.id,
            sourceSenseIndex: senseIndex,
            gloss,
          });
        }
      }
    });
  }

  report.tierKeys = tier.size;
  report.inheritedDocs = inherited.length;
  return { tier, inherited, report };
}

// The synonym tier: searching a word some entry calls a synonym also finds that
// entry. Today "yan" finds nothing, though sun's "to roast" names it.
//
// Unlike buildDialectTier this does NOT skip keys the ortho tier already
// resolves, and that is the point rather than an oversight. Skipping them would
// keep the yan case and lose the 1,383 keys that collide with a real spelling -
// jó, wì, gún - which is precisely where "the word you typed is also a name for
// this other word" has something to say. The entry that owns the spelling is
// claimed by a hard tier first and cannot be displaced (see rankQuery), so the
// declaring entry can only ever appear below it.
function buildSynonymTier(tier) {
  const spellings = [...tier.keys()].sort();
  return {
    spellings,
    postings: Object.fromEntries(
      spellings.map((key) => [
        key,
        [...tier.get(key).entries()].map(([id, sense]) => ({ id, sense })),
      ])
    ),
  };
}

// The spellings of words two or more entries name as a similar word, and which
// this dictionary has no entry for. Small on purpose - 156 keys - because it
// rides along in the search index for two jobs that both need it before any
// detail is fetched: turning a dead-end pill into a link, and putting a row at
// the end of a search that would otherwise find nothing. The naming entries and
// their meanings live in mentioned-words.json, loaded only when a page is opened.
function buildMentionedIndex(mentionedWords) {
  const byKey = {};
  for (const word of mentionedWords) {
    const key = allForms(word.text).orthographyInsensitive;
    if (key && !byKey[key]) byKey[key] = word.text;
  }
  return { byKey };
}

/** The English word an entry's address is named after: /yo/ibanuje/sadness -> "sadness".
 *
 * Read off entry.path rather than the ledger, though the ledger is where it is written down.
 * attachAddresses runs before this and has already resolved every entry to exactly one address,
 * including the provisional rule-derived names it invents for entries the ledger has never seen -
 * so path is the settled answer, and reading the ledger a second time here would be a second
 * opinion that could disagree with the pages actually on disk.
 *
 * Hyphens become spaces because an address cannot hold one: `mad-person` is two words that were
 * folded into one segment by foldWord, and the index wants them back as two tokens. */
function distilledWordsByEntry(entries) {
  const out = new Map();
  for (const entry of entries) {
    const segments = (entry.path || '').split('/');
    const word = segments.length === 4 ? segments[3] : '';
    if (word) out.set(entry.id, word.replace(/-/g, ' '));
  }
  return out;
}

export function buildSearchIndex(entries, mentionedWords = []) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const synonymData = senseSynonymData(entries, byId);
  const formsByEntry = new Map(entries.map((e) => [e.id, searchableForms(e)]));
  const ortho = buildSortedTierIndex(entries, 'orthographyInsensitive', formsByEntry);
  return {
    yoruba: {
      exact: buildSortedTierIndex(entries, 'exact', formsByEntry),
      tone: buildSortedTierIndex(entries, 'toneInsensitive', formsByEntry),
      ortho,
      dialect: buildDialectTier(entries, ortho),
      synonym: buildSynonymTier(synonymData.tier),
      word: buildWordTier(entries, formsByEntry),
    },
    english: buildEnglishIndex(entries, synonymData.inherited, distilledWordsByEntry(entries)),
    components: buildComponentIndex(entries),
    mentioned: buildMentionedIndex(mentionedWords),
    synonymReport: synonymData.report,
  };
}
