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
// So a ledger that DISAGREES with itself or with address.mjs is a build failure,
// not something to paper over: changing the word for an entry that already has
// one is a silent address change, which is the exact failure the ledger exists
// to prevent.
//
// An entry the ledger has never seen is a different case, and used to be treated
// the same. kaikki-yoruba republishes weekly and Wiktionary gains words, so a
// new entry would fail the deploy - the whole site stuck on one unnamed word
// until somebody noticed. There is no address to change there, because there
// has never been one. It gets a rule-derived name marked provisional, which the
// ledger's own rules already say may be replaced without minting a redirect.
//
// Provisional pages are served but kept out of the sitemap. The name is a guess
// meant to be replaced, and advertising a guess you intend to change is how a
// moved page gets indexed - the thing this file exists to stop.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { groupBySpelling, RESERVED, pathFor, foldWord, wordFromDefinition } from './address.mjs';

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

/**
 * A first address for an entry the ledger has never seen.
 *
 * An {{etymid}} first, where one exists: it is a name a person already chose for
 * this etymology on Wiktionary, which beats anything derived from prose here. It
 * is also rare - 74 entries carry one - so the definition rule does most of the
 * work, and does it badly enough that the result is marked provisional rather
 * than trusted.
 *
 * `taken` is the words already used inside this one spelling, which is where
 * addresses collide: /yo/gbe holds fifteen words and every one has to differ.
 */
function provisionalWord(entry, taken) {
  const etymid = (entry.etymologyTemplates || []).find((t) => t.name === 'etymid');
  const named = etymid ? foldWord((etymid.args || {})['2'] || '') : '';
  const definition = (entry.senses || [])
    .map((sense) => (sense.glosses || [])[0])
    .find(Boolean);
  const base = named || foldWord(wordFromDefinition(definition || '')) || 'word';

  let word = base;
  let n = 2;
  while (taken.has(word)) word = `${base}-${n++}`;
  taken.add(word);
  return { word, source: named ? 'etymid' : 'rule' };
}

/** The random tail of a Kaikki id. It survives most renames of the rest. */
const idTail = (id) => id.slice(-8);
const writtenOf = (entry) =>
  ((entry.canonicalForm || {}).value || entry.headword || '').normalize('NFC');

/**
 * Entries whose Kaikki id changed, paired with the record they used to have.
 *
 * An id is somebody else's key. Wiktionary splitting the page for `i` by
 * language renamed five of them at once; a part of speech corrected from num to
 * noun renamed another. Without this, each looked like a new word, got a new
 * address, and its old one - linked, indexed - went dead with nothing reporting
 * it. That happened, to ten pages, in the build-17 refresh.
 *
 * A record is only a candidate if its own entry is gone and it has the same
 * spelling. Then, in order: the same id tail, or failing that the same written
 * form and part of speech. A pairing is taken only when it is one-to-one;
 * anything else is returned as ambiguous for a person to settle, because
 * guessing wrong gives one word's page to another.
 */
export function matchMovedEntries(entries, records, spellingOf) {
  const live = new Set(entries.map((e) => e.id));
  const orphans = Object.entries(records).filter(([id]) => !live.has(id));
  const candidatesFor = new Map();
  for (const entry of entries) {
    if (records[entry.id]) continue;
    const spelling = spellingOf.get(entry.id);
    const same = orphans.filter(([, r]) => r.spelling === spelling);
    let found = same.filter(([id]) => idTail(id) === idTail(entry.id));
    if (!found.length) {
      found = same.filter(
        ([, r]) => (r.written || '').normalize('NFC') === writtenOf(entry) && r.pos === entry.pos
      );
    }
    if (found.length) candidatesFor.set(entry.id, found.map(([id]) => id));
  }

  const claimants = new Map();
  for (const [entryId, ids] of candidatesFor) {
    for (const id of ids) claimants.set(id, [...(claimants.get(id) || []), entryId]);
  }
  const moves = [];
  const ambiguous = [];
  for (const [entryId, ids] of candidatesFor) {
    if (ids.length === 1 && claimants.get(ids[0]).length === 1) {
      moves.push({ from: ids[0], to: entryId });
    } else {
      ambiguous.push(`${entryId} could be ${ids.join(' or ')}`);
    }
  }
  return { moves, ambiguous };
}

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

  // Moved entries first: an entry whose id changed keeps the record, and so the
  // address, it had under the old id. Ambiguity stops the build, like drift.
  const { moves, ambiguous } = matchMovedEntries(entries, records, spellingOf);
  if (ambiguous.length) {
    throw new Error(
      `${ambiguous.length} entries changed id and could belong to more than one old address:\n  ` +
        `${ambiguous.slice(0, 5).join('\n  ')}\n` +
        'Settle each one in data/url-slugs.json by moving the right record to the new id.'
    );
  }
  const movedFrom = new Map(moves.map((m) => [m.to, m.from]));
  const recordFor = (id) => records[id] || records[movedFrom.get(id)];

  const missing = [];
  const newcomers = [];
  const drifted = [];
  const shadowing = [];
  const claimed = new Map();
  // Words already spoken for inside one spelling. A provisional name has to
  // differ from them, and they are only known after every record is read.
  const takenIn = new Map();
  const takenFor = (spelling) => {
    if (!takenIn.has(spelling)) takenIn.set(spelling, new Set());
    return takenIn.get(spelling);
  };

  for (const entry of entries) {
    const record = recordFor(entry.id);
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
    takenFor(spelling).add(record.word);
    entry.path = address;
  }

  // Entries the ledger has never seen - a word Wiktionary gained since it was
  // last written. Named by rule and marked provisional rather than failing the
  // deploy: see the note at the top of this file for why this is not the silent
  // address change the ledger forbids.
  const provisional = new Set();
  for (const entry of missing) {
    const spelling = spellingOf.get(entry.id);
    if (RESERVED.has(spelling)) {
      shadowing.push(`${entry.id}: /${spelling}/ would shadow a page of the site`);
      continue;
    }
    const { word, source } = provisionalWord(entry, takenFor(spelling));
    const address = pathFor(spelling, word);
    if (claimed.has(address)) {
      // takenFor should have prevented this. If it has not, the numbering rule
      // is wrong and silently dropping one of the two would hide it.
      throw new Error(
        `Provisional address ${address} for ${entry.id} is already ${claimed.get(address)}.`
      );
    }
    claimed.set(address, entry.id);
    entry.path = address;
    provisional.add(entry.id);
    newcomers.push({
      id: entry.id,
      address,
      source,
      spelling: (entry.canonicalForm || {}).value,
      definition: (entry.senses || []).map((s) => (s.glosses || [])[0]).find(Boolean) || '',
    });
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
    provisional,
    newcomers,
    moves,
    redirects,
    stats: {
      total: entries.length,
      approved,
      // Both kinds: a record the ledger itself marks as a placeholder, and an
      // entry with no record at all. Counting only the first said "0 still
      // placeholders" on a build that had just invented three addresses.
      provisional:
        Object.values(records).filter((r) => r.provisional).length + newcomers.length,
    },
  };
}
