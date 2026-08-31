// build/check-search-drift.mjs
//
// What a change to the ranking did to everything you were not thinking about.
//
//   node build/check-search-drift.mjs --save     before you change anything
//   node build/check-search-drift.mjs            after
//
// check-search-agreement.mjs asserts the queries somebody thought to write down. This answers a
// different question - "what else moved?" - over the 400 most common definition clauses, which is
// a stand-in for what people actually search for and far more than anyone will hand-curate.
//
// It is deliberately NOT a checked-in baseline and not part of `npm test`. kaikki-yoruba
// republishes weekly, so a stored expectation of 400 rankings would churn on data changes rather
// than on ranking changes, and a check that cries wolf every week is a check nobody reads. The
// snapshot is a local, throwaway before-and-after around one edit.
//
// The number to watch is the last one. Entries entering the top ten is the point of most changes
// here; a former top-five result FALLING OUT of the top ten is how a change quietly makes search
// worse somewhere you were not looking. When this change (English partial matching, plus the
// distilled address word) was measured this way, 7 of 400 top results moved, 116 queries gained
// an entry, and exactly one former top-five left the top ten - "sweetness" dropped ìrèké
// ("sugarcane") from #5 to #11, displaced by dùn, yọ̀n and òrò, which all mean sweet. Worth
// reading every one of them rather than trusting the totals.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allForms } from './lib/orthography.mjs';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(rootDir, 'build', 'search-drift-snapshot.json');
const QUERIES = 400;
const DEPTH = 10;

await import(pathToFileURL(path.join(rootDir, 'public', 'english-relevance.js')).href);
const { rankQuery } = globalThis.EnglishRelevance;

const load = (...p) => JSON.parse(readFileSync(path.join(rootDir, ...p), 'utf8'));
const index = load('public', 'data', 'search-index.json');
const entriesById = load('public', 'data', 'entries.json');

const formOf = (id) => {
  const entry = entriesById[id];
  if (!entry) return id;
  return (entry.canonicalForm ? entry.canonicalForm.value : entry.headword).normalize('NFC');
};
const helpers = {
  orthographyInsensitive: (s) => allForms(s).orthographyInsensitive,
  toneInsensitive: (s) => allForms(s).toneInsensitive,
  dialectIds: [],
  formOfEntry: formOf,
};

/** The most-repeated `;`/`,`-delimited clauses in the corpus, which is the closest thing to a
 * query log a dictionary with no server has. Folded the way clausesOfGloss folds them. */
function commonQueries() {
  const counts = new Map();
  for (const entry of Object.values(entriesById)) {
    for (const sense of entry.senses || []) {
      for (const gloss of sense.glosses || []) {
        for (const raw of gloss.toLowerCase().replace(/["'’“”().]/g, '').split(/[;,]/)) {
          const clause = raw.trim();
          if (clause.length > 2) counts.set(clause, (counts.get(clause) || 0) + 1);
        }
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, QUERIES).map(([q]) => q);
}

const ranked = Object.fromEntries(
  commonQueries().map((q) => [q, rankQuery(index, index.components || {}, q, DEPTH, helpers)])
);

if (process.argv.includes('--save')) {
  writeFileSync(SNAPSHOT, JSON.stringify(ranked));
  console.log(`Saved ${Object.keys(ranked).length} rankings to ${path.relative(rootDir, SNAPSHOT)}.`);
  console.log('Make your change, rebuild, then run this again without --save.');
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  console.error(
    `No snapshot at ${path.relative(rootDir, SNAPSHOT)}.\n` +
      'Run with --save on the unchanged code first, then change it, rebuild, and run again.'
  );
  process.exit(1);
}

const before = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
let moved = 0;
let gained = 0;
const lost = [];
const movedRows = [];

for (const [query, was] of Object.entries(before)) {
  const now = ranked[query];
  // A query that has left the corpus entirely: the data changed under the snapshot, so it can
  // say nothing about the ranking. Counting it as a loss would be blaming the wrong thing.
  if (!now) continue;
  if (was[0] !== now[0]) {
    moved += 1;
    movedRows.push(`  "${query}"  ${formOf(was[0])} -> ${formOf(now[0])}`);
  }
  const nowSet = new Set(now);
  if (now.some((id) => !was.includes(id))) gained += 1;
  const dropped = was.slice(0, 5).filter((id) => !nowSet.has(id));
  if (dropped.length > 0) lost.push(`  "${query}"  lost ${dropped.map(formOf).join(', ')}`);
}

console.log(`Over ${Object.keys(before).length} of the most common definition clauses:\n`);
console.log(`  top result changed                  ${moved}`);
console.log(`  top ten gained an entry             ${gained}`);
console.log(`  a former top-five left the top ten  ${lost.length}`);
if (movedRows.length > 0) {
  console.log('\nTop result changed:');
  for (const row of movedRows) console.log(row);
}
if (lost.length > 0) {
  console.log('\nA former top-five left the top ten - read every one:');
  for (const row of lost) console.log(row);
}
