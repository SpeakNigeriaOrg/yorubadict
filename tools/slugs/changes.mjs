#!/usr/bin/env node
// tools/slugs/changes.mjs — the weekly sheet of address changes.
//
//     node tools/slugs/changes.mjs write [FILE]     the sheet (default tools/slugs/work/changes.md)
//     node tools/slugs/changes.mjs apply FILE       read it back into data/url-slugs.json
//     node tools/slugs/changes.mjs apply FILE -dry  say what it would do, change nothing
//
// The refresh workflow writes it into a "Dictionary changes" pull request, and
// .github/workflows/changes.yml applies it on merge; nobody needs to run this.
// See tools/slugs/lib/changes.mjs for what the sheet holds.
//
// Both commands first record any automatic matches (as rekey.mjs does), so the
// sheet never offers a question the data has already answered.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { spellingPathFor } from '../../build/lib/address.mjs';
import { loadLedger, loadHistory, snapshotsFor, spellingsOf } from '../../build/lib/slugs.mjs';
import { matchArrivals } from '../../build/lib/continuity.mjs';
import { writeLedger, persistAutomatic } from './lib/ledger.mjs';
import { collectItems, renderSheet, parseSheet, applyDecisions } from './lib/changes.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = path.join(repo, 'data/url-slugs.json');
const [command, file, ...flags] = process.argv.slice(2);

const entries = Object.values(JSON.parse(readFileSync(path.join(repo, 'public/data/entries.json'), 'utf8')));
const ledger = loadLedger(ledgerPath);
const { spellingOf } = spellingsOf(entries);
const snapshots = () => snapshotsFor({ records: ledger.entries, entries, history: loadHistory() });

const auto = matchArrivals({ entries, records: ledger.entries, spellingOf, snapshots: snapshots() }).automatic;
persistAutomatic(ledger, auto, new Map(entries.map((e) => [e.id, e])));

const items = collectItems({ records: ledger.entries, entries, spellingOf, snapshots: snapshots() });
const spellings = new Set(spellingOf.values());
for (const i of items) {
  if (i.kind === 'left') {
    i.redirectTo = spellings.has(i.spelling)
      ? spellingPathFor(i.spelling)
      : `/?q=${encodeURIComponent(i.record.written || i.spelling)}`;
  }
}

if (command === 'write') {
  const out = file || path.join(repo, 'tools/slugs/work/changes.md');
  if (auto.length) writeLedger(ledgerPath, ledger);
  if (!items.length) {
    console.log('No address changes to review.');
    process.exit(0);
  }
  const taken = new Map();
  for (const r of Object.values(ledger.entries)) {
    if (!taken.has(r.spelling)) taken.set(r.spelling, new Set());
    taken.get(r.spelling).add(r.word);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, renderSheet(items, { taken }) + '\n');
  const needs = items.filter((i) => i.kind !== 'matched').length;
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${needs} to decide, ${items.length - needs} matched`);
} else if (command === 'apply' && file) {
  const { decisions, problems: parseProblems } = parseSheet(readFileSync(file, 'utf8'));
  const { changes, problems } = applyDecisions({ ledger, items, decisions, entries });
  for (const line of changes) console.log(`  ${line}`);
  const all = [...parseProblems, ...problems];
  if (all.length) {
    console.log(`\n${all.length} problems:`);
    for (const p of all) console.log(`  PROBLEM ${p}`);
    process.exit(1);
  }
  if (!flags.includes('-dry')) writeLedger(ledgerPath, ledger);
  console.log(`\n${changes.length} changes${flags.includes('-dry') ? ' (dry run, nothing written)' : ''}`);
} else {
  console.error('usage: node tools/slugs/changes.mjs write [FILE] | apply FILE [-dry]');
  process.exit(2);
}
