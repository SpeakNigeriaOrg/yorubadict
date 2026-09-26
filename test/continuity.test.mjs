// test/continuity.test.mjs
//
// Covers build/lib/continuity.mjs against the kinds of edit that change a
// Kaikki id. An entry's id is its first sense's id: page, part of speech, and a
// hash of that sense's text. Every case below happened, or is one edit away.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchArrivals, meaningOverlap, wordStillFits } from '../build/lib/continuity.mjs';

const entry = (id, written, pos, definitions, senseIds = [id]) => ({
  id,
  headword: written,
  pos,
  canonicalForm: { value: written },
  senses: definitions.map((g, i) => ({ id: senseIds[i], glosses: [g] })),
});
const shot = (id, written, spelling, pos, definitions, senseIds = [id]) => ({
  headword: written, pos, etymologyNumber: null, written, spelling, senseIds, definitions,
});
const run = (entries, records, snapshots) =>
  matchArrivals({
    entries,
    records,
    snapshots,
    spellingOf: new Map(entries.map((e) => [e.id, e.canonicalForm.value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ẹ|ẹ/g, 'e').toLowerCase()])),
  });

test('one word deleted from a definition is the same word', () => {
  // ẹrẹja lost "Èkìtì" from its definition and got a new id.
  const r = run(
    [entry('en-ereja-yo-noun-NEW00001', 'ereja', 'noun', ['market square; the central market in a Yorùbá town'])],
    { 'en-ereja-yo-noun-OLD00001': { spelling: 'ereja', word: 'market-square', pos: 'noun' } },
    { 'en-ereja-yo-noun-OLD00001': shot('en-ereja-yo-noun-OLD00001', 'ereja', 'ereja', 'noun', ['market square; the central market in an Èkìtì Yorùbá town']) }
  );
  assert.deepEqual(r.automatic.map((m) => [m.from, m.to]), [['en-ereja-yo-noun-OLD00001', 'en-ereja-yo-noun-NEW00001']]);
});

test('a sense added above the first keeps the old id among the senses', () => {
  const r = run(
    [entry('en-gba-yo-verb-NEWFIRST', 'gba', 'verb', ['to sweep', 'to receive'], ['en-gba-yo-verb-NEWFIRST', 'en-gba-yo-verb-OLDFIRST'])],
    { 'en-gba-yo-verb-OLDFIRST': { spelling: 'gba', word: 'receive', pos: 'verb' } },
    {}
  );
  assert.equal(r.automatic.length, 1);
  assert.match(r.automatic[0].evidence.join(), /old id is one of the new entry's senses/);
});

test('a page split keeps the id hash, even between near-identical pronouns', () => {
  // `i` was split by language; its two pronouns differ only in a tone.
  const him = (tone) => `him, her, it (after a verb with a ${tone}-tone /i/)`;
  const r = run(
    [
      entry('en-i/M-Z-yo-pron-HIGH0001', 'i', 'pron', [him('high')]),
      entry('en-i/M-Z-yo-pron-LOW00001', 'í', 'pron', [him('low')]),
    ],
    {
      'en-i-yo-pron-HIGH0001': { spelling: 'i', word: 'him-high', pos: 'pron' },
      'en-i-yo-pron-LOW00001': { spelling: 'i', word: 'him-low', pos: 'pron' },
    },
    {
      'en-i-yo-pron-HIGH0001': shot('en-i-yo-pron-HIGH0001', 'i', 'i', 'pron', [him('high')]),
      'en-i-yo-pron-LOW00001': shot('en-i-yo-pron-LOW00001', 'í', 'i', 'pron', [him('low')]),
    }
  );
  assert.deepEqual(
    r.automatic.map((m) => m.to.slice(-8) === m.from.slice(-8)),
    [true, true],
    'each pronoun to its own old record'
  );
});

test('an address word that left the definitions is flagged, not silently kept', () => {
  // Okù: first sense "Contextually, the word may imply ancestors..." became
  // "Ancestors...". Same word, but /oku/contextually no longer describes it.
  assert.equal(
    wordStillFits('contextually', ['Contextually, the word may imply ancestors'], ['Ancestors, in relation to worship']),
    false
  );
  assert.equal(wordStillFits('musket', ['musket, rifle'], ['musket, rifle, Dane gun']), true);
  assert.equal(wordStillFits('him-high', ['him, her, it'], ['him, her, it']), true);
});

test('adding to a definition still reads as the same meaning', () => {
  assert.equal(meaningOverlap(['musket, rifle'], ['musket, rifle, Dane gun']), 1);
  assert.ok(meaningOverlap(['a boat'], ['a kind of yam']) < 0.3);
});

test('a pair a person rejected is never offered again', () => {
  const r = run(
    [entry('en-dakun-yo-intj-yo:please', 'dakun', 'intj', ['excuse me, please'])],
    { 'en-dakun-yo-intj-OLD00001': { spelling: 'dakun', word: 'excuse', pos: 'intj', notSameAs: ['en-dakun-yo-intj-yo:please'] } },
    { 'en-dakun-yo-intj-OLD00001': shot('en-dakun-yo-intj-OLD00001', 'dakun', 'dakun', 'intj', ['excuse me, please']) }
  );
  assert.equal(r.automatic.length, 0);
  assert.equal(r.probable.size, 0);
  assert.deepEqual(r.unmatched, ['en-dakun-yo-intj-OLD00001']);
});

test('weak evidence is a question for a person, not an answer', () => {
  // Same spelling and part of speech, nothing else in common.
  const r = run(
    [entry('en-oko-yo-noun-NEW00001', 'oko', 'noun', ['a farm'])],
    { 'en-oko-yo-noun-OLD00001': { spelling: 'oko', word: 'hoe', pos: 'noun' } },
    { 'en-oko-yo-noun-OLD00001': shot('en-oko-yo-noun-OLD00001', 'oko', 'oko', 'noun', ['a hoe']) }
  );
  assert.equal(r.automatic.length, 0);
  assert.deepEqual([...r.probable.keys()], ['en-oko-yo-noun-NEW00001']);
});
