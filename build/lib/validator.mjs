// build/lib/validator.mjs
//
// Stage 4: Validation. Produces a report describing detected inconsistencies
// in the data. Never modifies entries — purely diagnostic.

export function buildValidationReport(entries, unresolvedRelations, parseErrors) {
  const report = {
    generatedAt: new Date().toISOString(),
    totalEntries: entries.length,
    parseErrors,
    inferredCanonicalForms: [],
    missingIpa: [],
    duplicateNormalizedSpellings: {},
    unknownReferencedWords: unresolvedRelations,
    circularDerivations: [],
  };

  const toneIndex = new Map(); // toneInsensitive spelling -> [ids]

  for (const entry of entries) {
    if (entry.canonicalForm.inferenceMethod !== 'explicit_canonical_tag') {
      report.inferredCanonicalForms.push({
        entryId: entry.id,
        headword: entry.headword,
        method: entry.canonicalForm.inferenceMethod,
        confidence: entry.canonicalForm.confidence,
      });
    }

    if (entry.ipa.length === 0) {
      report.missingIpa.push({ entryId: entry.id, headword: entry.headword });
    }

    const key = entry.forms.toneInsensitive;
    if (!toneIndex.has(key)) toneIndex.set(key, []);
    toneIndex.get(key).push(entry.id);
  }

  for (const [spelling, ids] of toneIndex.entries()) {
    if (ids.length > 1) {
      report.duplicateNormalizedSpellings[spelling] = ids;
    }
  }

  // Circular derivation check: walk derivedTerms graph, flag cycles.
  const byId = new Map(entries.map((e) => [e.id, e]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function visit(id, path) {
    if (visiting.has(id)) {
      cycles.push([...path, id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const entry = byId.get(id);
    if (entry) {
      for (const rel of entry.derivedTerms) {
        if (!rel.resolved) continue;
        for (const targetId of rel.entryIds) {
          visit(targetId, [...path, id]);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const entry of entries) {
    visit(entry.id, []);
  }
  report.circularDerivations = cycles;

  return report;
}
