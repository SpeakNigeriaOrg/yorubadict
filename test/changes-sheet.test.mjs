// test/changes-sheet.test.mjs
//
// Covers tools/slugs/lib/changes.mjs: the weekly sheet, as a person uses it -
// rendered, edited in a browser, read back, applied to the ledger.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectItems, renderSheet, parseSheet, applyDecisions } from '../tools/slugs/lib/changes.mjs';

const entry = (id, written, pos, definition, path) => ({
  id, headword: written, pos, canonicalForm: { value: written },
  senses: [{ id, glosses: [definition] }], path,
});
const record = (spelling, word, extra = {}) => ({
  spelling, word, source: 'hand', approved: true, provisional: false, retired: [], ...extra,
});

/** One week: ojúpò vanished, ọ̀kọ̀ arrived (maybe a rename of the old canoe), ẹni respelled. */
function week() {
  const entries = [
    entry('en-oko-yo-noun-NEW', 'ọkọ̀', 'noun', 'a canoe', '/yo/oko/canoe-2'),
    entry('en-eni-yo-pron-SAME', 'ẹni', 'pron', 'us', '/yo/owon/us'),
    entry('en-gba-yo-verb-NEW', 'gbà', 'verb', 'to receive', '/yo/gba/receive'),
  ];
  const ledger = {
    published: true,
    entries: {
      'en-oko-yo-noun-OLD': record('oko', 'canoe', { written: 'ọkọ̀', pos: 'noun' }),
      'en-ojupo-yo-noun-OLD': record('ojupo', 'throne', { written: 'ojúpò', pos: 'noun' }),
      'en-eni-yo-pron-SAME': record('owon', 'us', { written: 'ọ̀wọn', pos: 'pron' }),
    },
  };
  const spellingOf = new Map([
    ['en-oko-yo-noun-NEW', 'oko'],
    ['en-eni-yo-pron-SAME', 'eni'],
    ['en-gba-yo-verb-NEW', 'gba'],
  ]);
  const snapshots = {
    'en-oko-yo-noun-OLD': { headword: 'ọkọ̀', pos: 'noun', etymologyNumber: 2, written: 'ọkọ̀', spelling: 'oko', senseIds: [], definitions: ['a dugout'] },
    'en-ojupo-yo-noun-OLD': { headword: 'ojúpò', pos: 'noun', etymologyNumber: null, written: 'ojúpò', spelling: 'ojupo', senseIds: [], definitions: ['throne, royal seat'] },
  };
  const items = collectItems({ records: ledger.entries, entries, spellingOf, snapshots });
  return { entries, ledger, items };
}

/** Change `field:` in the block under `id`, as someone editing on github.com would. */
function edit(sheet, id, field, value) {
  const start = sheet.indexOf(`    ${id}\n`);
  const at = sheet.indexOf(`      ${field}:`, start);
  const end = sheet.indexOf('\n', at);
  return sheet.slice(0, at) + `      ${field}: ${value}` + sheet.slice(end);
}

test('the sheet shows a word that left beside a word that arrived with its spelling', () => {
  const { items } = week();
  const sheet = renderSheet(items);
  const oko = sheet.slice(sheet.indexOf('## /yo/oko/'), sheet.indexOf('## ', sheet.indexOf('## /yo/oko/') + 1));
  assert.match(oko, /WORD LEFT · \/yo\/oko\/canoe/);
  assert.match(oko, /said:  1\. a dugout/);
  assert.match(oko, /NEW WORD · ọkọ̀ · noun/);
  assert.match(oko, /could be a word that left this week:\n\s+\/yo\/oko\/canoe/);
  assert.match(oko, /same as: \/yo\/oko\/canoe/, 'the one likely match is prefilled');
});

test('"same as" moves the old address to the new entry', () => {
  const { entries, ledger, items } = week();
  let sheet = renderSheet(items);
  sheet = edit(sheet, 'en-ojupo-yo-noun-OLD', 'gone', 'yes');
  const { decisions } = parseSheet(sheet);
  const { changes, problems } = applyDecisions({ ledger, items, decisions, entries });

  assert.deepEqual(problems, []);
  assert.equal(ledger.entries['en-oko-yo-noun-NEW'].word, 'canoe');
  assert.equal(ledger.entries['en-oko-yo-noun-NEW'].formerly, 'en-oko-yo-noun-OLD');
  assert.equal(ledger.entries['en-oko-yo-noun-OLD'], undefined);
  assert.equal(ledger.entries['en-ojupo-yo-noun-OLD'].gone, true);
  assert.ok(changes.some((c) => c.startsWith('/yo/oko/canoe now shows')));
});

test('an emptied "same as" makes it a new word, named as written', () => {
  const { entries, ledger, items } = week();
  let sheet = renderSheet(items);
  sheet = edit(sheet, 'en-oko-yo-noun-NEW', 'same as', '');
  sheet = edit(sheet, 'en-oko-yo-noun-NEW', 'word', 'Dugout Canoe');
  const { decisions } = parseSheet(sheet);
  applyDecisions({ ledger, items, decisions, entries });

  assert.equal(ledger.entries['en-oko-yo-noun-NEW'].word, 'dugout-canoe', 'spaces and capitals folded');
  assert.ok(ledger.entries['en-oko-yo-noun-OLD'], 'the old one still waits: nobody said it was gone');
});

test('confirming a spelling move keeps the old address as a redirect', () => {
  const { entries, ledger, items } = week();
  const { decisions } = parseSheet(edit(renderSheet(items), 'en-eni-yo-pron-SAME', 'move', 'yes'));
  applyDecisions({ ledger, items, decisions, entries });

  const r = ledger.entries['en-eni-yo-pron-SAME'];
  assert.equal(r.spelling, 'eni');
  assert.deepEqual(r.retired, [['owon', 'us']]);
});

test('a contradiction is refused whole, with a reason a person can act on', () => {
  const { entries, ledger, items } = week();
  const before = structuredClone(ledger);
  let sheet = renderSheet(items);
  sheet = edit(sheet, 'en-oko-yo-noun-OLD', 'gone', 'yes');
  const { decisions } = parseSheet(sheet);
  const { problems } = applyDecisions({ ledger, items, decisions, entries });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /marked gone and also given as "same as"/);
  assert.deepEqual(ledger, before, 'nothing half-applied');
});

test('a "same as" that is not a word that left is refused', () => {
  const { entries, ledger, items } = week();
  const { decisions } = parseSheet(edit(renderSheet(items), 'en-oko-yo-noun-NEW', 'same as', 'yorubadict.com/yo/gba/receive'));
  const { problems } = applyDecisions({ ledger, items, decisions, entries });
  assert.match(problems[0], /is not the address of a word that left/);
});

test('empty lines wait for next week', () => {
  const { entries, ledger, items } = week();
  let sheet = renderSheet(items);
  sheet = edit(sheet, 'en-oko-yo-noun-NEW', 'same as', '');
  sheet = edit(sheet, 'en-oko-yo-noun-NEW', 'word', '');
  sheet = edit(sheet, 'en-gba-yo-verb-NEW', 'word', '');
  const { decisions } = parseSheet(sheet);
  applyDecisions({ ledger, items, decisions, entries });

  assert.equal(ledger.entries['en-ojupo-yo-noun-OLD'].gone, undefined, 'not confirmed gone');
  assert.equal(ledger.entries['en-eni-yo-pron-SAME'].spelling, 'owon', 'not moved');
  assert.equal(ledger.entries['en-gba-yo-verb-NEW'].deferred, true, 'an emptied new word is left alone for good');
});
