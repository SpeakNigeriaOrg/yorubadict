// build/lib/validator.mjs
//
// Stage 4: Validation. Produces a report describing detected inconsistencies
// in the data. Never modifies entries — purely diagnostic.

import { spellingsForEntry, toneInsensitiveForm } from './orthography.mjs';

export function buildValidationReport(entries, unresolvedRelations, parseErrors, dialect = null) {
  const report = {
    generatedAt: new Date().toISOString(),
    totalEntries: entries.length,
    parseErrors,
    inferredCanonicalForms: [],
    missingIpa: [],
    duplicateNormalizedSpellings: {},
    unknownReferencedWords: unresolvedRelations,
    circularDerivations: [],
    // Positive coverage counters for the imported Wiktionary dialect tables -
    // the rest of this report counts problems, but a silent drop in what the
    // dialect import found is just as much a regression as a new problem.
    dialectSynonyms: dialect,
    suspiciousRelationText: [],
  };

  // Diagnostics only. The separator wiktextract leaks into a flattened table
  // is an arbitrary Wiktionary page title, so these patterns can't be used to
  // drop anything (see kaikki-yoruba/src/lib/relationDebris.mjs) - but if any
  // survive the container-level filter upstream, they should be visible here
  // rather than only in the UI.
  const FOREIGN_SCRIPT = /[㐀-䶿一-鿿぀-ヿ가-힯؀-ۿ]/u;
  const LATIN_LETTER = /[A-Za-zÀ-ɏḀ-ỿ]/u;

  const toneIndex = new Map(); // toneInsensitive spelling -> Set(ids)

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

    // Every spelling this entry answers to (headword, canonical form, alt
    // forms) - not just its canonical form - so two entries that only
    // coincide via an alt spelling still surface as homographs.
    for (const spelling of spellingsForEntry(entry)) {
      const key = toneInsensitiveForm(spelling);
      if (!toneIndex.has(key)) toneIndex.set(key, new Set());
      toneIndex.get(key).add(entry.id);
    }

    for (const field of ['synonyms', 'antonyms', 'derivedTerms', 'relatedTerms', 'descendants']) {
      for (const rel of entry[field] || []) {
        const text = rel.text || '';
        // A leaked separator sits inside a token; a genuine foreign-script
        // relation (Mandarin 阿哥哥, Japanese イロコ) is foreign all through.
        if (FOREIGN_SCRIPT.test(text) && LATIN_LETTER.test(text.replace(FOREIGN_SCRIPT, ''))) {
          report.suspiciousRelationText.push({ entryId: entry.id, field, text, reason: 'mixed-script' });
        }
      }
    }
  }

  for (const [spelling, ids] of toneIndex.entries()) {
    if (ids.size > 1) {
      report.duplicateNormalizedSpellings[spelling] = [...ids];
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
