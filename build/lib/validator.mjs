// build/lib/validator.mjs
//
// Stage 4: Validation. Produces a report describing detected inconsistencies
// in the data. Never modifies entries — purely diagnostic.
//
// The report's job is to be a work queue, not a census. "2,363 unknown
// referenced words" is a number nobody can act on; the same 2,363 split into
// "191 are typos where we already know the intended target" and "1,158 are
// words Wiktionary genuinely doesn't have yet" is two afternoons and a
// long-term project. So every issue carries:
//
//   effort  easy       the correct fix is already known, no judgment needed
//           mechanical no judgment, but no shortcut either — bulk work
//           expertise  needs someone who knows Yoruba
//           info       not a defect; context that stops a number looking bad
//   target  wiktionary fix it upstream and we pick it up on the next refresh
//           pipeline   fix it in this repo or in kaikki-yoruba
//
// and a deep link to the Wiktionary section to edit. Issues sort by effort
// then by breadth, so easy wins with the widest reach come first.
//
// The flat per-item arrays are still emitted underneath, unchanged: they are
// what the downloadable JSON is for, and what anything scripting this report
// already reads.

import {
  spellingsForEntry,
  toneInsensitiveForm,
  orthographyInsensitiveForm,
} from './orthography.mjs';

const EFFORT_ORDER = { easy: 0, mechanical: 1, expertise: 2, info: 3 };

// How many pages to list inline per issue. The full detail is always in the
// legacy arrays below, so this caps the rendered view, not the data — and the
// overflow is reported rather than silently dropped.
const MAX_PAGES_PER_ISSUE = 120;

const wiktionaryUrl = (headword) =>
  `https://en.wiktionary.org/wiki/${encodeURIComponent(headword)}#Yoruba`;

export function buildValidationReport(entries, unresolvedRelations, parseErrors, dialect = null, danglingAnchors = []) {
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
  // Every relation field either level can carry. descendants only exists at the
  // entry level and coordinateTerms/hyponyms/hypernyms only recently at both;
  // scanning for a field an entry does not have costs nothing.
  const RELATION_FIELDS = [
    'synonyms', 'antonyms', 'derivedTerms', 'relatedTerms', 'descendants',
    'coordinateTerms', 'hyponyms', 'hypernyms',
  ];

  const byId = new Map(entries.map((e) => [e.id, e]));
  const toneIndex = new Map(); // toneInsensitive spelling -> Set(ids)
  // Separate indexes for classifying a failed reference. A reference that
  // matches nothing exactly but matches once tone marks (or underdots) are
  // ignored is a diacritic typo with a known intended target - the single
  // most actionable thing in this report.
  const toneLookup = new Map();
  const orthoLookup = new Map();

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

      if (!toneLookup.has(key)) toneLookup.set(key, new Set());
      toneLookup.get(key).add(spelling);
      const okey = orthographyInsensitiveForm(spelling);
      if (!orthoLookup.has(okey)) orthoLookup.set(okey, new Set());
      orthoLookup.get(okey).add(spelling);
    }

    // Both levels. This tripwire exists to catch flattened-table debris that
    // slipped past the container filter upstream, and most relation items now
    // live on the senses - checking only the entry level would leave 9,000 of
    // them unwatched, which is where the debris would show up first.
    const scanRelations = (list, field) => {
      for (const rel of list || []) {
        const text = rel.text || '';
        // A leaked separator sits inside a token; a genuine foreign-script
        // relation (Mandarin 阿哥哥, Japanese イロコ) is foreign all through.
        if (FOREIGN_SCRIPT.test(text) && LATIN_LETTER.test(text.replace(FOREIGN_SCRIPT, ''))) {
          report.suspiciousRelationText.push({ entryId: entry.id, field, text, reason: 'mixed-script' });
        }
      }
    };
    for (const field of RELATION_FIELDS) scanRelations(entry[field], field);
    for (const sense of entry.senses || []) {
      for (const field of RELATION_FIELDS) scanRelations(sense[field], `sense ${field}`);
    }
  }

  for (const [spelling, ids] of toneIndex.entries()) {
    if (ids.size > 1) {
      report.duplicateNormalizedSpellings[spelling] = [...ids];
    }
  }

  // Circular derivation check: walk derivedTerms graph, flag cycles.
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

  report.issues = buildIssues(entries, byId, report, { toneLookup, orthoLookup, danglingAnchors });
  report.summary = summarize(report.issues);

  return report;
}

// ---------------------------------------------------------------------------
// The work queue
// ---------------------------------------------------------------------------

function buildIssues(entries, byId, report, { toneLookup, orthoLookup, danglingAnchors = [] }) {
  const issues = [];

  // -- Failed cross-references, split by what it would actually take to fix --

  const refBuckets = {
    tone: new Map(),
    underdot: new Map(),
    phrase: new Map(),
    missing: new Map(),
  };

  for (const ref of report.unknownReferencedWords) {
    const source = byId.get(ref.sourceEntryId);
    if (!source) continue;
    const toneHit = toneLookup.get(toneInsensitiveForm(ref.text));
    const orthoHit = orthoLookup.get(orthographyInsensitiveForm(ref.text));

    let bucket;
    let detail;
    if (toneHit && toneHit.size) {
      bucket = 'tone';
      detail = `${ref.relationType} “${ref.text}” — the dictionary has ${[...toneHit].slice(0, 3).map((s) => `“${s}”`).join(', ')}`;
    } else if (orthoHit && orthoHit.size) {
      bucket = 'underdot';
      detail = `${ref.relationType} “${ref.text}” — the dictionary has ${[...orthoHit].slice(0, 3).map((s) => `“${s}”`).join(', ')}`;
    } else if (ref.text.includes(' ')) {
      bucket = 'phrase';
      detail = `${ref.relationType} “${ref.text}”`;
    } else {
      bucket = 'missing';
      detail = `${ref.relationType} “${ref.text}”`;
    }
    pushPage(refBuckets[bucket], source, detail);
  }

  issues.push(
    issue({
      kind: 'reference-tone-typo',
      title: 'Cross-reference with the wrong tone marks',
      severity: 'high',
      effort: 'easy',
      target: 'wiktionary',
      why:
        'These references match an existing word once tone marks are ignored, so the intended target is already known — the reference just carries different tone marks from the entry it means. Every one of them is a link the reader currently does not get.',
      fix: 'On the listed Wiktionary page, correct the tone marks on the reference to match the entry it points at (or, if the reference is right, fix the tone on the target entry).',
      pages: refBuckets.tone,
    }),
    issue({
      kind: 'reference-underdot-typo',
      title: 'Cross-reference with a missing or extra underdot',
      severity: 'high',
      effort: 'easy',
      target: 'wiktionary',
      why:
        'Same as the tone typos, one dimension over: these match once underdots (ẹ ọ ṣ) are ignored, so the intended target is known.',
      fix: 'Correct the underdots on the reference so it matches the entry it means.',
      pages: refBuckets.underdot,
    }),
    issue({
      kind: 'reference-missing-entry',
      title: 'Cross-reference to a word Wiktionary does not have',
      severity: 'medium',
      effort: 'expertise',
      target: 'wiktionary',
      why:
        'The listed page names a related or derived word that has no Yoruba entry of its own, so the link goes nowhere. This is the dictionary\'s largest real content gap.',
      fix: 'Create the referenced word as a Yoruba entry on Wiktionary, with at least a definition and a headword template carrying its tone marks.',
      pages: refBuckets.missing,
    }),
    issue({
      kind: 'reference-multiword-phrase',
      title: 'Cross-reference to a multi-word phrase',
      severity: 'low',
      effort: 'info',
      target: 'wiktionary',
      why:
        'Verb phrases and proverbs listed as derived terms mostly have no entry of their own and are not expected to. Counted separately so they stop inflating the number of real gaps above.',
      fix: 'Nothing required. Create an entry only if the phrase is idiomatic enough to deserve one.',
      pages: refBuckets.phrase,
    })
  );

  // -- Derivations the source records but does not attribute to a sense --

  const ambiguous = new Map();
  const noEtymology = new Map();

  for (const entry of entries) {
    for (const rel of entry.synthesizedRelations || []) {
      if (rel.type !== 'derivedFrom') continue;
      if (rel.resolution?.method !== 'ambiguous' || rel.resolution.candidateCount < 2) continue;
      const root = byId.get(rel.entryId);
      const rootSpelling = root ? root.canonicalForm.value : rel.text;
      const detail =
        `listed as a derived term by ${rel.resolution.candidateCount} separate “${rootSpelling}” entries` +
        (entry.etymologyText ? `; its own etymology says “${entry.etymologyText.slice(0, 90)}”` : '');
      pushPage(entry.etymologyText ? ambiguous : noEtymology, entry, detail);
    }
  }

  issues.push(
    issue({
      kind: 'ambiguous-derivation',
      title: 'Derived term listed under several etymologies of the same spelling',
      severity: 'medium',
      effort: 'expertise',
      target: 'wiktionary',
      why:
        'Wiktionary lists this word as a derived term under two or more numbered etymologies that share a spelling and tone, and nothing in the source says which one it actually comes from. The derivation is usually productive — every gbá verb can form gbígbá — so the listing is not wrong, it is just unattributed. We show the root once and let the reader open the alternatives rather than guessing.',
      fix: 'Move the derived term to the etymology section it truly belongs to, or add a short definition to it in the derived-terms list (e.g. “|gbígbá<t:beating>”) so its meaning is recoverable.',
      pages: ambiguous,
    }),
    issue({
      kind: 'derived-without-etymology',
      title: 'Listed as a derived term, but the word has no etymology section',
      severity: 'medium',
      effort: 'expertise',
      target: 'wiktionary',
      why:
        'Another page claims this word is derived from it, but this word\'s own entry has no etymology at all, so there is nothing to check the claim against. Absence of an etymology is not evidence the derivation is wrong — it means nobody has written one yet, which is exactly the gap this dictionary\'s back-links are meant to expose.',
      fix: 'Write an Etymology section on the listed page naming the root it comes from, and what that root means. If it turns out not to be derived at all, remove it from the root\'s derived-terms list instead.',
      pages: noEtymology,
    })
  );

  // -- The one thing Wiktionary can state exactly, and almost nobody has --

  const needsAnchor = new Map();
  const byPage = new Map();
  for (const entry of entries) {
    if (!byPage.has(entry.headword)) byPage.set(entry.headword, []);
    byPage.get(entry.headword).push(entry);
  }
  for (const [page, group] of byPage) {
    if (new Set(group.map((e) => e.etymologyNumber)).size < 2) continue;
    const hasAnchor = group.some((e) =>
      (e.etymologyTemplates || []).some((t) => t.name === 'etymid')
    );
    if (hasAnchor) continue;
    // Only worth reporting if something actually points at this page.
    const referenced = entries.some((e) =>
      (e.etymologyMorphemes || []).some(
        (m) => (m.form === page || m.form?.toLowerCase() === page) && (m.entryIds || []).length > 1
      )
    );
    if (referenced) pushPage(needsAnchor, group[0], `${new Set(group.map((e) => e.etymologyNumber)).size} etymology sections, none of them named`);
  }

  const dangling = new Map();
  for (const d of danglingAnchors) {
    const e = byId.get(d.entryId);
    if (e) pushPage(dangling, e, `points at “${d.anchor}” on ${d.form}, which has no such name`);
  }

  issues.push(
    issue({
      kind: 'dangling-sense-anchor',
      title: 'Points at a name that was never created',
      severity: 'high',
      effort: 'easy',
      target: 'wiktionary',
      why:
        'Somebody did this properly — the word says which meaning of its component it means — but the component page never got the matching name, so the reference resolves to nothing. agbẹjọro is the clearest case: it names all three of its components (gbà "take", ẹjọ́ "law", rò "think") and not one of those pages has the anchor. Careful work, pointing nowhere.',
      fix: 'Add {{etymid|yo|<name>}} to the right etymology section of the component page, using exactly the name already being pointed at.',
      pages: dangling,
    }),
    issue({
      kind: 'missing-sense-anchor',
      title: 'Several meanings share this page, and none of them has a name',
      severity: 'high',
      effort: 'expertise',
      target: 'wiktionary',
      why:
        'Other words are built from this one, but there is no way for them to say which of its meanings they mean. Wiktionary has a template for exactly this — {{etymid}} names an etymology section, and a compound then points at that name — and it is the only way to state the answer rather than have us guess it. Everything else we do here is inference, and inference is what makes pàdé ("to meet") look like it comes from pa ("to kill").',
      fix: 'Add {{etymid|yo|<short name>}} as the first line of each numbered etymology section, following the pattern on the page "de". Then the words built from this one can point at those names. The Contribute page lists both halves for this page with the text to add.',
      pages: needsAnchor,
    })
  );

  // -- Pipeline-side, mechanical --

  // Detects the outcome, not the template shape. Testing for the shape that
  // caused it (a bare “t” where the extractor read “t1”) would keep reporting
  // this after the extractor was fixed, because the templates still use a
  // bare “t” — it was the reading that changed. Written this way it clears
  // itself on the next refresh, and catches the same mistake on any other
  // template it happens to next.
  const droppedMeaning = new Map();
  for (const entry of entries) {
    const morphemes = entry.etymologyMorphemes || [];
    if (!morphemes.length) continue;
    for (const tpl of entry.etymologyTemplates || []) {
      const args = tpl.args || {};
      // Same guard the morpheme extractor upstream applies: a template whose
      // first argument isn't "yo" describes another language, so its terms
      // were never going to become Yoruba morphemes. Without this, ìgbá's
      // Nupe cognate {{cog|nup|gba|t=two thousand}} reads as a lost meaning
      // purely because it collides in spelling with the "gba" in {{af|yo|i-|gba}}.
      if (args['1'] !== 'yo') continue;
      // Where a template records its first term and that term's meaning
      // differs by shape: reduplication takes a single term, so the meaning
      // is “t” or the positional “4” and “3” is display text for the same
      // term; the multi-term templates number theirs t1, t2, … alongside
      // args 2, 3, … one per term.
      const single = tpl.name === 'reduplication';
      const supplied = single ? args.t || args['4'] : args.t1 || args.t;
      const root = single ? args['3'] || args['2'] : args['2'];
      if (!supplied || !root) continue;
      // Require that the term became a morpheme and that NO copy of it
      // carries a meaning. Two things this guards against:
      //
      // Cross-language templates (cog, inh, bor) carry a “t” too, describing
      // a cognate in another language, and are excluded from morpheme
      // extraction by design — their term never becomes a morpheme, so
      // nothing was dropped. Requiring a match rules them out.
      //
      // And a page can carry several competing decompositions: nitori has
      // {{compound|yo|ní|ìtorí}} with no meanings at all *and*
      // {{compound|yo|ní|ti|orí|t1=on, at|…}} with them, so "ní" appears
      // twice, once bare. Checking every copy rather than the first one
      // stops the bare copy from being read as a loss.
      const copies = morphemes.filter((m) => m.form === root);
      if (!copies.length || copies.some((m) => m.gloss)) continue;
      pushPage(droppedMeaning, entry, `“${tpl.name}” records ${root} as meaning “${supplied}”, but that never reached the entry`);
      break;
    }
  }

  issues.push(
    issue({
      kind: 'root-meaning-dropped',
      title: 'The root word’s meaning is recorded but never reaches the entry',
      severity: 'high',
      effort: 'mechanical',
      target: 'pipeline',
      why:
        'Wiktionary says what the root word means, but we lose that text on the way in, so the component word shows up on the entry with nothing beside it to say what it is. It also costs us the only signal we have for telling several identically-spelled roots apart — and the words this happens to are exactly the ones where several compete.',
      fix: 'Correct how kaikki-yoruba src/lib/normalizer.mjs reads that template’s arguments, then refresh the data.',
      pages: droppedMeaning,
    }),
    issue({
      kind: 'suspicious-relation-text',
      title: 'Relation text mixing scripts',
      severity: 'low',
      effort: 'mechanical',
      target: 'pipeline',
      why: 'A flattened dialect table can leak a separator into a relation. Genuine foreign-script relations are foreign all through; these are not.',
      fix: 'Tighten the container-level filter in kaikki-yoruba src/lib/relationDebris.mjs.',
      pages: mapFrom(report.suspiciousRelationText, byId, (r) => `${r.field} “${r.text}”`),
    }),
    issue({
      kind: 'circular-derivation',
      title: 'Words that derive from each other in a loop',
      severity: 'medium',
      effort: 'mechanical',
      target: 'pipeline',
      why: 'A derivation cycle, usually because a derived term is also carried as one of the root\'s own alternative forms.',
      fix: 'Check whether the two are genuinely the same word; if so the derived-terms listing is the error.',
      pages: mapFrom(
        report.circularDerivations.map((c) => ({ entryId: c[0] })),
        byId,
        () => 'derives from itself'
      ),
    })
  );

  // -- Wiktionary-side, bulk --

  issues.push(
    issue({
      kind: 'missing-ipa',
      title: 'No pronunciation',
      severity: 'low',
      effort: 'mechanical',
      target: 'wiktionary',
      why: 'The entry has no IPA. For Yoruba this is largely derivable from the toned spelling, so it is bulk work rather than research.',
      fix: 'Add {{yo-IPA}} to the Pronunciation section of the listed page.',
      pages: mapFrom(report.missingIpa, byId, () => 'no Pronunciation section'),
    }),
    issue({
      kind: 'inferred-canonical-form',
      title: 'Main spelling not confirmed by the source',
      severity: 'low',
      effort: 'expertise',
      target: 'wiktionary',
      why:
        'No headword template gave a tone-marked spelling, so we fall back to the page title, which is usually untoned. This does not mean the spelling shown is wrong — often there is simply nothing for Wiktionary to choose between — but the tones are unverified, and deciding them needs someone who knows the word.',
      fix: 'Add a headword template carrying the tone marks (e.g. {{yo-verb|gbá}}) to the listed page.',
      pages: mapFrom(report.inferredCanonicalForms, byId, () => 'headword template gives no toned spelling'),
    }),
    issue({
      kind: 'shared-spelling',
      title: 'Spellings shared by several different words',
      severity: 'low',
      effort: 'info',
      target: 'wiktionary',
      why:
        'Counted so it is not mistaken for a defect. Yoruba has many homographs, and entries that differ only in tone are different words that this dictionary keeps deliberately apart. Every entry involved now links to its siblings so a reader can see the others.',
      fix: 'Nothing required.',
      pages: new Map(),
      count: Object.keys(report.duplicateNormalizedSpellings).length,
    })
  );

  return issues
    .filter((i) => i.count > 0)
    .sort(
      (a, b) => EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort] || b.count - a.count
    );
}

function pushPage(map, entry, detail) {
  if (!map.has(entry.headword)) {
    map.set(entry.headword, {
      page: entry.headword,
      editUrl: wiktionaryUrl(entry.headword),
      entryIds: [],
      details: [],
    });
  }
  const row = map.get(entry.headword);
  if (!row.entryIds.includes(entry.id)) row.entryIds.push(entry.id);
  if (row.details.length < 8) row.details.push(detail);
}

function mapFrom(items, byId, detailOf) {
  const map = new Map();
  for (const item of items) {
    const entry = byId.get(item.entryId);
    if (!entry) continue;
    pushPage(map, entry, detailOf(item));
  }
  return map;
}

function issue({ kind, title, severity, effort, target, why, fix, pages, count }) {
  const rows = [...pages.values()];
  const total = count ?? rows.reduce((n, r) => n + r.details.length, 0);
  return {
    kind,
    title,
    severity,
    effort,
    target,
    why,
    fix,
    count: total,
    pageCount: rows.length,
    pages: rows.slice(0, MAX_PAGES_PER_ISSUE),
    pagesOmitted: Math.max(0, rows.length - MAX_PAGES_PER_ISSUE),
  };
}

function summarize(issues) {
  const byEffort = {};
  const byTarget = {};
  for (const i of issues) {
    byEffort[i.effort] = (byEffort[i.effort] || 0) + i.count;
    byTarget[i.target] = (byTarget[i.target] || 0) + i.count;
  }
  return {
    byEffort,
    byTarget,
    actionable: issues.filter((i) => i.effort !== 'info').reduce((n, i) => n + i.count, 0),
    easyWins: issues.filter((i) => i.effort === 'easy').reduce((n, i) => n + i.count, 0),
  };
}
