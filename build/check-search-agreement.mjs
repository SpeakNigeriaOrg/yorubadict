// build/check-search-agreement.mjs
//
// Checks the English ranking against build/fixtures/search_agreement.json - the same file checked in
// yoruba_student_dict_platform, so the two engines cannot quietly drift apart again.
//
// It calls the REAL scorer (public/english-relevance.js, the same file the browser loads) rather
// than a reimplementation. A checker that reimplements the thing it checks drifts from it, and that
// drift is precisely what let searching "child" break in both engines - here at #35, there at #3 -
// in two different ways, with nothing to notice.
//
//   node build/check-search-agreement.mjs
//
// Exits non-zero on failure, so it can gate a build. Requires public/data/ to be built first.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allForms } from './lib/orthography.mjs';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// The scorer assigns itself to globalThis so one file serves both a browser <script> and Node ESM -
// see its header. Importing it for the side effect is how Node gets at it.
await import(pathToFileURL(path.join(rootDir, 'public', 'english-relevance.js')).href);
const { rankQuery } = globalThis.EnglishRelevance;

const load = (...parts) => JSON.parse(readFileSync(path.join(rootDir, ...parts), 'utf8'));

const index = load('public', 'data', 'search-index.json');
const rawEntries = load('public', 'data', 'entries.json');
const fixture = load('build', 'fixtures', 'search_agreement.json');

const entryList = Array.isArray(rawEntries) ? rawEntries : Object.values(rawEntries);
const entriesById = new Map(entryList.map((e) => [e.id, e]));

// The dialect tier is deliberately not exercised: its matching has a side effect in the browser
// (recording which varieties produced a hit) and this fixture asserts nothing about it.
const helpers = {
  orthographyInsensitive: (s) => allForms(s).orthographyInsensitive,
  toneInsensitive: (s) => allForms(s).toneInsensitive,
  dialectIds: [],
  formOfEntry: (entryId) => {
    const entry = entriesById.get(entryId);
    if (!entry) return '';
    return entry.canonicalForm ? entry.canonicalForm.value : entry.headword;
  },
};

const nfc = (s) => s.normalize('NFC');
/** The FULL ranking a user gets - hard Yoruba tiers and the soft prefix/English block - not just the
 * English scorer. Checking the scorer alone missed the tier interaction, which is how a wrong claim
 * about where `ojú` lands for "eye" survived for a while. */
function formsFor(query, limit) {
  return rankQuery(index, index.components || {}, query, limit, helpers).map((id) => nfc(helpers.formOfEntry(id)));
}

const failures = [];
const pass = (label) => console.log(`  ok    ${label}`);
const fail = (label, detail) => {
  failures.push(label);
  console.log(`  FAIL  ${label}\n          ${detail}`);
};

console.log('English queries surface the word they are about:');
for (const { query, form } of fixture.expectedTopResult) {
  const forms = formsFor(query, 40);
  const label = `"${query}" -> ${form} first`;
  if (forms[0] === nfc(form)) pass(label);
  else fail(label, `got ${forms.slice(0, 5).join(', ') || '(nothing)'}`);
}
for (const { query, form } of fixture.expectedInTopThree) {
  const forms = formsFor(query, 40);
  const label = `"${query}" -> ${form} in the top three`;
  if (forms.slice(0, 3).includes(nfc(form))) pass(label);
  else fail(label, `got ${forms.slice(0, 5).join(', ') || '(nothing)'}`);
}

// ---------------------------------------------------------------------------
// The frozen-corpus invariant
// ---------------------------------------------------------------------------
// Inherited documents must not enter the statistics every other query divides by.
// This is the least visible property in the whole scorer and the easiest to lose
// in a refactor: nothing in the ranking output tells you it has gone, and losing
// it moved 25 entries into a top-ten slot across 400 queries at weight ZERO -
// pure statistical drift, no synonym scoring involved. Two lines of arithmetic
// make that impossible to lose silently.
console.log('\nInherited documents stay out of the corpus statistics:');
{
  const e = index.english;
  const label = 'totalDocs counts only direct documents';
  if (e.inheritedDocStart === undefined) {
    console.log('  --    index has no inherited documents (older build); skipping');
  } else if (e.totalDocs === e.inheritedDocStart) pass(label);
  else fail(label, `totalDocs ${e.totalDocs} but inheritedDocStart ${e.inheritedDocStart}`);

  if (e.inheritedDocStart !== undefined) {
    const direct = e.docLengths.slice(0, e.inheritedDocStart);
    const mean = direct.reduce((a, b) => a + b, 0) / direct.length;
    const avgLabel = 'avgDocLength is the mean of the direct documents only';
    if (Math.abs(mean - e.avgDocLength) < 1e-9) pass(avgLabel);
    else fail(avgLabel, `mean of the first ${direct.length} is ${mean}, avgDocLength is ${e.avgDocLength}`);

    // df must count direct documents only, for the same reason: it is the other half
    // of what idf divides by, and recomputing it over everything is the quiet way to
    // undo this while both numbers above still look right.
    let wrongDf = null;
    for (const [tok, postings] of Object.entries(e.postings)) {
      let direct = 0;
      for (const [docIdx] of postings) if (docIdx < e.inheritedDocStart) direct += 1;
      // A token occurring only in inherited documents is stored with a synthetic df of 1.
      const expected = direct === 0 ? 1 : direct;
      if (e.df[tok] !== expected) { wrongDf = `${tok}: df ${e.df[tok]}, direct documents ${direct}`; break; }
    }
    const dfLabel = 'df counts only direct documents';
    if (!wrongDf) pass(dfLabel);
    else fail(dfLabel, wrongDf);

    // The +2 bonus means "this word IS the query". Inherited text cannot say that.
    const highest = Object.values(e.exactClauses).reduce((m, docs) => Math.max(m, ...docs), -1);
    const clauseLabel = 'no inherited document can earn the exact-clause bonus';
    if (highest < e.inheritedDocStart) pass(clauseLabel);
    else fail(clauseLabel, `exactClauses references docIdx ${highest}, at or past ${e.inheritedDocStart}`);
  }
}

console.log('\nA spelling some entry calls a synonym finds that entry:');
for (const { query, form } of fixture.synonymSpellingReachesDeclarer || []) {
  const forms = formsFor(query, 40);
  const label = `"${query}" -> ${form} in the top three`;
  if (forms.slice(0, 3).includes(nfc(form))) pass(label);
  else fail(label, `got ${forms.slice(0, 5).join(', ') || '(nothing)'}`);
}

console.log('\n...but never above the word you actually typed:');
for (const { query, mustBeFirst, mustAlsoAppear } of fixture.synonymTierRanksBelowTheWordItself || []) {
  const forms = formsFor(query, 40);
  const label = `"${query}" -> ${mustBeFirst} first, ${mustAlsoAppear} below it`;
  const at = forms.indexOf(nfc(mustAlsoAppear));
  if (forms[0] !== nfc(mustBeFirst)) fail(label, `got ${forms.slice(0, 5).join(', ') || '(nothing)'}`);
  else if (at < 1) fail(label, `${mustAlsoAppear} ${at === 0 ? 'came first' : 'never appeared'}`);
  else pass(label);
}

console.log('\nA word is findable by what the meaning that named it says:');
for (const { query, form, via } of fixture.inheritedMeaningReachesTarget || []) {
  const forms = formsFor(query, 40);
  const label = `"${query}" -> ${form} in the top ten, via ${via}`;
  if (forms.slice(0, 10).includes(nfc(form))) pass(label);
  else fail(label, `got ${forms.slice(0, 6).join(', ') || '(nothing)'}`);
}

console.log('\nAnd inherited meaning stays in its place:');
for (const item of fixture.inheritedMeaningMustNotSurface || []) {
  const { query, mustNotContain, mustNotBeFirst, withinTop } = item;
  if (mustNotBeFirst) {
    const forms = formsFor(query, 40);
    const label = `"${query}" does not put ${mustNotBeFirst} first`;
    if (forms[0] !== nfc(mustNotBeFirst)) pass(label);
    else fail(label, `${mustNotBeFirst} came first; got ${forms.slice(0, 5).join(', ')}`);
    continue;
  }
  const forms = formsFor(query, Math.max(withinTop, 40)).slice(0, withinTop);
  const label = `"${query}" does not surface ${mustNotContain} in the top ${withinTop}`;
  if (!forms.includes(nfc(mustNotContain))) pass(label);
  else fail(label, `${mustNotContain} appeared at #${forms.indexOf(nfc(mustNotContain)) + 1}`);
}

console.log('\nA partly-typed English word finds the word it starts:');
for (const { query, form } of fixture.partialSpellingFindsTheWord || []) {
  const forms = formsFor(query, 40);
  const label = `"${query}" -> ${form} in the top ten`;
  if (forms.slice(0, 10).includes(nfc(form))) pass(label);
  else fail(label, `got ${forms.slice(0, 5).join(', ') || '(nothing)'}`);
}

console.log('\nA word is findable by the English word its address is named after:');
for (const { query, form } of fixture.distilledWordReachesEntry || []) {
  const forms = formsFor(query, 40);
  const label = `"${query}" -> ${form} in the top ten`;
  if (forms.slice(0, 10).includes(nfc(form))) pass(label);
  else fail(label, `got ${forms.slice(0, 5).join(', ') || '(nothing)'}`);
}

// Two guards on mechanisms only this engine has, so they stay out of the shared
// sections the platform reads.
console.log('\nSynonym evidence stays subordinate to a real English match:');
for (const group of ['synonymTierMustNotDisplaceEnglish', 'rootBonusCountsDirectMatchesOnly']) {
  for (const { query, form, withinTop } of fixture[group] || []) {
    const forms = formsFor(query, 40);
    const label = `"${query}" -> ${form} in the top ${withinTop}`;
    if (forms.slice(0, withinTop).includes(nfc(form))) pass(label);
    else fail(label, `got ${forms.slice(0, 5).join(', ') || '(nothing)'}`);
  }
}

console.log('\nThe root bonus never promotes a word the query did not match:');
for (const { query, mustNotContain } of fixture.rootBonusMustNotPromote) {
  const forms = formsFor(query, 100);
  const label = `"${query}" does not surface ${mustNotContain}`;
  if (!forms.includes(nfc(mustNotContain))) pass(label);
  else fail(label, `${mustNotContain} appeared at #${forms.indexOf(nfc(mustNotContain)) + 1}`);
}

// Not assertions - differences the two engines are allowed to have, printed so they stay visible
// rather than becoming folklore.
console.log('\nKnown, accepted differences between the engines:');
for (const note of fixture.knownDifferences) console.log(`  - ${note}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} search-agreement check(s) failed.`);
  process.exit(1);
}
console.log('\nAll search-agreement checks passed.');
