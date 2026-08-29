// test/page-render.test.mjs
//
// The seven pages the dictionary writes itself, checked for the things that
// break silently.
//
// The one that actually broke: app.js fetches the contribute queue and then
// patches it into an element by id, and the id it looked for was not the id
// page-render.js emits. Nothing failed - the page rendered, the prose was
// right, and the list said "Loading the list…" forever. So the contract between
// the two files is asserted here rather than trusted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPageRenderer } from '../public/page-render.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pages = createPageRenderer({
  pathFor: (id) => `/ENTRY/${id}`,
  pagePath: (name) => (name === 'welcome' ? '/' : `/${name}`),
  escapeHtml,
});

test('every page has a path, a title and its own description', () => {
  const paths = new Set();
  const descriptions = new Set();
  for (const page of pages.PAGES) {
    assert.ok(page.path.startsWith('/'), `${page.name} needs a path`);
    assert.ok(page.title && page.title.length > 5, `${page.name} needs a title`);
    // A description shared between pages is what every entry used to get: a
    // search snippet describing the dictionary instead of the page.
    assert.ok(page.description && page.description.length > 30, `${page.name} needs a description`);
    assert.ok(page.description.length < 320, `${page.name}'s description is too long to be shown`);
    assert.ok(!paths.has(page.path), `${page.path} is claimed twice`);
    assert.ok(!descriptions.has(page.description), `${page.name} reuses another page's description`);
    paths.add(page.path);
    descriptions.add(page.description);
  }
  assert.deepEqual(
    pages.PAGES.map((p) => p.name),
    ['welcome', 'about', 'speak-nigeria', 'language-of-connections', 'building-blocks', 'contribute']
  );
});

test('every page renders with no data at all', () => {
  // This is the state a prerendered file is written in, and the state a reader
  // sees before a fetch lands.
  for (const page of pages.PAGES) {
    const html = page.html(null);
    assert.ok(html.length > 200, `${page.name} rendered almost nothing`);
    assert.doesNotMatch(html, /undefined|\[object Object\]/, `${page.name} leaked a value`);
  }
});

test('a data-driven page emits the element id app.js patches its list into', () => {
  // The contract that broke. app.js names the host element by id; if the two
  // ever disagree again, the list quietly never arrives.
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const hosts = [...app.matchAll(/host: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(hosts.length >= 2, 'app.js should name a host element for each fetched list');
  for (const host of hosts) {
    const found = pages.PAGES.some((page) => page.html(null).includes(`id="${host}"`));
    assert.ok(found, `no page emits id="${host}", so app.js would patch nothing into it`);
  }
});

test('no page links with a hash route', () => {
  // Every internal link goes through ctx.pathFor / ctx.pagePath. A leftover
  // #/entry/<id> would be a link the router no longer answers.
  for (const page of pages.PAGES) {
    assert.doesNotMatch(page.html(null), /href="#\//, `${page.name} still has a hash link`);
  }
});

test('links in prose point at entries that exist', () => {
  // ~30 entry ids are written by hand into the prose of About and Contribute.
  // They are invisible when they rot: the link renders and lands on the welcome
  // page. Skipped rather than failed when there is no built dictionary to check
  // against, so the suite still runs on a fresh clone.
  const entriesPath = path.join(publicDir, 'data/entries.json');
  if (!fs.existsSync(entriesPath)) return;
  const entries = JSON.parse(fs.readFileSync(entriesPath, 'utf8'));

  const dead = [];
  for (const page of pages.PAGES) {
    for (const match of page.html(null).matchAll(/href="\/ENTRY\/([^"]+)"/g)) {
      if (!entries[match[1]]) dead.push(`${page.name}: ${match[1]}`);
    }
  }
  assert.deepEqual(dead, [], `hand-written links to entries that no longer exist:\n  ${dead.join('\n  ')}`);
});
