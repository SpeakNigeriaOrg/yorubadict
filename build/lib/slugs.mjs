// build/lib/slugs.mjs
//
// Reads data/url-slugs.json and hands every entry its web address.
//
// Reads, and never writes. That is the whole point of the file: the English word
// in an address could be recomputed from the current first definition on every
// build, and for a while it was - but kaikki-yoruba republishes weekly, so a
// Wiktionary editor rewording one definition would move a page Google had
// already indexed, and nothing would say so. Written down, the address survives
// the rewording. tools/slugs/ is what writes it, offline, with a person reading
// every one.
//
// So a missing or stale ledger is a build failure, not something to paper over
// with a fallback. A fallback here would be a silent address change, which is
// the exact failure the ledger exists to prevent.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { groupBySpelling, RESERVED, pathFor } from './address.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.resolve(__dirname, '../../data/url-slugs.json');

const HOW_TO_FIX =
  'Run:  python3 tools/slugs/seed.py  &&  python3 tools/slugs/check.py\n' +
  'See tools/slugs/README.md for what the ledger is and why the build will not ' +
  'guess an address.';

export function loadLedger(ledgerPath = LEDGER_PATH) {
  if (!existsSync(ledgerPath)) {
    throw new Error(
      `No address ledger at ${path.relative(process.cwd(), ledgerPath)}.\n` +
        `Every entry needs one and the build will not invent them.\n${HOW_TO_FIX}`
    );
  }
  return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

/**
 * Give every entry a `path`, and fail loudly rather than serve a broken one.
 *
 * Mutates the entries, because `path` belongs on the entry: the browser reads it
 * to build a link, and it is one field against 6,273 rows rather than a second
 * file to fetch and keep in step.
 *
 * Returns what the caller needs to write the redirects and the sitemap.
 */
export function attachAddresses(entries, { ledgerPath = LEDGER_PATH } = {}) {
  const ledger = loadLedger(ledgerPath);
  const records = ledger.entries || {};
  const { groups, unresolved } = groupBySpelling(entries);

  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} entries have no address at all, starting with ` +
        `${unresolved.slice(0, 5).map((e) => e.id).join(', ')}.\n` +
        'Add a rule for them in build/lib/address.mjs.'
    );
  }

  // What address.mjs says the first segment is. The ledger's copy is a record,
  // not the authority, and a disagreement means the ledger is describing an
  // address the site does not serve.
  const spellingOf = new Map();
  for (const [spelling, members] of groups) {
    for (const { entry } of members) spellingOf.set(entry.id, spelling);
  }

  const missing = [];
  const drifted = [];
  const shadowing = [];
  const claimed = new Map();

  for (const entry of entries) {
    const record = records[entry.id];
    if (!record) {
      missing.push(entry);
      continue;
    }
    const spelling = spellingOf.get(entry.id);
    if (record.spelling !== spelling) {
      drifted.push(`${entry.id}: ledger /${record.spelling}/, address.mjs /${spelling}/`);
      continue;
    }
    if (RESERVED.has(spelling)) {
      shadowing.push(`${entry.id}: /${spelling}/ would shadow a page of the site`);
      continue;
    }
    const address = pathFor(spelling, record.word);
    if (claimed.has(address)) {
      // The build writes one file per address, so the second write wins and the
      // first entry has no page. Nothing downstream would report it.
      throw new Error(
        `Two entries claim ${address}: ${claimed.get(address)} and ${entry.id}.\n` +
          'An address serves one page, so one of these would have none.\n' +
          'Run:  python3 tools/slugs/check.py'
      );
    }
    claimed.set(address, entry.id);
    entry.path = address;
  }

  if (missing.length) {
    throw new Error(
      `${missing.length} entries have no address in the ledger, starting with ` +
        `${missing.slice(0, 5).map((e) => `${e.id} (${(e.canonicalForm || {}).value})`).join(', ')}.\n` +
        `An entry with no address has no page.\n${HOW_TO_FIX}`
    );
  }
  if (drifted.length) {
    throw new Error(
      `The ledger disagrees with build/lib/address.mjs on ${drifted.length} spellings:\n  ` +
        `${drifted.slice(0, 5).join('\n  ')}\n${HOW_TO_FIX}`
    );
  }
  if (shadowing.length) {
    throw new Error(`${shadowing.length} addresses shadow a page:\n  ${shadowing.join('\n  ')}`);
  }

  // Old addresses that must keep redirecting. Retired only when a word that
  // somebody may have linked to is changed - a provisional placeholder being
  // filled in is not a move and mints nothing.
  const redirects = [];
  for (const [entryId, record] of Object.entries(records)) {
    const live = records[entryId] && pathFor(record.spelling, record.word);
    for (const [spelling, word] of record.retired || []) {
      const from = pathFor(spelling, word);
      if (from !== live && !claimed.has(from)) redirects.push({ from, to: live });
    }
  }

  const approved = Object.values(records).filter((r) => r.approved).length;
  return {
    addresses: claimed,
    redirects,
    stats: {
      total: entries.length,
      approved,
      provisional: Object.values(records).filter((r) => r.provisional).length,
    },
  };
}
