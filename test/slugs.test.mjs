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
