// tools/slugs/lib/changes.mjs — the weekly sheet: every change to an address,
// in one file, with the before and after side by side.
//
// One sheet rather than one per kind, because the kinds explain each other. A
// word that vanished and a word that arrived with the same spelling, in the
// same week, are usually one word edited - and the only way to see that is to
// see both, next to each other, with what each one said. So the sheet is
// grouped by spelling, and each group shows everything that happened to it.
//
// What can appear, and the one line a person may change on each:
//
//   NEW WORD            word:       the English word for its address. Emptied,
//                                   it is left alone and not asked about again.
//                       same as:    an address from last week, if this is that
//                                   word under a new id. Prefilled when the
//                                   matcher found one likely candidate.
//   WORD LEFT           gone:       yes, to confirm it is gone. Until then its
//                                   address redirects to the spelling's page.
//   SPELLING CHANGED    move:       yes, to move its page to the new spelling
//                                   (the old address keeps redirecting).
//   WORD MAY NOT FIT    word:       its address word, which no longer appears in
//                                   its definitions. Change it to rename.
//   MATCHED             same word:  yes. Change to no if the matcher was wrong.
//
// Only lines under an entry id line are read. Merging the pull request that
// holds the sheet is the sign-off.

import { pathFor, foldWord } from '../../../build/lib/address.mjs';
import { matchArrivals, snapshot } from '../../../build/lib/continuity.mjs';

const FIELDS = ['word', 'same as', 'gone', 'move', 'same word'];

const lastSegment = (p) => (p || '').split('/').pop();
const written = (e) => (e.canonicalForm || {}).value || e.headword || '';
const addressOf = (record) => pathFor(record.spelling, record.word);
const yes = (v) => /^(y|yes|true)$/i.test((v || '').trim());
const no = (v) => /^(n|no|false|new)$/i.test((v || '').trim());

/** Accept an address however it was pasted: full URL, with or without /yo. */
function normalizeAddress(text) {
  let t = (text || '').trim().replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '');
  if (t && !t.startsWith('/')) t = `/${t}`;
  if (t && !t.startsWith('/yo/')) t = `/yo${t}`;
  return t;
}

/**
 * Everything the sheet lists, from the ledger and the data as they stand. State,
 * not events: an item stays until it is settled, however many weeks that takes.
 */
export function collectItems({ records, entries, spellingOf, snapshots }) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const { probable } = matchArrivals({ entries, records, spellingOf, snapshots });
  const items = [];

  for (const [id, record] of Object.entries(records)) {
    const entry = byId.get(id);
    if (!entry) {
      if (record.gone) continue;
      items.push({ kind: 'left', id, spelling: record.spelling, record, before: snapshots[id] });
      continue;
    }
    const after = snapshot(entry, spellingOf.get(id));
    if (record.spelling !== spellingOf.get(id)) {
      items.push({ kind: 'spelling', id, spelling: record.spelling, record, after, to: spellingOf.get(id) });
    }
    const review = record.review || [];
    if (review.includes('meaning')) {
      items.push({ kind: 'meaning', id, spelling: record.spelling, record, before: snapshots[record.formerly], after });
    } else if (review.includes('rekeyed')) {
      items.push({ kind: 'matched', id, spelling: record.spelling, record, before: snapshots[record.formerly], after });
    }
  }

  for (const entry of entries) {
    if (records[entry.id]) continue;
    const candidates = (probable.get(entry.id) || []).map((c) => ({
      ...c,
      address: addressOf(records[c.from]),
      before: snapshots[c.from],
    }));
    items.push({
      kind: 'new',
      id: entry.id,
      spelling: spellingOf.get(entry.id),
      after: snapshot(entry, spellingOf.get(entry.id)),
      served: entry.path,
      candidates,
    });
  }
  return items;
}

const quote = (defs, label) =>
  (defs || []).length
    ? defs.slice(0, 3).map((d, i) => `      ${i === 0 ? label : ' '.repeat(label.length)}${i + 1}. ${d}`)
    : [`      ${label}(nothing kept)`];
const pct = (overlap) => (overlap === null || overlap === undefined ? '' : `, ${Math.round(overlap * 100)}% same wording`);

function renderItem(item) {
  const out = [`    ${item.id}`];
  const who = (s) => [s?.written, s?.pos].filter(Boolean).join(' · ');
  if (item.kind === 'new') {
    out.push(`      NEW WORD · ${who(item.after)} · live at ${item.served}`);
    out.push(...quote(item.after.definitions, 'says:  '));
    if (item.candidates.length) {
      out.push('      could be a word that left this week:');
      for (const c of item.candidates) {
        out.push(`        ${c.address} · ${who(c.before) || '?'} (${c.evidence.join(', ')}${pct(c.overlap)})`);
        for (const d of (c.before?.definitions || []).slice(0, 2)) out.push(`            said: ${d}`);
      }
    }
    const likely = item.candidates.length === 1 ? item.candidates[0].address : '';
    out.push(`      same as: ${likely}`);
    out.push(`      word: ${lastSegment(item.served)}`);
  } else if (item.kind === 'left') {
    out.push(`      WORD LEFT · ${addressOf(item.record)} · ${who(item.before) || item.record.written}`);
    out.push(...quote(item.before?.definitions, 'said:  '));
    out.push(`      redirects to ${item.redirectTo || 'the page for its spelling'} for now`);
    out.push('      gone: ');
  } else if (item.kind === 'spelling') {
    out.push(
      `      SPELLING CHANGED · ${who(item.after)} · still at ${addressOf(item.record)}, ` +
        `would move to ${pathFor(item.to, item.record.word)}`
    );
    out.push(...quote(item.after.definitions, 'says:  '));
    out.push('      move: ');
  } else if (item.kind === 'meaning') {
    out.push(`      WORD MAY NOT FIT · ${addressOf(item.record)} · "${item.record.word}" is no longer in its definitions`);
    out.push(...quote(item.before?.definitions, 'said:  '));
    out.push(...quote(item.after.definitions, 'says:  '));
    out.push(`      word: ${item.record.word}`);
  } else if (item.kind === 'matched') {
    out.push(`      MATCHED · ${addressOf(item.record)} kept its address under a new id`);
    out.push(...quote(item.before?.definitions, 'said:  '));
    out.push(...quote(item.after.definitions, 'says:  '));
    out.push('      same word: yes');
  }
  out.push('');
  return out;
}

const ORDER = { left: 0, new: 1, spelling: 2, meaning: 3, matched: 4 };

export function renderSheet(items, { taken = new Map() } = {}) {
  const needs = items.filter((i) => i.kind !== 'matched').length;
  const lines = [
    '# Dictionary changes',
    '',
    `${needs} to decide, ${items.length - needs} matched automatically for you to glance at.`,
    'Everything is already live in a safe form - nothing is broken while this waits.',
    '',
    '## How to fill this in',
    '',
    '1. Click the **⋯** menu at the top right of this file, then **Edit file**.',
    '2. Read each spelling below. It shows every change to that spelling this week,',
    '   old and new definitions side by side - a word that left and a word that',
    '   arrived with the same spelling are often one word, edited.',
    '3. Change only the line at the bottom of each entry:',
    '   - **NEW WORD** - `word:` is the English word its address ends in. Spaces and',
    '     capitals are fine. If it is really a word that left, put that address',
    '     after `same as:` instead. To leave it alone, empty both.',
    '   - **WORD LEFT** - write `yes` after `gone:` if it is really gone. If it',
    '     became one of the new words, say so on that word with `same as:`.',
    '   - **SPELLING CHANGED** - write `yes` after `move:` if the new spelling is',
    '     right. The old address keeps redirecting.',
    '   - **WORD MAY NOT FIT** - its definition changed and no longer contains the',
    '     word in its address. Change `word:` to rename it, or leave it.',
    '   - **MATCHED** - change `yes` to `no` only if these are not the same word.',
    '   A line left empty just waits for next week.',
    '4. Click **Commit changes**. A check comments with what will happen, or what',
    '   to fix. When it shows ✓, click **Merge pull request** - that is the sign-off.',
    '',
  ];
  const bySpelling = new Map();
  for (const item of items) {
    if (!bySpelling.has(item.spelling)) bySpelling.set(item.spelling, []);
    bySpelling.get(item.spelling).push(item);
  }
  const needsFirst = [...bySpelling].sort(
    ([a, x], [b, y]) =>
      Math.min(...x.map((i) => ORDER[i.kind])) - Math.min(...y.map((i) => ORDER[i.kind])) || a.localeCompare(b)
  );
  for (const [spelling, group] of needsFirst) {
    lines.push(`## /yo/${spelling}/`, '');
    const others = [...(taken.get(spelling) || [])].filter(
      (word) => !group.some((i) => i.record && i.record.word === word)
    );
    if (others.length) lines.push(`    other words here: ${others.join(', ')}`, '');
    for (const item of group.sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) lines.push(...renderItem(item));
  }
  return lines.join('\n');
}

/** { id: { field: value } } from a sheet. Only fields under an id line count. */
export function parseSheet(markdown) {
  const decisions = {};
  const problems = [];
  let current = null;
  markdown.split(/\r?\n/).forEach((line, i) => {
    if (/^#/.test(line)) {
      current = null;
      return;
    }
    const id = line.match(/^ {4}(\S+-yo-\S+)\s*$/);
    if (id) {
      current = id[1];
      decisions[current] ??= {};
      return;
    }
    const field = line.match(/^\s+(word|same as|gone|move|same word):(.*)$/);
    if (!field) return;
    if (!current) {
      problems.push(`line ${i + 1}: "${line.trim()}" is not under an entry`);
      return;
    }
    decisions[current][field[1]] = field[2].trim();
  });
  return { decisions, problems };
}

/**
 * Apply a person's decisions to the ledger. Items are recomputed from the
 * current state, so a sheet that went stale - something settled itself since it
 * was written - skips what no longer applies instead of doing it twice.
 *
 * Returns { changes, problems }: lines saying what will happen, and anything
 * that stops it. Mutates `ledger` only if there are no problems.
 */
export function applyDecisions({ ledger, items, decisions, entries }) {
  const records = structuredClone(ledger.entries);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const published = Boolean(ledger.published);
  const changes = [];
  const problems = [];
  const item = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  const find = (kinds, id) => kinds.map((k) => item.get(`${k}:${id}`)).find(Boolean);
  const orphanAt = new Map(
    items.filter((i) => i.kind === 'left').map((i) => [addressOf(i.record), i.id])
  );
  const claimedOrphans = new Map();

  for (const [id, d] of Object.entries(decisions)) {
    // A new word: the same as a word that left, named, or left alone.
    const arrival = find(['new'], id);
    if (arrival) {
      const entry = byId.get(id);
      const target = d['same as'] && !no(d['same as']) ? normalizeAddress(d['same as']) : '';
      if (target) {
        const oldId = orphanAt.get(target);
        if (!oldId) {
          problems.push(`${written(entry)}: "same as: ${d['same as']}" is not the address of a word that left`);
          continue;
        }
        if (claimedOrphans.has(oldId)) {
          problems.push(`${target} is given as "same as" for two new words`);
          continue;
        }
        claimedOrphans.set(oldId, id);
        records[id] = {
          ...records[oldId],
          written: written(entry),
          pos: entry.pos,
          etymologyNumber: entry.etymologyNumber ?? null,
          formerly: oldId,
        };
        delete records[id].review;
        delete records[oldId];
        changes.push(`${target} now shows ${written(entry)} (the same word, edited)`);
        continue;
      }
      const word = foldWord(d.word || '');
      const spelling = arrival.spelling;
      if (word) {
        records[id] = {
          spelling,
          word,
          source: 'hand',
          approved: true,
          provisional: false,
          written: written(entry),
          pos: entry.pos,
          etymologyNumber: entry.etymologyNumber ?? null,
          retired: [],
        };
        changes.push(`${pathFor(spelling, word)}  (${written(entry)}, new)`);
      } else {
        records[id] = {
          spelling,
          word: lastSegment(arrival.served),
          source: 'rule',
          approved: false,
          provisional: true,
          deferred: true,
          written: written(entry),
          pos: entry.pos,
          etymologyNumber: entry.etymologyNumber ?? null,
          retired: [],
        };
        changes.push(`${arrival.served}  (${written(entry)}, left alone)`);
      }
      continue;
    }

    const left = find(['left'], id);
    if (left && yes(d.gone)) {
      if (claimedOrphans.has(id) || [...Object.values(decisions)].some((x) => normalizeAddress(x['same as'] || '') === addressOf(left.record))) {
        problems.push(`${addressOf(left.record)} is marked gone and also given as "same as" for a new word`);
        continue;
      }
      records[id] = { ...records[id], gone: true };
      changes.push(`${addressOf(left.record)} is gone; it keeps redirecting to its spelling's page`);
    }

    const spelling = find(['spelling'], id);
    if (spelling && yes(d.move)) {
      const r = records[id];
      const from = addressOf(r);
      if (published) r.retired = [...(r.retired || []), [r.spelling, r.word]];
      r.spelling = spelling.to;
      r.written = written(byId.get(id));
      changes.push(`${from} → ${addressOf(r)} (the old address redirects)`);
    }

    const meaning = find(['meaning'], id);
    if (meaning) {
      const r = records[id];
      const word = foldWord(d.word || '');
      if (word && word !== r.word) {
        const from = addressOf(r);
        if (published) r.retired = [...(r.retired || []), [r.spelling, r.word]];
        Object.assign(r, { word, source: 'hand', approved: true });
        changes.push(`${from} → ${addressOf(r)} (renamed; the old address redirects)`);
      }
      delete r.review;
      delete r.formerly;
    }

    const matched = find(['matched'], id);
    if (matched) {
      const r = records[id];
      if (no(d['same word']) && r.formerly) {
        // Undo, and remember: the matcher must not offer this pair again.
        records[r.formerly] = { ...r, notSameAs: [...(r.notSameAs || []), id] };
        delete records[r.formerly].formerly;
        delete records[r.formerly].review;
        delete records[id];
        changes.push(`${addressOf(r)} is NOT the same word as ${written(byId.get(id))}; both will be listed again`);
      } else {
        delete r.review;
        delete r.formerly;
      }
    }
  }

  if (!problems.length) ledger.entries = records;
  return { changes, problems };
}
