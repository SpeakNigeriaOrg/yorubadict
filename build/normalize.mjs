#!/usr/bin/env node
// build/normalize.mjs
//
// Build pipeline orchestrator:
//   kaikki-yoruba's canonical artifact -> Relationship Synthesis
//   -> Validation -> Search Index Builder -> Static Browser Assets
//
// Parsing raw Kaikki JSONL and normalizing it into canonical entries used
// to happen here - that's now kaikki-yoruba's job (shared with
// yoruba_student_dict_platform), including etymology-morpheme extraction
// and resolution (etymologyMorphemes/usedInCompounds arrive already
// resolved). What stays here - resolving derivedTerms/relatedTerms/
// synonyms/antonyms/descendants, validation reporting, and search-index
// building - is yorubadict-specific, not shared.
//
// Usage:
//   node build/normalize.mjs                       fetch kaikki-yoruba's
//                                                    latest GitHub Release
//   node build/normalize.mjs path/to/entries.json   use a local snapshot
//                                                    instead (offline dev,
//                                                    or data/sample.entries.json
//                                                    for the smoke-test
//                                                    fixture)
//
// Writes:
//   public/data/entries.json
//   public/data/search-index.json
//   build/validation-report.json

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadEntriesFromFile, loadLatestEntriesAndMetadata } from './lib/loadEntries.mjs';
import { synthesizeRelationships } from './lib/relationships.mjs';
import { buildValidationReport } from './lib/validator.mjs';
import { buildSearchIndex } from './lib/search-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const inputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : null;

const outEntriesPath = path.join(rootDir, 'public', 'data', 'entries.json');
const outIndexPath = path.join(rootDir, 'public', 'data', 'search-index.json');
const outValidationPath = path.join(rootDir, 'build', 'validation-report.json');
const outPublicValidationPath = path.join(rootDir, 'public', 'data', 'validation-report.json');

async function main() {
  let entriesById, kaikkiSourceDate, kaikkiReleaseTag, kaikkiParseErrorCount;
  if (inputPath) {
    console.log(`[1/4] Loading ${path.relative(rootDir, inputPath)} ...`);
    entriesById = await loadEntriesFromFile(inputPath);
    kaikkiSourceDate = null;
    kaikkiReleaseTag = null;
    kaikkiParseErrorCount = null;
  } else {
    console.log("[1/4] Fetching kaikki-yoruba's latest release ...");
    const fetched = await loadLatestEntriesAndMetadata();
    entriesById = fetched.entries;
    kaikkiSourceDate = fetched.metadata.sourceDate;
    kaikkiReleaseTag = fetched.tagName;
    kaikkiParseErrorCount = fetched.metadata.parseErrorCount;
  }
  const entries = Object.values(entriesById);
  console.log(`      ${entries.length} entries loaded`);

  console.log('[2/4] Synthesizing relationship graph ...');
  const { entries: linkedEntries, unresolved } = synthesizeRelationships(entries);

  console.log('[3/4] Building validation report ...');
  const validationReport = buildValidationReport(linkedEntries, unresolved, []);
  validationReport.kaikkiSourceDate = kaikkiSourceDate;
  validationReport.kaikkiReleaseTag = kaikkiReleaseTag;
  validationReport.kaikkiParseErrorCount = kaikkiParseErrorCount;

  console.log('[4/4] Building search index ...');
  const searchIndex = buildSearchIndex(linkedEntries);

  mkdirSync(path.dirname(outEntriesPath), { recursive: true });
  mkdirSync(path.dirname(outValidationPath), { recursive: true });

  // Entries are shipped to the browser as an id-keyed object for O(1) lookup.
  const linkedEntriesById = Object.fromEntries(linkedEntries.map((e) => [e.id, e]));

  writeFileSync(outEntriesPath, JSON.stringify(linkedEntriesById));
  writeFileSync(outIndexPath, JSON.stringify(searchIndex));
  writeFileSync(outValidationPath, JSON.stringify(validationReport, null, 2));
  writeFileSync(outPublicValidationPath, JSON.stringify(validationReport));

  const sizeOf = (p) => (statSync(p).size / 1024).toFixed(1);

  console.log('\nDone.');
  console.log(`  entries.json size  ${sizeOf(outEntriesPath)} KB`);
  console.log(`  search-index size  ${sizeOf(outIndexPath)} KB`);
  console.log(`  entries.json       ${linkedEntries.length} entries`);
  console.log(`  search-index.json  ${Object.keys(searchIndex.english.postings).length} English tokens`);
  console.log(`  validation-report  ${validationReport.inferredCanonicalForms.length} inferred canonical forms, ` +
    `${validationReport.unknownReferencedWords.length} unresolved relationship references, ` +
    `${validationReport.missingIpa.length} entries missing IPA`);
  if (kaikkiSourceDate) console.log(`  kaikki-yoruba data  release ${kaikkiReleaseTag}, sourced ${kaikkiSourceDate}`);
}

main().catch((err) => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
