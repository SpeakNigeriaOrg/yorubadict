// test/validation-report.test.mjs
//
// The data quality report is where work needing a person surfaces in the app.
// An address nobody has read belongs there: the build log says so too, but a
// build log is only read when a build fails, and this one deliberately does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildValidationReport } from '../build/lib/validator.mjs';

// A real entry from the shipped dictionary rather than a hand-built one. The
// validator reads a dozen fields without guarding them, so a minimal fixture
// fails on the fixture instead of on what is being tested.
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// The shipped file is the browser artifact, which drops build-time fields, so
// the arrays the validator walks are restored rather than left undefined.
const sample = Object.values(
  JSON.parse(fs.readFileSync(path.join(publicDir, 'data/entries.json'), 'utf8'))
)
  .slice(0, 1)
  .map((e) => ({
    ipa: [],
    relations: [],
    derivedTerms: [],
    etymologyTemplates: [],
    senses: [],
    ...e,
  }));

const reportWith = (newcomers) =>
  buildValidationReport(sample, [], [], null, [], newcomers);

test('a word living at a name nobody chose is reported', () => {
  const report = reportWith([
    { id: 'en-gbe-yo-verb-NEW', address: '/yo/gbe/carry-2', source: 'rule', spelling: 'gbé' },
    { id: 'en-de-yo-verb-NEW2', address: '/yo/de/tie-down', source: 'etymid', spelling: 'dè' },
  ]);

  const found = report.issues.find((i) => i.kind === 'address-unnamed');
  assert.ok(found, 'the report should carry the category');
  assert.equal(found.severity, 'high', 'a live address that will move outranks a missing pronunciation');
  assert.equal(found.pages.length, 2);

  const detailsOf = (row) => row.details.join(' ');
  const byRule = found.pages.find((r) => detailsOf(r).includes('/yo/gbe/carry-2'));
  assert.match(detailsOf(byRule), /definition rule/, 'it should say which rule named it');
  const byEtymid = found.pages.find((r) => detailsOf(r).includes('/yo/de/tie-down'));
  assert.match(detailsOf(byEtymid), /etymid/, 'and distinguish one a person had already chosen');
  assert.equal(found.count, 2, 'counted as two items of work, not two pages');
});

test('the category is absent when every address has been read', () => {
  // The normal state. An empty category in a list of things to do is noise, and
  // this report is read by people looking for work that exists.
  const report = reportWith([]);
  const found = report.issues.find((i) => i.kind === 'address-unnamed');
  assert.ok(!found || found.count === 0, 'no newcomers, nothing to report');
});
