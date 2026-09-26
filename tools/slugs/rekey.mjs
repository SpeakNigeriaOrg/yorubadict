#!/usr/bin/env node
// tools/slugs/rekey.mjs — move ledger records to entries whose Kaikki id changed.
//
// The build already serves an automatically matched entry at its old address
// (build/lib/continuity.mjs); this writes that pairing into data/url-slugs.json
// so the ledger says what the site does. The refresh workflow runs it after
// every build and commits the result with the data.
//
// Each moved record keeps `formerly` (its old id) and a `review` mark, so the
// weekly sheet shows it once, before and after, for a person to see - and asks
// about it properly when the word in its address no longer fits the entry.
// Probable matches are not moved here: those wait for the sheet.
//
// Usage:
//     node tools/slugs/rekey.mjs          write the moves
//     node tools/slugs/rekey.mjs -dry     say what would move, write nothing

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadLedger, loadHistory, snapshotsFor, spellingsOf } from '../../build/lib/slugs.mjs';
import { matchArrivals } from '../../build/lib/continuity.mjs';
import { writeLedger, persistAutomatic } from './lib/ledger.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = path.join(repo, 'data/url-slugs.json');
const dry = process.argv.includes('-dry');

const entries = Object.values(
  JSON.parse(readFileSync(path.join(repo, 'public/data/entries.json'), 'utf8'))
);
const ledger = loadLedger(ledgerPath);
const { spellingOf } = spellingsOf(entries);
const snapshots = snapshotsFor({ records: ledger.entries, entries, history: loadHistory() });
const { automatic } = matchArrivals({ entries, records: ledger.entries, spellingOf, snapshots });

const byId = new Map(entries.map((e) => [e.id, e]));
for (const { from, to, meaningChanged } of automatic) {
  const record = ledger.entries[from];
  console.log(`  ${from} -> ${to}  (${record.spelling}/${record.word})${meaningChanged ? "  meaning changed" : ""}`);
}
persistAutomatic(ledger, automatic, byId);

if (!dry && automatic.length) writeLedger(ledgerPath, ledger);
console.log(`${dry ? 'would move' : 'moved'} ${automatic.length} records`);

