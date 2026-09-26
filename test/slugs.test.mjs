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

test('changing the word for an entry that already has one is still a failure', () => {
  // The line this file draws. There is no address to change for a new entry;
  // for a known one there is, and quietly changing it is what the ledger exists
  // to prevent.
  const entries = [entry('en-gbe-yo-verb-AAA', 'gbé', 'to carry')];
  const ledgerPath = ledgerFor({ 'en-gbe-yo-verb-AAA': record('WRONG', 'carry') });

  assert.throws(
    () => attachAddresses(entries, { ledgerPath }),
    /disagrees with build\/lib\/address\.mjs/
  );
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

  const result = attachAddresses(entries, { ledgerPath });

  assert.equal(entries[0].path, '/yo/i/him-high', 'matched by the id tail');
  assert.equal(entries[1].path, '/yo/eta/civet', 'matched by spelling and part of speech');
  assert.equal(result.newcomers.length, 0);
  assert.equal(result.moves.length, 2);
});

test('a renamed id that could be either of two old records stops the build', () => {
  const entries = [entry('en-oko-yo-noun-NEWTAIL1', 'ọkọ̀', 'boat', { pos: 'noun' })];
  const ledgerPath = ledgerFor({
    'en-oko-yo-noun-OLDTAIL1': record('oko', 'boat', { written: 'ọkọ̀', pos: 'noun' }),
    'en-oko-yo-noun-OLDTAIL2': record('oko', 'canoe', { written: 'ọkọ̀', pos: 'noun' }),
  });

  assert.throws(() => attachAddresses(entries, { ledgerPath }), /could belong to more than one/);
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
