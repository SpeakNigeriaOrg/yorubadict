#!/usr/bin/env node
// tools/slugs/rekey.mjs — move ledger records to entries whose Kaikki id changed.
//
// The build already serves a moved entry at its old address (matchMovedEntries in
// build/lib/slugs.mjs); this writes that pairing into data/url-slugs.json so the
// ledger says what the site does, check.py stops calling the old record an orphan,
// and seed.py does not hand the new id a second, colliding record.
//
// Same matcher as the build, so the two cannot disagree. Ambiguous pairings are
// printed and left alone - they stop the build until a person settles them.
//
// Usage:
//     node tools/slugs/rekey.mjs          write the moves
//     node tools/slugs/rekey.mjs -dry     say what would move, write nothing

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { groupBySpelling } from '../../build/lib/address.mjs';
import { loadLedger, matchMovedEntries } from '../../build/lib/slugs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = path.join(repo, 'data/url-slugs.json');
const dry = process.argv.includes('-dry');

const entries = Object.values(
  JSON.parse(readFileSync(path.join(repo, 'public/data/entries.json'), 'utf8'))
);
const ledger = loadLedger(ledgerPath);
const { groups } = groupBySpelling(entries);
const spellingOf = new Map();
for (const [spelling, members] of groups) {
  for (const { entry } of members) spellingOf.set(entry.id, spelling);
}

const { moves, ambiguous } = matchMovedEntries(entries, ledger.entries, spellingOf);
const byId = new Map(entries.map((e) => [e.id, e]));
for (const { from, to } of moves) {
  const entry = byId.get(to);
  const record = ledger.entries[from];
  console.log(`  ${from} -> ${to}  (${record.spelling}/${record.word})`);
  // Everything but the address follows the entry, as merge() does in ledger.py.
  ledger.entries[to] = {
    ...record,
    written: (entry.canonicalForm || {}).value || entry.headword,
    pos: entry.pos,
    etymologyNumber: entry.etymologyNumber ?? null,
  };
  delete ledger.entries[from];
}
for (const line of ambiguous) console.log(`  AMBIGUOUS ${line}`);

// The same shape ledger.py's save() writes - sorted keys at every level, two
// spaces, a trailing newline - so a rekey diffs as the lines it changed.
const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k])]))
      : value;

if (!dry && moves.length) writeFileSync(ledgerPath, JSON.stringify(sorted(ledger), null, 2) + '\n');
console.log(
  `${dry ? 'would move' : 'moved'} ${moves.length} records` +
    (ambiguous.length ? `, ${ambiguous.length} ambiguous left for a person` : '')
);
process.exit(ambiguous.length ? 1 : 0);
