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
