// build/lib/slugs.mjs
//
// Reads data/url-slugs.json and hands every entry its web address.
//
// Reads, and never writes. That is the whole point of the file: the English word
// in an address could be recomputed from the current first definition on every
// build, and for a while it was - but kaikki-yoruba republishes weekly, so a
// Wiktionary editor rewording one definition would move a page Google had
// already indexed, and nothing would say so. Written down, the address survives
// the rewording.
//
// Nothing upstream is allowed to move a live address, and nothing upstream is
// allowed to stop the refresh either. Every change the ledger cannot settle by
// itself is served the safe way and listed for a person on the weekly sheet
// (tools/slugs/changes.mjs):
//
//   an entry whose id changed      matched to its old record (continuity.mjs):
//                                  automatically when the evidence is clear,
//                                  otherwise its old address points at it,
//                                  temporarily, until someone confirms
//   a word that vanished           its address redirects, temporarily, to the
//                                  page for its spelling
//   a spelling that changed        served at its old address until someone
//                                  confirms the move
//   a word never seen before       a rule-made address, out of the sitemap
//
// The only thing that stops the build is a change too large to be an edit -
// hundreds of entries at once means the id scheme itself moved upstream, and
// that wants a programmer, not a sheet.
//
// Provisional pages are served but kept out of the sitemap. The name is a guess
// meant to be replaced, and advertising a guess you intend to change is how a
// moved page gets indexed - the thing this file exists to stop.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  groupBySpelling,
  RESERVED,
  pathFor,
  spellingPathFor,
  foldWord,
  wordFromDefinition,
} from './address.mjs';
import { matchArrivals, snapshot } from './continuity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.resolve(__dirname, '../../data/url-slugs.json');
export const HISTORY_PATH = path.resolve(__dirname, '../../data/address-history.json');

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

/** What was kept of entries that have gone: old id -> snapshot. */
export function loadHistory(historyPath = HISTORY_PATH) {
  return existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')).entries || {} : {};
}

/** entry id -> the first segment of its address, as address.mjs decides it. */
export function spellingsOf(entries) {
  const { groups, unresolved } = groupBySpelling(entries);
  const spellingOf = new Map();
  for (const [spelling, members] of groups) {
    for (const { entry } of members) spellingOf.set(entry.id, spelling);
  }
  return { spellingOf, groups, unresolved };
}

/**
 * The before-picture of every record whose entry is gone: from the history file
 * if it was kept in an earlier week, or from the previous data if it went just
 * now. Without it an old entry is only a spelling and a part of speech, and
 * neither the matcher nor a person can tell a rename from a deletion.
 */
export function snapshotsFor({ records, entries, previous = {}, history = {} }) {
  const live = new Set(entries.map((e) => e.id));
  const out = {};
  const keep = (id, spelling) => {
    if (history[id]) out[id] = history[id];
    else if (previous[id]) out[id] = snapshot(previous[id], spelling);
  };
  for (const [id, record] of Object.entries(records)) {
    if (!live.has(id)) keep(id, record.spelling);
    // A record already moved to a new id still owes the sheet its old side.
    if (record.formerly) keep(record.formerly, record.spelling);
  }
  return out;
}

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

/**
 * More unsettled changes than this in one build is not an editor at work - it
 * is the id scheme changing upstream - and gets a stop rather than a sheet
 * nobody could read.
 */
export const floodLimit = (recordCount) => Math.max(25, Math.round(recordCount * 0.02));

/**
 * Give every entry a `path`, and serve every change the safe way.
 *
 * Mutates the entries, because `path` belongs on the entry: the browser reads it
 * to build a link, and it is one field against 6,273 rows rather than a second
 * file to fetch and keep in step.
 *
 * Returns what the caller needs to write the redirects and the sitemap, and
 * everything the weekly sheet lists.
 */
export function attachAddresses(entries, { ledgerPath = LEDGER_PATH, snapshots = {} } = {}) {
  const ledger = loadLedger(ledgerPath);
  const records = ledger.entries || {};
  const { spellingOf, groups, unresolved } = spellingsOf(entries);

  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} entries have no address at all, starting with ` +
        `${unresolved.slice(0, 5).map((e) => e.id).join(', ')}.\n` +
        'Add a rule for them in build/lib/address.mjs.'
    );
  }

  const { automatic, probable, unmatched } = matchArrivals({ entries, records, spellingOf, snapshots });
  const unsettled = new Set([...unmatched, ...[...probable.values()].flat().map((c) => c.from)]);
  const limit = floodLimit(Object.keys(records).length);
  if (unsettled.size > limit) {
    throw new Error(
      `${unsettled.size} addresses lost their entry this week and could not be matched - more than ` +
        `${limit}, which is not an editor at work. Most likely the way Kaikki or kaikki-yoruba ` +
        'makes entry ids changed. Nothing was published; this wants a programmer to look at ' +
        'build/lib/continuity.mjs against the new release.'
    );
  }
  const movedFrom = new Map(automatic.map((m) => [m.to, m.from]));
  const recordFor = (id) => records[id] || records[movedFrom.get(id)];

  const provisional = new Set();
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
    // A spelling change upstream would move the page. It stays where it is -
    // the ledger's spelling - until a person confirms the move on the sheet.
    const spelling = record.spelling;
    if (spelling !== spellingOf.get(entry.id)) {
      drifted.push({ id: entry.id, from: spelling, to: spellingOf.get(entry.id), word: record.word });
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
    // Left unnamed on purpose. Served, but its name is still the rule's guess,
    // so it stays out of the sitemap like any other placeholder.
    if (record.deferred) provisional.add(entry.id);
  }

  // Entries the ledger has never seen - a word Wiktionary gained, or one whose
  // id changed without clear enough evidence to say which it was. Named by rule
  // and kept out of the sitemap until the sheet settles it.
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
      candidates: (probable.get(entry.id) || []).map((c) => ({
        ...c,
        address: pathFor(records[c.from].spelling, records[c.from].word),
      })),
    });
  }
  if (shadowing.length) {
    throw new Error(`${shadowing.length} addresses shadow a page:\n  ${shadowing.join('\n  ')}`);
  }

  const redirects = [];
  const redirect = (from, to, status) => {
    if (from !== to && !claimed.has(from)) redirects.push({ from, to, status });
  };

  // Old addresses that must keep redirecting. Retired only when a word that
  // somebody may have linked to is changed - a provisional placeholder being
  // filled in is not a move and mints nothing.
  for (const record of Object.values(records)) {
    const live = pathFor(record.spelling, record.word);
    for (const [spelling, word] of record.retired || []) redirect(pathFor(spelling, word), live, 301);
  }

  // An address waiting on a person points somewhere sensible meanwhile, with a
  // 302 because it may point somewhere else next week.
  //
  // A probable rename goes to the entry it probably became; a word that is gone,
  // or that nothing could be matched to, goes to the page for its spelling, or
  // to a search for it when no word is spelled that way any more.
  const bestArrival = new Map();
  for (const n of newcomers) {
    for (const c of n.candidates) {
      const held = bestArrival.get(c.from);
      if (!held || (c.overlap ?? -1) > (held.overlap ?? -1)) bestArrival.set(c.from, { ...c, to: n.address });
    }
  }
  const vanished = [];
  const live = new Set(entries.map((e) => e.id));
  const movedAway = new Set(automatic.map((m) => m.from));
  for (const [id, record] of Object.entries(records)) {
    if (live.has(id) || movedAway.has(id)) continue;
    const from = pathFor(record.spelling, record.word);
    const guess = bestArrival.get(id);
    if (guess) {
      redirect(from, guess.to, 302);
      continue;
    }
    const to = groups.has(record.spelling)
      ? spellingPathFor(record.spelling)
      : `/?q=${encodeURIComponent(record.written || record.spelling)}`;
    redirect(from, to, 302);
    if (!record.gone) vanished.push({ id, address: from, redirectTo: to });
  }

  const approved = Object.values(records).filter((r) => r.approved).length;
  return {
    addresses: claimed,
    provisional,
    newcomers,
    moves: automatic,
    drifted,
    vanished,
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
