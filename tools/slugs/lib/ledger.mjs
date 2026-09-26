// tools/slugs/lib/ledger.mjs — writing data/url-slugs.json from Node.
//
// The same shape tools/slugs/lib/ledger.py's save() writes - sorted keys at every
// level, two spaces, a trailing newline - so the Python and Node tools can both
// write the ledger and a change still diffs as the lines it changed.

import { writeFileSync } from 'node:fs';

const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
      : v;

export function writeLedger(file, ledger) {
  writeFileSync(file, JSON.stringify(sorted(ledger), null, 2) + '\n');
}

/**
 * Move each automatically matched record to its entry's new id, keeping the old
 * id in `formerly` and a `review` mark so the weekly sheet shows it once.
 * Returns the matches it applied. Mutates `ledger`.
 */
export function persistAutomatic(ledger, automatic, entriesById) {
  for (const { from, to, meaningChanged } of automatic) {
    const entry = entriesById.get(to);
    const record = ledger.entries[from];
    // Everything but the address follows the entry, as merge() does in ledger.py.
    ledger.entries[to] = {
      ...record,
      written: (entry.canonicalForm || {}).value || entry.headword,
      pos: entry.pos,
      etymologyNumber: entry.etymologyNumber ?? null,
      formerly: from,
      review: meaningChanged ? ['rekeyed', 'meaning'] : ['rekeyed'],
    };
    delete ledger.entries[from];
  }
  return automatic;
}
