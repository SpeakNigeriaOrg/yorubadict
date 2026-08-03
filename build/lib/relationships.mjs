// build/lib/relationships.mjs
//
// Stage 3: Relationship synthesis. Wiktionary/Kaikki relationships are
// spellings, not stable references, and are frequently asymmetric (a lists
// b as "derived" but b has no back-reference to a). This stage:
//
//   1. Builds an alias index: spelling -> [entry ids] (a spelling may be
//      shared by several homographs / etymologies, e.g. "de" x5).
//   2. Resolves every relation list's free-text "word" against that index.
//   3. Synthesizes reciprocal links so relationships are navigable in both
//      directions, tagging them with provenance so the UI (and anyone
//      auditing the data) can tell "the dictionary said this" apart from
//      "we inferred this."

import { spellingsForEntry } from './orthography.mjs';

function buildAliasIndex(entries) {
  const index = new Map(); // spelling -> Set(entryId)

  const add = (spelling, id) => {
    if (!spelling) return;
    if (!index.has(spelling)) index.set(spelling, new Set());
    index.get(spelling).add(id);
  };

  for (const entry of entries) {
    for (const spelling of spellingsForEntry(entry)) add(spelling, entry.id);
  }

  return index;
}

function resolveList(list, aliasIndex, unresolvedLog, relationType, sourceId) {
  return (list || []).map((item) => {
    // Older releases (before kaikki-yoruba imported the dialect tables from
    // source) put a synthetic escape-hatch item in place of a flattened table.
    // Tolerated so an older artifact still builds; nothing emits it now.
    if (item.type === 'external_link') {
      return { ...item, resolved: true, entryIds: [] };
    }

    // A descendant is by definition a word in another language - every one of
    // the 317 in the corpus carries a non-Yoruba langCode. Matching them
    // against a Yoruba-only alias index can only ever produce a false
    // positive: English "dodo" and Nigerian Pidgin "dodo" were each resolving
    // to all 8 Yoruba "dòdò" homographs, rendering 16 Yoruba pills where the
    // data says "English: dodo". The rest failed to match and were logged as
    // missing Yoruba entries, which they were never going to be - 255 of the
    // report's "unknown referenced words" were this.
    if (item.langCode && item.langCode !== 'yo') {
      return { ...item, entryIds: [], resolved: false, foreign: true };
    }

    const matches = aliasIndex.get(item.text);
    if (matches && matches.size > 0) {
      return { ...item, entryIds: [...matches], resolved: true };
    }

    unresolvedLog.push({ sourceEntryId: sourceId, relationType, text: item.text });
    return { ...item, entryIds: [], resolved: false };
  });
}

// Entries sharing an exact, tone-marked spelling are the same written word
// with different senses; entries differing only in tone are different words
// entirely. So this groups on forms.exact and never on a normalized form -
// putting "gbà" and "gbá" in one group would teach the opposite of how Yoruba
// works. 1,161 entries (18.5%) have at least one sibling.
function attachSiblings(entries) {
  const byExact = new Map();
  for (const entry of entries) {
    const key = entry.forms.exact;
    if (!byExact.has(key)) byExact.set(key, []);
    byExact.get(key).push(entry);
  }

  for (const group of byExact.values()) {
    if (group.length < 2) continue;
    // Stable, meaningful order: etymology number when Wiktionary gave one,
    // then part of speech, so the list reads the same way the source page does.
    const ordered = [...group].sort((a, b) => {
      const na = Number(a.etymologyNumber) || Infinity;
      const nb = Number(b.etymologyNumber) || Infinity;
      if (na !== nb) return na - nb;
      return (a.pos || '').localeCompare(b.pos || '');
    });
    for (const entry of ordered) {
      entry.siblingEntryIds = ordered.filter((e) => e.id !== entry.id).map((e) => e.id);
    }
  }
}

// Did the etymology's own meaning for a morpheme actually pick one of the
// entries that share its spelling, or are we about to link to whichever came
// first? The UI needs the difference: telling a reader "the etymology doesn't
// say which one this is" while the pill beside it prints the meaning the
// etymology gave reads as a contradiction, and it's untrue for 934 of the
// 1,707 pills that have more than one candidate.
//
// nìtorí is the whole argument in one entry. Its etymology decomposes to
// ní ("on, at") + ti ("of") + orí ("head, reason"), and it also carries a
// shorter decomposition whose morphemes have no meanings at all. The bare
// "ní" ranks the Latin-letter-N entry first; the "ní" glossed "on, at" ranks
// the preposition first. Same spelling, same page - the meaning is doing real
// work, and only the bare one is a guess.
//
// Recomputed here rather than trusting the upstream ordering, so the pick and
// the claim we make about it always come from the same comparison.
function annotateMorphemeConfidence(entries, byId) {
  for (const entry of entries) {
    for (const m of entry.etymologyMorphemes || []) {
      const ids = (m.entryIds || []).filter((id) => byId.has(id));
      if (ids.length < 2) continue;

      const winner = pickByDiscriminatingMeaning(m.gloss, ids, byId);
      m.chosenEntryId = winner || ids[0];
      // 'meaning'      - the etymology said what it means and that settled it
      // 'noMeaning'    - the etymology never said, so this is whichever came first
      // 'meaningTied'  - it said, but the meaning fits several of them equally
      m.chosenBy = winner ? 'meaning' : m.gloss ? 'meaningTied' : 'noMeaning';
    }
  }
}

function meaningWords(text) {
  return new Set(
    (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );
}

function entryMeaningWords(entry) {
  const words = new Set();
  for (const sense of entry.senses || []) {
    for (const gloss of sense.glosses || []) {
      for (const w of meaningWords(gloss)) words.add(w);
    }
  }
  return words;
}

// Which candidate does a recorded meaning actually point at?
//
// Word overlap alone can't answer that, and the two obvious tokenizers both
// get it wrong in opposite directions. Filtering short words (as the dialect
// matcher does) throws away "on, at", which is the entire meaning of the
// preposition ní. Keeping everything (as the upstream ranker does) lets "to"
// match every verb in the language, so "to beat" scores against all five gbá
// entries equally and the tie looks like a match.
//
// The fix needs no stopword list, which is just as well - one would have to
// be maintained by hand and would be wrong for a dictionary where "at" is a
// definition rather than a filler. A word is only evidence if it fails to
// appear in some candidate: "to" is in all five gbá glosses so it separates
// nothing and drops out, while "at" appears in only one of the four ní
// entries and therefore means something. Self-tuning, and it says no exactly
// when the candidates really are indistinguishable on the text we have.
function pickByDiscriminatingMeaning(meaning, ids, byId) {
  if (!meaning || ids.length < 2) return null;
  const query = meaningWords(meaning);
  if (!query.size) return null;

  const candidateWords = ids.map((id) => entryMeaningWords(byId.get(id)));
  for (const word of [...query]) {
    if (candidateWords.every((words) => words.has(word))) query.delete(word);
  }
  if (!query.size) return null;

  let best = 0;
  let winner = null;
  let tied = false;
  ids.forEach((id, i) => {
    let score = 0;
    for (const w of query) if (candidateWords[i].has(w)) score++;
    if (score > best) {
      best = score;
      winner = id;
      tied = false;
    } else if (score === best && score > 0) {
      tied = true;
    }
  });
  return best > 0 && !tied ? winner : null;
}

// The gloss the etymology attaches to one specific spelling. Deliberately not
// "the first quoted gloss in etymologyText": for the ì-/à- nominalizations
// that make up most of the ambiguous cases, the first gloss belongs to the
// prefix ("nominalizing prefix"), which matches nothing and scores every
// candidate at zero. ìdá's real signal is the *second* gloss, on dá.
function etymologyGlossFor(entry, spelling) {
  for (const m of entry.etymologyMorphemes || []) {
    if (m.form === spelling && m.gloss) return m.gloss;
  }
  const text = entry.etymologyText || '';
  const re = /([^\s(]+)\s*\(\s*["“]([^"”]+)["”]\s*\)/gu;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1] === spelling) return match[2];
  }
  return null;
}

// Which of several identically-spelled roots did this word actually come
// from? One usable signal: the gloss the etymology gives the root, scored
// against each candidate's own definitions.
//
// The etymology-morpheme resolver upstream looks like a second signal and
// isn't one. Its homograph step filters on canonicalForm.value === m.form,
// and forms.exact IS canonicalForm.value for all 6,272 entries, so the set it
// produces is exactly the tone-exact group already grouped on here - measured
// over the whole corpus it narrows a group in 0 cases. What looks like
// disambiguation in the Component words UI is morphemesHtml displaying
// entryIds[0]; the underlying data still holds every candidate. ìdá's "dá"
// morpheme resolves to all 11 dá entries and always did.
//
// A tie or a zero score returns 'ambiguous' and keeps every candidate, which
// is the honest answer: gbígbá's etymology says "to beat" and no gbá entry
// glosses "beat" (sense 5 is "to hit, kick, slap"), so nothing here can or
// should pick one. Its sibling gbígbà resolves cleanly by the same rule.
// Corpus-wide this settles 4 of 24 ambiguous groups - neither crude English
// stemming ("beating" -> "beat") nor scoring the derived word's own gloss
// against the candidates adds a single further resolution, so the remaining
// 20 are surfaced as ambiguous rather than guessed at.
function chooseAmongHomographs(derivedEntry, candidates, byId) {
  if (candidates.length === 1) {
    return { chosen: candidates[0], ordered: candidates, method: 'unique' };
  }

  const spelling = byId.get(candidates[0])?.canonicalForm.value;
  const gloss = spelling ? etymologyGlossFor(derivedEntry, spelling) : null;

  const winner = pickByDiscriminatingMeaning(gloss, candidates, byId);
  if (winner) {
    return {
      chosen: winner,
      ordered: [winner, ...candidates.filter((id) => id !== winner)],
      method: 'glossOverlap',
    };
  }

  return { chosen: candidates[0], ordered: candidates, method: 'ambiguous' };
}

const RECIPROCAL_TYPE = {
  derivedTerms: 'derivedFrom',
  synonyms: 'synonyms',
  antonyms: 'antonyms',
  relatedTerms: 'relatedTerms',
};

export function synthesizeRelationships(entries) {
  const aliasIndex = buildAliasIndex(entries);
  const unresolved = [];
  const byId = new Map(entries.map((e) => [e.id, e]));

  // Resolve every relation list against the alias index.
  for (const entry of entries) {
    for (const field of ['derivedTerms', 'relatedTerms', 'synonyms', 'antonyms', 'descendants']) {
      entry[field] = resolveList(entry[field], aliasIndex, unresolved, field, entry.id);
    }
  }

  // etymologyMorphemes (resolved entryIds) and usedInCompounds arrive
  // already computed by kaikki-yoruba - not this repo's concern anymore
  // (see build/lib/loadEntries.mjs and kaikki-yoruba's own
  // src/lib/morphemeResolution.mjs, where this exact logic - tonal-exact-
  // match preference, gloss-overlap tiebreak, "used in" reciprocal
  // synthesis - now lives, shared with yoruba_student_dict_platform).

  // Synthesize reciprocal links (e.g. if A -> derivedTerms -> B, and B has
  // no reference back to A, add one to B tagged as synthesized).
  //
  // Gathered per target first rather than pushed as they're found, because
  // the case that matters is a target reached by several sources at once:
  // gbígbá is listed as a derived term by all five gbá verbs, and until all
  // five are in hand you can't tell whether that's five distinct roots or one
  // root recorded five times. Pushing eagerly threw that distinction away and
  // rendered five identical pills.
  const pending = new Map(); // targetId -> Map(reciprocalField -> Set(sourceId))

  for (const entry of entries) {
    for (const [field, reciprocalField] of Object.entries(RECIPROCAL_TYPE)) {
      for (const rel of entry[field]) {
        if (!rel.resolved) continue;
        for (const targetId of rel.entryIds) {
          const target = byId.get(targetId);
          if (!target) continue;
          // A word is not derived from itself. Happens when a derived term is
          // also one of the source entry's own alt forms - ẹ̀dọ̀ lists ẹ̀dọ̀ki
          // as derived while carrying ẹ̀dọ̀ki as an alt form, which is the
          // corpus's one "circular derivation".
          if (targetId === entry.id) continue;
          if ((target[field] || []).some((r) => r.resolved && r.entryIds.includes(entry.id))) {
            continue;
          }
          if (!pending.has(targetId)) pending.set(targetId, new Map());
          const byType = pending.get(targetId);
          if (!byType.has(reciprocalField)) byType.set(reciprocalField, new Set());
          byType.get(reciprocalField).add(entry.id);
        }
      }
    }
  }

  for (const [targetId, byType] of pending) {
    const target = byId.get(targetId);
    target.synthesizedRelations = target.synthesizedRelations || [];

    for (const [reciprocalField, sourceIds] of byType) {
      // Group by the source's own spelling and part of speech. Sources in one
      // group are homographs - one word's worth of pill, with the rest
      // reachable behind it. Sources in different groups are genuinely
      // different words (a compound is derived from each of its components)
      // and each keeps its own pill.
      const groups = new Map();
      for (const sourceId of sourceIds) {
        const source = byId.get(sourceId);
        if (!source) continue;
        const key = `${source.forms.exact} ${source.pos || ''}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(sourceId);
      }

      for (const candidates of groups.values()) {
        const { chosen, ordered, method } =
          reciprocalField === 'derivedFrom'
            ? chooseAmongHomographs(target, candidates, byId)
            : {
                chosen: candidates[0],
                ordered: candidates,
                method: candidates.length > 1 ? 'ambiguous' : 'unique',
              };

        target.synthesizedRelations.push({
          type: reciprocalField,
          entryId: chosen,
          entryIds: ordered,
          text: byId.get(chosen).canonicalForm.value,
          provenance: 'synthesized',
          resolution: { method, candidateCount: candidates.length },
        });
      }
    }
  }

  attachSiblings(entries);
  annotateMorphemeConfidence(entries, byId);

  const dialect = synthesizeDialectRelations(entries, aliasIndex, byId);

  return { entries, unresolved, aliasIndex, dialect };
}

// A dialect synonym is a different lexeme used in a place, not another
// spelling of the same word, so its terms deliberately never enter the alias
// index (see spellingsForEntry in orthography.mjs - putting them there would
// make a derivedTerms reference to "ulé" resolve to "ilé" and fabricate
// links). But when a dialect form does have an entry of its own, that entry
// should say so: "Ondo dialect form of orí".
//
// This is kept apart from Wiktionary's own alt-of tagging on purpose. An
// alt-of claims two spellings are the same word; a dialect synonym claims a
// variety uses a different word. Some entries are legitimately both, and then
// both are shown rather than reconciled.
function synthesizeDialectRelations(entries, aliasIndex, byId) {
  const report = {
    entriesWithData: 0,
    sets: 0,
    terms: 0,
    distinctTerms: 0,
    resolvedTerms: 0,
    reciprocals: 0,
    skippedHomograph: 0,
    skippedUnrelatedGloss: 0,
  };
  const seenTerms = new Set();
  // (targetId -> parentId -> varieties): one relation per pair of entries, not
  // one per variety. A short dialect form like "ò" is used by dozens of
  // varieties, and emitting a separate relation for each produced 5,053
  // near-duplicate links.
  const pairs = new Map();

  for (const entry of entries) {
    const sets = entry.dialectSynonyms || [];
    if (sets.length === 0) continue;
    report.entriesWithData += 1;
    report.sets += sets.length;

    for (const set of sets) {
      for (const group of set.groups || []) {
        for (const variety of group.varieties || []) {
          const label = variety.display || variety.name;
          for (const { term } of variety.terms || []) {
            report.terms += 1;
            if (!seenTerms.has(term)) {
              seenTerms.add(term);
              report.distinctTerms += 1;
            }

            const matches = aliasIndex.get(term);
            if (!matches || matches.size === 0) continue;
            report.resolvedTerms += 1;

            // A bare spelling match is weak evidence, and dialect terms are
            // often short. Two guards, both of which the project already
            // applies elsewhere to the same ambiguity:
            //
            //   - a spelling shared by several entries can't say which one is
            //     the dialect form, so claim none of them;
            //   - the survivor must actually mean roughly the same thing.
            //     "ò" resolves to the negation particle, which is not the Àdó
            //     Èkìtì form of "wò" (to look) - it merely shares a spelling.
            if (matches.size > 1) {
              report.skippedHomograph += 1;
              continue;
            }

            const [targetId] = [...matches];
            if (targetId === entry.id) continue;
            const target = byId.get(targetId);
            if (!target) continue;

            if (glossOverlap(set.gloss, target) === 0) {
              report.skippedUnrelatedGloss += 1;
              continue;
            }

            if (!pairs.has(targetId)) pairs.set(targetId, new Map());
            const byParent = pairs.get(targetId);
            if (!byParent.has(entry.id)) {
              byParent.set(entry.id, { text: entry.canonicalForm.value, varieties: new Set() });
            }
            byParent.get(entry.id).varieties.add(label);
          }
        }
      }
    }
  }

  for (const [targetId, byParent] of pairs) {
    const target = byId.get(targetId);
    target.synthesizedRelations = target.synthesizedRelations || [];
    for (const [parentId, { text, varieties }] of byParent) {
      target.synthesizedRelations.push({
        type: 'dialectOf',
        entryId: parentId,
        text,
        varieties: [...varieties],
        provenance: 'synthesized',
      });
      report.reciprocals += 1;
    }
  }

  return report;
}

// Does a dialect set's gloss share any content word with the candidate
// entry's own definitions? Mirrors kaikki-yoruba's glossOverlapScore, which
// breaks the identical kind of homograph tie for etymology morphemes.
function glossOverlap(setGloss, entry) {
  if (!setGloss) return 0;
  const words = new Set(
    setGloss.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2)
  );
  if (words.size === 0) return 0;
  let best = 0;
  for (const sense of entry.senses || []) {
    for (const gloss of sense.glosses || []) {
      let overlap = 0;
      for (const w of gloss.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
        if (words.has(w)) overlap += 1;
      }
      if (overlap > best) best = overlap;
    }
  }
  return best;
}
