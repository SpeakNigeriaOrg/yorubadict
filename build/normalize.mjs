#!/usr/bin/env node
// build/normalize.mjs
//
// Offline build pipeline orchestrator:
//   Kaikki JSONL -> Parser -> Normalizer -> Relationship Synthesis
//   -> Validation -> Search Index Builder -> Static Browser Assets
//
// Usage:
//   node build/normalize.mjs [path-to-jsonl]
//
// Defaults to data/sample.jsonl. Writes:
//   public/data/entries.json
//   public/data/search-index.json
//   build/validation-report.json

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseJsonl } from './lib/parser.mjs';
import { normalizeRecords } from './lib/normalizer.mjs';
import { synthesizeRelationships } from './lib/relationships.mjs';
import { buildValidationReport } from './lib/validator.mjs';
import { buildSearchIndex } from './lib/search-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const inputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(rootDir, 'data', 'sample.jsonl');

const outEntriesPath = path.join(rootDir, 'public', 'data', 'entries.json');
const outIndexPath = path.join(rootDir, 'public', 'data', 'search-index.json');
const outValidationPath = path.join(rootDir, 'build', 'validation-report.json');
const outPublicValidationPath = path.join(rootDir, 'public', 'data', 'validation-report.json');

function main() {
  console.log(`[1/5] Parsing ${path.relative(rootDir, inputPath)} ...`);
  const { records, errors: parseErrors } = parseJsonl(inputPath);
  console.log(`      ${records.length} records parsed, ${parseErrors.length} parse errors`);

  console.log('[2/5] Normalizing records into canonical entries ...');
  const entries = normalizeRecords(records);

  console.log('[3/5] Synthesizing relationship graph ...');
  const { entries: linkedEntries, unresolved } = synthesizeRelationships(entries);

  console.log('[4/5] Building validation report ...');
  const validationReport = buildValidationReport(linkedEntries, unresolved, parseErrors);

  console.log('[5/5] Building search index ...');
  const searchIndex = buildSearchIndex(linkedEntries);

  mkdirSync(path.dirname(outEntriesPath), { recursive: true });
  mkdirSync(path.dirname(outValidationPath), { recursive: true });

  // Entries are shipped to the browser as an id-keyed object for O(1) lookup.
  const entriesById = Object.fromEntries(linkedEntries.map((e) => [e.id, e]));

  writeFileSync(outEntriesPath, JSON.stringify(entriesById));
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
}

main();
