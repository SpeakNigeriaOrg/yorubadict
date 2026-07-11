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
  return list.map((item) => {
    // Tell the linker to ignore our external escape hatch!
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

function normalizeGlossWords(text) {
  return new Set(
    (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );
}

// How well a candidate entry's own sense glosses overlap with the
// morpheme's own gloss text - used to break ties among entries that are
// exact spelling/tone matches (true homographs, e.g. 3 senses of "gbà"),
// where spelling alone can't say which one an etymology template meant.
function glossOverlapScore(morphemeGloss, entry) {
  if (!morphemeGloss) return 0;
  const mWords = normalizeGlossWords(morphemeGloss);
  let best = 0;
  for (const sense of entry.senses || []) {
    for (const gloss of sense.glosses || []) {
      let overlap = 0;
      for (const w of normalizeGlossWords(gloss)) if (mWords.has(w)) overlap++;
      if (overlap > best) best = overlap;
    }
  }
  return best;
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

  // Resolve free-standing etymology morphemes the same way - a bound
  // morpheme (à-, ẹ-) is never looked up, since it can't meaningfully
  // match a real headword; it's tagged unresolved directly rather than
  // via a failed alias lookup.
  for (const entry of entries) {
    entry.etymologyMorphemes = (entry.etymologyMorphemes || []).map((m) => {
      if (m.bound) return { ...m, resolved: false, entryIds: [] };
      const matches = aliasIndex.get(m.form);
      if (!matches || matches.size === 0) return { ...m, entryIds: [], resolved: false };
      const all = [...matches];
      // A morpheme's spelling frequently coincides with another entry's
      // raw, untoned Wiktionary headword (the page titled "mọ" is also
      // indexed here even though its real canonical spelling is "mọ̀" or
      // "mọ́") - an entry whose OWN canonical spelling exactly matches
      // must always win over one that only matched via that looser
      // headword/alt-form alias, confirmed as a real, common mislink
      // pattern (585/4,931 real morpheme resolutions pick a cross-tone
      // wrong entry without this).
      const exact = all.filter((id) => byId.get(id)?.canonicalForm.value === m.form);
      const chosen = exact.length > 0 ? exact : all;
      // Among exact spelling ties (true homographs, e.g. gbà's 3 senses),
      // prefer whichever candidate's own glosses best overlap with this
      // morpheme's gloss - a stable sort, so untied candidates keep their
      // current order.
      const ranked = chosen.length > 1
        ? [...chosen].sort((a, b) => glossOverlapScore(m.gloss, byId.get(b)) - glossOverlapScore(m.gloss, byId.get(a)))
        : chosen;
      return { ...m, entryIds: ranked, resolved: true };
    });
  }

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

  // Reciprocal "used in": if entry A's etymology decomposes to include
  // entry B as a free-standing component, B's own page should show A as
  // something it's a building block for - this is the etymology-morpheme
  // analogue of the derivedTerms -> derivedFrom reciprocal above, just not
  // covered by RECIPROCAL_TYPE since etymologyMorphemes didn't exist yet
  // when that loop was written.
  for (const entry of entries) {
    for (const m of entry.etymologyMorphemes || []) {
      if (m.bound || !m.resolved) continue;
      for (const targetId of m.entryIds) {
        const target = byId.get(targetId);
        if (!target) continue;
        target.usedInCompounds = target.usedInCompounds || [];
        const already = target.usedInCompounds.some((u) => u.entryId === entry.id);
        if (!already) {
          target.usedInCompounds.push({
            entryId: entry.id,
            text: entry.canonicalForm.value,
            provenance: 'synthesized_from_etymology',
          });
        }
      }
    }
  }

  return { entries, unresolved, aliasIndex };
}
