// test/slug-ingest.test.mjs
//
// tools/slugs/propose.py -ingest takes answers from agents and writes web
// addresses out of them. Addresses are permanent, and an agent is not a
// contract, so ingest refuses far more than it accepts. This checks that it
// actually refuses.
//
// A wrong address is much worse than a missing one. A missing one falls back to
// a rule-derived placeholder that reads acceptably; a wrong one is a permanent
// promise to the wrong page, and the only sign is a reader landing somewhere
// they did not mean to be.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ingest = path.join(repoDir, 'tools/slugs/propose.py');

const python = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return 'python3';
  } catch {
    return null;
  }
})();

/** Run -ingest against a throwaway answers directory and a copy of the ledger. */
function runIngest(answers) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slug-ingest-'));
  const answersDir = path.join(work, 'answers');
  fs.mkdirSync(answersDir, { recursive: true });
  fs.writeFileSync(path.join(answersDir, '001.json'), JSON.stringify(answers));

  const ledgerPath = path.join(work, 'url-slugs.json');
  fs.copyFileSync(path.join(repoDir, 'data/url-slugs.json'), ledgerPath);

  // Point the module's paths at the copies rather than the real ones.
  const shim = `
import sys, pathlib
sys.path.insert(0, ${JSON.stringify(path.join(repoDir, 'tools/slugs'))})
from lib import ledger
ledger.LEDGER_PATH = pathlib.Path(${JSON.stringify(ledgerPath)})
import propose
propose.ANSWERS_DIR = pathlib.Path(${JSON.stringify(answersDir)})
propose.ingest()
`;
  const out = execFileSync(python, ['-c', shim], { cwd: repoDir, encoding: 'utf8' });
  return { out, ledger: JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) };
}

/** A real group and two of its real entry ids, read out of the built data. */
function sampleGroup() {
  const entries = JSON.parse(fs.readFileSync(path.join(repoDir, 'public/data/entries.json'), 'utf8'));
  const bySpelling = new Map();
  for (const entry of Object.values(entries)) {
    if (!entry.path) continue;
    // /yo/<spelling>/<word> - the spelling is the second segment now that every
    // word lives under the language prefix.
    const spelling = entry.path.split('/')[2];
    if (!bySpelling.has(spelling)) bySpelling.set(spelling, []);
    bySpelling.get(spelling).push(entry);
  }
  for (const [spelling, members] of bySpelling) {
    if (members.length >= 2) return { spelling, members };
  }
  return null;
}

const ready =
  python &&
  fs.existsSync(path.join(repoDir, 'data/url-slugs.json')) &&
  fs.existsSync(path.join(repoDir, 'public/data/entries.json'));

test('an answer naming an entry that is not in the group is refused', { skip: !ready }, () => {
  const group = sampleGroup();
  const { out, ledger } = runIngest({
    groups: [{ spelling: group.spelling, words: [{ id: 'en-not-a-real-id', word: 'invented' }] }],
  });
  assert.match(out, /has no entry/, 'ingest should say it refused the id');
  assert.ok(!ledger.entries['en-not-a-real-id'], 'and it must not be in the ledger');
});

test('two entries in one group given the same word: the second is refused', { skip: !ready }, () => {
  // The worst outcome in the whole system. The build writes one file per
  // address, so the second write wins and the first entry has no page at all.
  const group = sampleGroup();
  const [first, second] = group.members;
  const { out, ledger } = runIngest({
    groups: [
      {
        spelling: group.spelling,
        words: [
          { id: first.id, word: 'sameword' },
          { id: second.id, word: 'sameword' },
        ],
      },
    ],
  });
  assert.match(out, /claimed twice/, 'ingest should say the address was claimed twice');
  const words = [ledger.entries[first.id].word, ledger.entries[second.id].word];
  assert.notEqual(words[0], words[1], 'the two entries must not end up at one address');
});

test('a word that is not URL-safe is refused', { skip: !ready }, () => {
  const group = sampleGroup();
  const { out, ledger } = runIngest({
    groups: [{ spelling: group.spelling, words: [{ id: group.members[0].id, word: '   !!!   ' }] }],
  });
  assert.match(out, /empty word/);
  assert.notEqual(ledger.entries[group.members[0].id].word, '!!!');
});

test('a group that does not exist is refused', { skip: !ready }, () => {
  const { out } = runIngest({
    groups: [{ spelling: 'not-a-spelling-in-this-dictionary', words: [{ id: 'x', word: 'y' }] }],
  });
  assert.match(out, /no group spelled/);
});

test('unreadable JSON is reported, not thrown', { skip: !ready }, () => {
  // An agent that writes a markdown fence around its answer should cost one
  // batch, not the run.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slug-ingest-bad-'));
  const answersDir = path.join(work, 'answers');
  fs.mkdirSync(answersDir, { recursive: true });
  fs.writeFileSync(path.join(answersDir, '001.json'), '```json\n{"groups": []}\n```');
  const ledgerPath = path.join(work, 'url-slugs.json');
  fs.copyFileSync(path.join(repoDir, 'data/url-slugs.json'), ledgerPath);
  const shim = `
import sys, pathlib
sys.path.insert(0, ${JSON.stringify(path.join(repoDir, 'tools/slugs'))})
from lib import ledger
ledger.LEDGER_PATH = pathlib.Path(${JSON.stringify(ledgerPath)})
import propose
propose.ANSWERS_DIR = pathlib.Path(${JSON.stringify(answersDir)})
propose.ingest()
`;
  const out = execFileSync(python, ['-c', shim], { cwd: repoDir, encoding: 'utf8' });
  assert.match(out, /not readable as JSON/);
});

test('an answer that is the Yorùbá handed back is refused', { skip: !ready }, () => {
  // The fold turns "batá" into "bata" and "bààlúù" into "baaluu" - legal
  // addresses, and useless ones, because they name the spelling rather than
  // what it means. Non-ASCII in the answer is the reliable sign of it, and of a
  // definition quoted wholesale with its curly quotes.
  const group = sampleGroup();
  const before = JSON.parse(fs.readFileSync(path.join(repoDir, 'data/url-slugs.json'), 'utf8'));
  const { out, ledger } = runIngest({
    groups: [{ spelling: group.spelling, words: [{ id: group.members[0].id, word: 'bààlúù' }] }],
  });
  assert.match(out, /answered in Yorùbá, not English/);
  assert.equal(
    ledger.entries[group.members[0].id].word,
    before.entries[group.members[0].id].word,
    'the entry should have been left exactly as it was'
  );
});

test('an answer that is a whole sentence is refused', { skip: !ready }, () => {
  // One answer was a 200-character explanation of what a name means. Folded,
  // that is a 200-character address.
  const group = sampleGroup();
  const sentence = 'help-me-take-care-of-the-child-it-is-a-shortened-form-or-nickname-for-much-longer-names';
  const { out, ledger } = runIngest({
    groups: [{ spelling: group.spelling, words: [{ id: group.members[0].id, word: sentence }] }],
  });
  assert.match(out, /characters/);
  assert.ok(ledger.entries[group.members[0].id].word.length <= 40);
});

test('an Ajami answer that does not say ajami is refused', { skip: !ready }, () => {
  // Yorùbá in the Arabic script has to say so somewhere in its address. Nobody
  // can type the spelling and nothing links to these pages, so the address is
  // the only place a reader finds out what they are looking at.
  const entries = JSON.parse(fs.readFileSync(path.join(repoDir, 'public/data/entries.json'), 'utf8'));
  // One whose SPELLING segment does not already say it - the alphabet's own
  // letter pages live at /yo/ajami-letter/, which satisfies the rule in the
  // first segment, so they are the wrong fixture for testing the second.
  const ajami = Object.entries(entries).find(
    ([, x]) =>
      /[\u0600-\u06ff]/.test((x.canonicalForm || {}).value || '') &&
      !(x.path || '').split('/')[2].includes('ajami')
  );
  assert.ok(ajami, 'the fixture should contain an Arabic-script entry');
  const [id, entry] = ajami;
  const spelling = entry.path.split('/')[2];

  const { out, ledger } = runIngest({
    groups: [{ spelling, words: [{ id, word: 'prayer' }] }],
  });
  assert.match(out, /is Ajami and does not say so/);
  assert.notEqual(ledger.entries[id].word, 'prayer');
});

test('an Ajami answer that does say it is accepted', { skip: !ready }, () => {
  const entries = JSON.parse(fs.readFileSync(path.join(repoDir, 'public/data/entries.json'), 'utf8'));
  const [id, entry] = Object.entries(entries).find(
    ([, x]) =>
      /[\u0600-\u06ff]/.test((x.canonicalForm || {}).value || '') &&
      !(x.path || '').split('/')[2].includes('ajami')
  );
  const spelling = entry.path.split('/')[2];
  const { ledger } = runIngest({
    groups: [{ spelling, words: [{ id, word: 'ajami-prayer' }] }],
  });
  assert.equal(ledger.entries[id].word, 'ajami-prayer');
});
