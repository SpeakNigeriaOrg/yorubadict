// test/slugs.test.mjs
//
// Covers build/lib/slugs.mjs: what it will guess, and what it still refuses to.
//
// The distinction is the whole design. Changing the word for an entry that
// already has one is a silent address change and stays a build failure. Naming
// an entry that has never had one is not - and used to fail the deploy anyway,
// which meant a single word added to Wiktionary could stop the site from
// publishing until somebody noticed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { attachAddresses } from '../build/lib/slugs.mjs';

const entry = (id, spelling, definition, extra = {}) => ({
  id,
  headword: spelling,
  canonicalForm: { value: spelling },
  pos: 'verb',
  senses: [{ glosses: [definition] }],
  ...extra,
});

/** A ledger holding records for exactly the entries named. */
function ledgerFor(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const file = path.join(dir, 'url-slugs.json');
  fs.writeFileSync(file, JSON.stringify({ entries: records }));
  return file;
}

const record = (spelling, word, extra = {}) => ({
  spelling,
  word,
  source: 'hand',
  approved: true,
  provisional: false,
  retired: [],
  ...extra,
});

test('an entry the ledger has never seen is named, not refused', () => {
  const entries = [entry('en-gbe-yo-verb-AAA', 'gbé', 'to carry')];
  const ledgerPath = ledgerFor({});

  const result = attachAddresses(entries, { ledgerPath });

  assert.equal(entries[0].path, '/yo/gbe/carry');
  assert.ok(result.provisional.has('en-gbe-yo-verb-AAA'), 'and marked as a guess');
  assert.deepEqual(result.newcomers.map((n) => n.source), ['rule']);
});

test('an etymid beats the definition, because a person chose it', () => {
  // 74 entries carry one today. It is a name somebody already picked for this
  // etymology on Wiktionary, so it wins over anything derived from prose here.
  const entries = [
    entry('en-de-yo-verb-BBB', 'dè', 'to fasten something so it cannot move', {
      etymologyTemplates: [{ name: 'etymid', args: { 1: 'yo', 2: 'tie down' } }],
    }),
  ];

  const result = attachAddresses(entries, { ledgerPath: ledgerFor({}) });

  assert.equal(entries[0].path, '/yo/de/tie-down');
  assert.deepEqual(result.newcomers.map((n) => n.source), ['etymid']);
});

test('a new word does not take an address the ledger already spent', () => {
  // The collision that matters is inside one spelling: /yo/gbe holds fifteen
  // words and every one has to differ. A newcomer whose rule-derived name is
  // already spoken for gets numbered rather than overwriting the page.
  const entries = [
    entry('en-gbe-yo-verb-AAA', 'gbé', 'to carry'),
    entry('en-gbe-yo-verb-CCC', 'gbè', 'to carry'),
  ];
  const ledgerPath = ledgerFor({ 'en-gbe-yo-verb-AAA': record('gbe', 'carry') });

  const result = attachAddresses(entries, { ledgerPath });

  assert.equal(entries[0].path, '/yo/gbe/carry', 'the recorded one keeps its address');
  assert.equal(entries[1].path, '/yo/gbe/carry-2', 'the newcomer moves aside');
  assert.equal(result.addresses.size, 2, 'two entries, two pages');
});

test('a spelling changed upstream keeps its old address until someone confirms', () => {
  // ẹni's pronoun lost a wrong headword on Wiktionary and its spelling moved
  // from /owon/ to /eni/. That used to stop every refresh for two weeks. Now
  // the page stays where it was and the move waits on the weekly sheet.
  const entries = [entry('en-eni-yo-pron-AAA', 'ẹni', 'us', { pos: 'pron' })];
  const ledgerPath = ledgerFor({ 'en-eni-yo-pron-AAA': record('owon', 'us') });

  const result = attachAddresses(entries, { ledgerPath });

  assert.equal(entries[0].path, '/yo/owon/us', 'still at the old address');
  assert.deepEqual(result.drifted, [{ id: 'en-eni-yo-pron-AAA', from: 'owon', to: 'eni', word: 'us' }]);
});

test('a missing ledger file is still a failure, not an empty one', () => {
  assert.throws(
    () => attachAddresses([entry('x', 'gbé', 'to carry')], { ledgerPath: '/nowhere/url-slugs.json' }),
    /No address ledger/
  );
});

test('an entry whose id changed keeps the address it had', () => {
  // Wiktionary splitting a page renames its Kaikki ids. The words are the same
  // words, so the addresses are the same addresses - the build-17 refresh moved
  // ten pages by treating renamed ids as new words.
  const entries = [
    entry('en-i/languages_M_to_Z-yo-pron-9deM-3Vx', 'i', 'him'),
    entry('en-eta-yo-noun-NEWTAIL1', 'ẹtà', 'civet cat', { pos: 'noun' }),
  ];
  const ledgerPath = ledgerFor({
    'en-i-yo-pron-9deM-3Vx': record('i', 'him-high', { written: 'i', pos: 'pron' }),
    'en-eta-yo-noun-OLDTAIL1': record('eta', 'civet', { written: 'ẹtà', pos: 'noun' }),
  });
  // What the old ẹtà said, as the history file keeps it: a reworded definition
  // gives a new id hash, so the meaning is what shows it is the same word.
  const snapshots = {
    'en-eta-yo-noun-OLDTAIL1': {
      headword: 'ẹtà', pos: 'noun', etymologyNumber: null, written: 'ẹtà', spelling: 'eta',
      senseIds: ['en-eta-yo-noun-OLDTAIL1'], definitions: ['civet cat'],
    },
  };

  const result = attachAddresses(entries, { ledgerPath, snapshots });

  assert.equal(entries[0].path, '/yo/i/him-high', 'matched by the id tail');
  assert.equal(entries[1].path, '/yo/eta/civet', 'matched by spelling, part of speech and meaning');
  assert.equal(result.newcomers.length, 0);
  assert.equal(result.moves.length, 2);
});

test('a renamed id that could be either of two old records waits for a person', () => {
  // Two old records fit equally. Guessing gives one word's page to another, so
  // neither is chosen: the entry gets a rule-made address, both old addresses
  // point at it for now, and the sheet shows the candidates side by side.
  const entries = [entry('en-oko-yo-noun-NEWTAIL1', 'ọkọ̀', 'boat', { pos: 'noun' })];
  const ledgerPath = ledgerFor({
    'en-oko-yo-noun-OLDTAIL1': record('oko', 'boat', { written: 'ọkọ̀', pos: 'noun' }),
    'en-oko-yo-noun-OLDTAIL2': record('oko', 'canoe', { written: 'ọkọ̀', pos: 'noun' }),
  });

  const result = attachAddresses(entries, { ledgerPath });

  assert.equal(result.moves.length, 0);
  assert.equal(result.newcomers[0].candidates.length, 2);
  // Its rule-made name is "boat", so it simply lives at the vacated /oko/boat;
  // only the other old address needs pointing at it.
  assert.equal(entries[0].path, '/yo/oko/boat');
  assert.deepEqual(
    result.redirects.map((r) => [r.from, r.to, r.status]),
    [['/yo/oko/canoe', '/yo/oko/boat', 302]]
  );
});

test('a word that left redirects to its spelling, or to a search when none is left', () => {
  const entries = [entry('en-gba-yo-verb-KEEP', 'gbà', 'to receive')];
  const ledgerPath = ledgerFor({
    'en-gba-yo-verb-KEEP': record('gba', 'receive'),
    'en-gba-yo-noun-GONE': record('gba', 'sweep', { written: 'gbá', pos: 'noun' }),
    'en-ojupo-yo-noun-GONE': record('ojupo', 'throne', { written: 'ojúpò', pos: 'noun' }),
  });

  const result = attachAddresses(entries, { ledgerPath });
  const to = Object.fromEntries(result.redirects.map((r) => [r.from, [r.to, r.status]]));

  assert.deepEqual(to['/yo/gba/sweep'], ['/yo/gba', 302], 'the page listing what gba still means');
  assert.deepEqual(to['/yo/ojupo/throne'], [`/?q=${encodeURIComponent('ojúpò')}`, 302]);
  assert.equal(result.vanished.length, 2, 'and both are on the sheet');
});

test('a flood of unmatched changes stops the build instead of filling a sheet', () => {
  // Hundreds at once is the id scheme changing upstream, not an editor.
  const records = {};
  for (let i = 0; i < 30; i++) records[`en-w${i}-yo-noun-OLD${String(i).padStart(5, '0')}`] = record(`w${i}`, 'x');
  const entries = [entry('en-keep-yo-verb-AAA', 'kéép', 'to keep')];
  records['en-keep-yo-verb-AAA'] = record('keep', 'keep');

  assert.throws(() => attachAddresses(entries, { ledgerPath: ledgerFor(records) }), /not an editor at work/);
});

test('a genuinely new word is not handed a vanished word\'s address', () => {
  const entries = [entry('en-gbe-yo-verb-NEWTAIL1', 'gbè', 'to take sides')];
  const ledgerPath = ledgerFor({
    'en-gbe-yo-verb-OLDTAIL1': record('gbe', 'carry', { written: 'gbé', pos: 'verb' }),
  });

  const result = attachAddresses(entries, { ledgerPath });

  assert.equal(entries[0].path, '/yo/gbe/take-sides');
  assert.equal(result.moves.length, 0);
});

test('an entry left unnamed on purpose is served, but not advertised', () => {
  // Emptying its line on the weekly sheet records it as deferred: it keeps the
  // rule's address, is not asked about again, and stays out of the sitemap
  // because that address is still a guess.
  const entries = [entry('en-Iyalase-yo-noun-AAA', 'ìyáláṣẹ', 'high priestess')];
  const ledgerPath = ledgerFor({
    'en-Iyalase-yo-noun-AAA': record('iyalase', 'high-priestess-2', {
      provisional: true,
      deferred: true,
      approved: false,
    }),
  });

  const result = attachAddresses(entries, { ledgerPath });

  assert.equal(entries[0].path, '/yo/iyalase/high-priestess-2');
  assert.ok(result.provisional.has('en-Iyalase-yo-noun-AAA'), 'kept out of the sitemap');
  assert.equal(result.newcomers.length, 0, 'and not reported as new again');
});
