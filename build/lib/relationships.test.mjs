// build/lib/relationships.test.mjs
//
// Covers the consumer-side half of sense-level relations: resolving them against
// the alias index, the diacritic fallback, homograph disambiguation, and the
// reciprocals synthesized from them. That path had no coverage at all, and it is
// where a wrong link gets fabricated rather than merely displayed oddly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { synthesizeRelationships } from './relationships.mjs';
import { allForms } from './orthography.mjs';

const SENSE_FIELDS = [
  'synonyms', 'antonyms', 'derivedTerms', 'relatedTerms',
  'coordinateTerms', 'hyponyms', 'hypernyms',
];

/** A canonical entry with the shape kaikki-yoruba publishes. */
function entry(id, spelling, glossesBySense, { pos = 'verb', altForms = [] } = {}) {
  return {
    id,
    headword: spelling,
    pos,
    langCode: 'yo',
    canonicalForm: { value: spelling, inferenceMethod: 'explicit_canonical_tag', confidence: 1, originalValue: spelling },
    altForms,
    ipa: [],
    forms: allForms(spelling),
    etymologyNumber: null,
    etymologyText: null,
    etymologyTemplates: [],
    etymologyMorphemes: [],
    usedInCompounds: [],
    dialectSynonyms: [],
    senses: glossesBySense.map((glosses, i) => ({
      id: `${id}-s${i}`,
      glosses: Array.isArray(glosses) ? glosses : [glosses],
      rawGlosses: [],
      tags: [],
      examples: [],
      links: [],
      altOf: [],
      ...Object.fromEntries(SENSE_FIELDS.map((f) => [f, []])),
    })),
    derivedTerms: [], relatedTerms: [], synonyms: [], antonyms: [], descendants: [],
    coordinateTerms: [], hyponyms: [], hypernyms: [],
  };
}

const term = (text) => ({ type: 'term', text, english: null, lang: null, langCode: null, roman: null });

test('a sense-level list resolves against the alias index and keeps its meaning attribution', () => {
  const sun = entry('sun-2', 'sun', ['to roast', 'to burn; to set on fire']);
  sun.senses[0].synonyms = [term('wì')];
  sun.senses[1].synonyms = [term('jó')];
  const wi = entry('wi-1', 'wì', ['to singe; to scorch']);
  const jo = entry('jo-1', 'jó', ['to burn']);

  const { entries } = synthesizeRelationships([sun, wi, jo]);
  const resolved = entries.find((e) => e.id === 'sun-2');

  assert.deepEqual(resolved.senses[0].synonyms[0].entryIds, ['wi-1']);
  assert.equal(resolved.senses[0].synonyms[0].resolved, true);
  // The second meaning's synonym must not leak onto the first.
  assert.deepEqual(resolved.senses[1].synonyms[0].entryIds, ['jo-1']);
});

test('an unresolved sense-level reference is kept, flagged, and logged under a sense-specific type', () => {
  const sun = entry('sun-2', 'sun', ['to roast']);
  sun.senses[0].synonyms = [term('yan')]; // no entry for yan anywhere

  const { entries, unresolved } = synthesizeRelationships([sun]);
  const rel = entries[0].senses[0].synonyms[0];

  assert.equal(rel.resolved, false);
  assert.deepEqual(rel.entryIds, []);
  assert.equal(rel.text, 'yan', 'the reference is kept so the UI can still show it');

  const logged = unresolved.find((u) => u.text === 'yan');
  assert.ok(logged, 'expected the miss to reach the validation report');
  assert.equal(logged.relationType, 'sense synonyms', 'so the report can tell the two levels apart');
});

test('a reference written with the wrong tone marks resolves, and says it was inferred', () => {
  const ao = entry('ao-1', 'ao', ['wind']);
  ao.senses[0].synonyms = [term('aféfe')]; // the entry is afẹ́fẹ́
  const afefe = entry('afefe-1', 'afẹ́fẹ́', ['air, wind, breeze'], { pos: 'noun' });

  const { entries } = synthesizeRelationships([ao, afefe]);
  const rel = entries[0].senses[0].synonyms[0];

  assert.equal(rel.resolved, true);
  assert.deepEqual(rel.entryIds, ['afefe-1']);
  assert.equal(rel.matchedBy, 'underdot', 'recorded as an inference, not as what the source said');
});

test('an exact match never records matchedBy, so the artifact stays quiet in the common case', () => {
  const a = entry('a-1', 'ilé', ['house'], { pos: 'noun' });
  a.senses[0].synonyms = [term('ọgbà')];
  const b = entry('b-1', 'ọgbà', ['compound'], { pos: 'noun' });

  const { entries } = synthesizeRelationships([a, b]);
  assert.equal('matchedBy' in entries[0].senses[0].synonyms[0], false);
});

test('the diacritic fallback refuses to cross a capitalization boundary in either direction', () => {
  // Yoruba forms given names from common nouns, so egun/Egun and akin/Akin are
  // different words rather than different spellings of one.
  const gun = entry('gun-1', 'gún', ['to stab']);
  gun.senses[0].derivedTerms = [term('ẹ̀gún')]; // thorn - no entry
  const egun = entry('egun-1', 'Ègùn', ['the Ogu people'], { pos: 'name' });

  const akin = entry('akin-1', 'akin', ['brave person'], { pos: 'noun' });
  akin.senses[0].derivedTerms = [term('Akin')]; // the given name - no entry

  const { entries } = synthesizeRelationships([gun, egun, akin]);

  assert.equal(entries[0].senses[0].derivedTerms[0].resolved, false, 'lowercase must not reach Ègùn');
  const self = entries.find((e) => e.id === 'akin-1');
  assert.equal(self.senses[0].derivedTerms[0].resolved, false, 'Akin must not resolve back to akin');
  // That second case is what took circular derivations from 1 to 17.
  assert.equal((self.synthesizedRelations || []).length, 0, 'and so nothing derives from itself');
});

test('a spelling shared by homographs is disambiguated by the meaning it was listed under', () => {
  const orisa = entry('orisa-1', 'òrìṣà', ['a deity'], { pos: 'noun' });
  orisa.senses[0].synonyms = [term('ebo')];
  // Two entries spelled ebo; only one is about deities and offerings.
  const ebo1 = entry('ebo-1', 'ebo', ['a bundle of firewood'], { pos: 'noun' });
  const ebo2 = entry('ebo-2', 'ebo', ['an offering to a deity'], { pos: 'noun' });

  const { entries } = synthesizeRelationships([orisa, ebo1, ebo2]);
  const rel = entries[0].senses[0].synonyms[0];

  assert.equal(rel.entryIds.length, 2, 'both candidates are kept');
  assert.equal(rel.entryIds[0], 'ebo-2', 'the discriminating one is moved to the front');
  assert.equal(rel.resolution.method, 'glossOverlap');
});

test('when nothing discriminates between homographs, the ambiguity is recorded rather than guessed', () => {
  const a = entry('a-1', 'ilé', ['house'], { pos: 'noun' });
  a.senses[0].synonyms = [term('de')];
  const d1 = entry('de-1', 'de', ['to arrive'], { pos: 'verb' });
  const d2 = entry('de-2', 'de', ['to hunt'], { pos: 'verb' });

  const { entries } = synthesizeRelationships([a, d1, d2]);
  const rel = entries[0].senses[0].synonyms[0];

  assert.equal(rel.resolution.method, 'ambiguous');
  assert.equal(rel.resolution.candidateCount, 2);
});

test('a synonym reciprocal carries the meaning it was listed under, not just the word', () => {
  const sun = entry('sun-2', 'sun', ['to roast', 'to burn; to set on fire']);
  sun.senses[0].synonyms = [term('wì')];
  const wi = entry('wi-1', 'wì', ['to singe; to scorch']);

  const { entries } = synthesizeRelationships([sun, wi]);
  const target = entries.find((e) => e.id === 'wi-1');
  const back = (target.synthesizedRelations || []).find((r) => r.type === 'synonyms');

  assert.ok(back, 'wì should learn that sun calls it a synonym');
  assert.equal(back.text, 'sun');
  assert.equal(back.provenance, 'synthesized');
  // Without this, the pill reads "listed as a synonym of sun" and cannot say
  // which of sun's meanings - the attribution this change exists to keep.
  assert.equal(back.sourceSenseIndex, 0);
  // The index, not the text: the browser holds sun already and looks the meaning
  // up, rather than the artifact shipping 2,100 duplicated strings.
  assert.equal('sourceMeaning' in back, false);
  assert.equal(sun.senses[back.sourceSenseIndex].glosses.join('; '), 'to roast');
});

test('no reciprocal is synthesized when the target already declares the relation itself', () => {
  const a = entry('a-1', 'jó', ['to burn'], { pos: 'verb' });
  a.senses[0].synonyms = [term('sun')];
  const b = entry('b-1', 'sun', ['to burn; to set on fire'], { pos: 'verb' });
  b.senses[0].synonyms = [term('jó')]; // declared on the SENSE, not the entry

  const { entries } = synthesizeRelationships([a, b]);

  for (const e of entries) {
    assert.deepEqual(
      (e.synthesizedRelations || []).filter((r) => r.type === 'synonyms'),
      [],
      `${e.headword} should not get an inferred pill next to its declared one`
    );
  }
});

test('relatedTerms and the taxonomic lists get no sense-level reciprocal', () => {
  // in's related list is the whole pronoun paradigm; a reciprocal would put a
  // pill for it on all 19 pronouns.
  const src = entry('in-1', 'in', ['a pronoun'], { pos: 'pron' });
  src.senses[0].relatedTerms = [term('ìwọ')];
  src.senses[0].hypernyms = [term('ìwọ')];
  src.senses[0].coordinateTerms = [term('ìwọ')];
  const target = entry('iwo-1', 'ìwọ', ['you'], { pos: 'pron' });

  const { entries } = synthesizeRelationships([src, target]);
  const t = entries.find((e) => e.id === 'iwo-1');
  assert.deepEqual(t.synthesizedRelations || [], []);
});

test('a sense-level derived term still teaches the root that it is a root', () => {
  const sun = entry('sun-1', 'sun', ['to sleep']);
  sun.senses[0].derivedTerms = [term('ibùsùn')];
  const bed = entry('ibusun-1', 'ibùsùn', ['bed'], { pos: 'noun' });

  const { entries } = synthesizeRelationships([sun, bed]);
  const back = (entries.find((e) => e.id === 'ibusun-1').synthesizedRelations || [])
    .find((r) => r.type === 'derivedFrom');

  assert.ok(back, 'ibùsùn should learn it comes from sun');
  assert.equal(back.text, 'sun');
  assert.equal(back.sourceSenseIndex, 0);
});

test('an entry with no sense-level relation fields at all still builds (older release)', () => {
  const old = entry('old-1', 'ilé', ['house'], { pos: 'noun' });
  for (const sense of old.senses) for (const f of SENSE_FIELDS) delete sense[f];

  assert.doesNotThrow(() => synthesizeRelationships([old]));
});

// --- A back-link settling an ambiguous morpheme -------------------------
//
// nítorí in miniature: two entries spelled ní, an etymology that names the
// spelling without saying which one it means, and a preposition that lists
// nítorí among its own derived terms. The list is the only thing in the data
// that names one of them.

const morpheme = (form, entryIds, gloss = null) => ({
  form,
  gloss,
  resolved: true,
  entryIds,
  bound: false,
  analysis: 0,
  analysisTemplate: 'compound',
});

test('a back-link settles a morpheme the etymology left ambiguous', () => {
  const letter = entry('ni-letter', 'ní', ['the name of the Latin script letter N'], { pos: 'character' });
  const prep = entry('ni-prep', 'ní', ['at, in'], { pos: 'prep' });
  const nitori = entry('nitori-1', 'nítorí', ['because'], { pos: 'conj' });
  // The letter first, so first-in-the-list is the wrong answer.
  nitori.etymologyMorphemes = [morpheme('ní', ['ni-letter', 'ni-prep'])];
  prep.derivedTerms = [term('nítorí')];

  const { entries, morphemesSettledByBackLink } = synthesizeRelationships([letter, prep, nitori]);
  const m = entries.find((e) => e.id === 'nitori-1').etymologyMorphemes[0];

  assert.equal(m.chosenBy, 'backLink');
  assert.equal(m.chosenEntryId, 'ni-prep', 'the preposition, not whichever came first');
  assert.equal(morphemesSettledByBackLink, 1);
});

test('a back-link torn between the same candidates settles nothing', () => {
  const letter = entry('ni-letter', 'ní', ['the name of the Latin script letter N'], { pos: 'character' });
  const prep = entry('ni-prep', 'ní', ['at, in'], { pos: 'prep' });
  const nitori = entry('nitori-1', 'nítorí', ['because'], { pos: 'conj' });
  nitori.etymologyMorphemes = [morpheme('ní', ['ni-letter', 'ni-prep'])];
  // Both claim it, which is the state we were already in.
  letter.derivedTerms = [term('nítorí')];
  prep.derivedTerms = [term('nítorí')];

  const { entries, morphemesSettledByBackLink } = synthesizeRelationships([letter, prep, nitori]);
  const m = entries.find((e) => e.id === 'nitori-1').etymologyMorphemes[0];

  assert.equal(m.chosenBy, 'noMeaning', 'still a guess, and still says so');
  assert.equal(morphemesSettledByBackLink, 0);
});

test('a back-link does not overrule an etymology that said which meaning', () => {
  const letter = entry('ni-letter', 'ní', ['the name of the Latin script letter N'], { pos: 'character' });
  const prep = entry('ni-prep', 'ní', ['at, in'], { pos: 'prep' });
  const nitori = entry('nitori-1', 'nítorí', ['because'], { pos: 'conj' });
  nitori.etymologyMorphemes = [morpheme('ní', ['ni-letter', 'ni-prep'], 'at, in')];
  // The wrong one claims it. The etymology's own meaning outranks the claim.
  letter.derivedTerms = [term('nítorí')];

  const { entries, morphemesSettledByBackLink } = synthesizeRelationships([letter, prep, nitori]);
  const m = entries.find((e) => e.id === 'nitori-1').etymologyMorphemes[0];

  assert.equal(m.chosenBy, 'meaning');
  assert.equal(m.chosenEntryId, 'ni-prep');
  assert.equal(morphemesSettledByBackLink, 0);
});

test('a morpheme settled by a back-link is attributed, not left in the hedge list', () => {
  const letter = entry('ni-letter', 'ní', ['the name of the Latin script letter N'], { pos: 'character' });
  const prep = entry('ni-prep', 'ní', ['at, in'], { pos: 'prep' });
  const nitori = entry('nitori-1', 'nítorí', ['because'], { pos: 'conj' });
  nitori.etymologyMorphemes = [morpheme('ní', ['ni-letter', 'ni-prep'])];
  prep.derivedTerms = [term('nítorí')];

  const { entries } = synthesizeRelationships([letter, prep, nitori]);
  const settledTo = entries.find((e) => e.id === 'ni-prep');
  const other = entries.find((e) => e.id === 'ni-letter');

  assert.deepEqual(
    settledTo.usedInCompounds.map((c) => c.entryId),
    ['nitori-1'],
    'the preposition builds it, and says so as a fact'
  );
  assert.deepEqual(settledTo.possiblyUsedIn, [], 'and not also as a maybe');
  assert.deepEqual(other.possiblyUsedIn, [], 'the letter stops claiming it at all');
  assert.deepEqual(other.usedInCompounds, []);
});
