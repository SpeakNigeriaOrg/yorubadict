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

    const matches = aliasIndex.get(item.text);
    if (matches && matches.size > 0) {
      return { ...item, entryIds: [...matches], resolved: true };
    }
    
    unresolvedLog.push({ sourceEntryId: sourceId, relationType, text: item.text });
    return { ...item, entryIds: [], resolved: false };
  });
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
  for (const entry of entries) {
    for (const [field, reciprocalField] of Object.entries(RECIPROCAL_TYPE)) {
      for (const rel of entry[field]) {
        if (!rel.resolved) continue;
        for (const targetId of rel.entryIds) {
          const target = byId.get(targetId);
          if (!target) continue;
          target.synthesizedRelations = target.synthesizedRelations || [];
          const already =
            target.synthesizedRelations.some(
              (r) => r.entryId === entry.id && r.type === reciprocalField
            ) ||
            (target[field] || []).some((r) => r.resolved && r.entryIds.includes(entry.id));
          if (!already) {
            target.synthesizedRelations.push({
              type: reciprocalField,
              entryId: entry.id,
              text: entry.canonicalForm.value,
              provenance: 'synthesized',
            });
          }
        }
      }
    }
  }

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
