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

function buildAliasIndex(entries) {
  const index = new Map(); // spelling -> Set(entryId)

  const add = (spelling, id) => {
    if (!spelling) return;
    if (!index.has(spelling)) index.set(spelling, new Set());
    index.get(spelling).add(id);
  };

  for (const entry of entries) {
    add(entry.headword, entry.id);
    add(entry.canonicalForm.value, entry.id);
    for (const alt of entry.altForms) add(alt.form, entry.id);
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

  return { entries, unresolved, aliasIndex };
}
