// test/prerender.test.mjs
//
// The build writes 6,280 HTML files and nobody opens them. So the properties
// that make them worth writing at all are asserted here: the definitions are in
// the markup, the title and description are the word's own, and the links are
// real links. Every one of those was missing before, and each was invisible -
// the site looked correct in a browser the whole time it was invisible to a
// search engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prerender, descriptionFor, ORIGIN } from '../build/lib/prerender.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoDir, 'public');

function fixtureSite() {
  // A copy of the shell alone, so a test never writes into public/.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-'));
  fs.copyFileSync(path.join(publicDir, 'index.html'), path.join(dir, 'index.html'));
  return dir;
}

const entry = (id, spelling, glosses, { pos = 'verb', urlPath } = {}) => ({
  id,
  headword: spelling,
  pos,
  path: urlPath,
  canonicalForm: { value: spelling },
  altForms: [],
  ipa: [],
  senses: glosses.map((gloss, i) => ({ id: `${id}-s${i}`, glosses: [gloss] })),
});

const SAMPLE = [
  entry('e1', 'gbà', ['to take, accept, receive, absorb', 'to snatch, seize'], { urlPath: '/yo/gba/take' }),
  entry('e2', 'gbá', ['to hit, kick, slap'], { urlPath: '/yo/gba/hit' }),
  entry('e3', 'ilé', ['a house, a home'], { pos: 'noun', urlPath: '/yo/ile/home' }),
];

test('a word page carries its definitions in the markup', () => {
  const dir = fixtureSite();
  prerender(SAMPLE, { publicDir: dir });
  const html = fs.readFileSync(path.join(dir, 'yo/gba/take.html'), 'utf8');

  // The point of the whole exercise: readable with no JavaScript at all.
  assert.match(html, /to take, accept, receive, absorb/);
  assert.match(html, /to snatch, seize/);
  assert.match(html, /<title>gbà — Sọ̀rọ̀ Sókè<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/yorubadict\.com\/yo\/gba\/take" \/>/);
  assert.match(html, /data-prerendered="\/yo\/gba\/take"/);
  assert.match(html, /"@type":"DefinedTerm"/);
});

test('each page describes its own word, not the dictionary', () => {
  // Every entry used to inherit the site-wide description, so a search result
  // for a word said nothing about that word.
  const dir = fixtureSite();
  prerender(SAMPLE, { publicDir: dir });
  const descriptions = SAMPLE.map((e) => {
    const html = fs.readFileSync(path.join(dir, `${e.path.replace(/^\//, '')}.html`), 'utf8');
    return html.match(/<meta name="description" content="([^"]*)"/)[1];
  });
  assert.equal(new Set(descriptions).size, SAMPLE.length, 'descriptions should all differ');
  assert.match(descriptions[0], /^gbà \(verb\) in Yorùbá: to take/);
});

test('a description stays inside what a search result will show', () => {
  const long = entry('x', 'pa', Array.from({ length: 20 }, (_, i) => `to do the ${i}th thing at some length`), {
    urlPath: '/yo/pa/kill',
  });
  const text = descriptionFor(long);
  assert.ok(text.length <= 300, `description was ${text.length} characters`);
  assert.match(text, /^pa \(verb\) in Yorùbá: /);

  // A word whose only definition is longer than the budget still gets one.
  const verbose = entry('y', 'ta', ['x'.repeat(400)], { urlPath: '/yo/ta/x' });
  assert.ok(descriptionFor(verbose).length <= 300);
});

test('the sitemap lists every page, written pages first', () => {
  const dir = fixtureSite();
  prerender(SAMPLE, { publicDir: dir });
  const xml = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  // Three words, the seven written pages, and one page for the spelling two of
  // the words share.
  assert.equal(locs.length, SAMPLE.length + 7 + 1);
  assert.ok(locs.includes(`${ORIGIN}/yo/gba`), 'the shared spelling gets a page');
  for (const e of SAMPLE) assert.ok(locs.includes(ORIGIN + e.path), `${e.path} missing`);
  assert.equal(locs[0], `${ORIGIN}/`);
  assert.ok(locs.indexOf(`${ORIGIN}/about`) < locs.indexOf(`${ORIGIN}/yo/gba/take`));
});

test('reading the shell as a template is idempotent', () => {
  // / is written last and overwrites the file the template was read from. A
  // second build must produce the same thing, or the welcome page would end up
  // nested inside itself.
  const dir = fixtureSite();
  prerender(SAMPLE, { publicDir: dir });
  const once = fs.readFileSync(path.join(dir, 'yo/gba/take.html'), 'utf8');
  prerender(SAMPLE, { publicDir: dir });
  const twice = fs.readFileSync(path.join(dir, 'yo/gba/take.html'), 'utf8');
  assert.equal(once, twice, 'a second build changed a page');

  // Not just "the same twice" - the same AND correct. Comparing two builds to
  // each other is how this test passed while both were missing the stamp.
  assert.match(twice, /data-prerendered="\/yo\/gba\/take"/);
  assert.match(twice, /<title>gbà — Sọ̀rọ̀ Sókè<\/title>/);
  assert.match(twice, /to take, accept, receive, absorb/);
  assert.equal(
    (twice.match(/<title>/g) || []).length,
    1,
    'the template grew a second title, so a marker is not being replaced cleanly'
  );
});

test('_redirects carries retired addresses and no catch-all', () => {
  const dir = fixtureSite();
  prerender(SAMPLE, {
    publicDir: dir,
    redirects: [{ from: '/yo/gba/receive', to: '/yo/gba/take' }],
  });
  const text = fs.readFileSync(path.join(dir, '_redirects'), 'utf8');
  assert.match(text, /^\/yo\/gba\/receive \/yo\/gba\/take 301$/m);
  // A catch-all would answer every typo with 200 and an empty shell, which a
  // crawler reads as a page rather than as the mistake it is.
  assert.doesNotMatch(text, /^\/\* /m);
  assert.doesNotMatch(text, / 200$/m);
});

test('a shell with no markers is refused rather than silently half-written', () => {
  const dir = fixtureSite();
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>nothing to fill</body></html>');
  assert.throws(() => prerender(SAMPLE, { publicDir: dir }), /PRERENDER-HEAD/);
});

test('a page whose address changed is deleted, not left behind', () => {
  // Writing without deleting leaves a real file at the old address forever. It
  // is not in the sitemap and nothing links to it, but it is still served and
  // still indexable - and the 301 meant to move readers never fires, because a
  // file is in the way. Two of gbà's nine addresses were already like this.
  const dir = fixtureSite();
  prerender(SAMPLE, { publicDir: dir });
  assert.ok(fs.existsSync(path.join(dir, 'yo/gba/take.html')));

  const renamed = SAMPLE.map((e) =>
    e.path === '/yo/gba/take' ? { ...e, path: '/yo/gba/receive' } : e
  );
  const result = prerender(renamed, { publicDir: dir });

  assert.ok(fs.existsSync(path.join(dir, 'yo/gba/receive.html')), 'the new address should exist');
  assert.ok(!fs.existsSync(path.join(dir, 'yo/gba/take.html')), 'the old address should be gone');
  assert.deepEqual(result.removed, ['/yo/gba/take']);
});

test('deleting stale pages never touches data/ or a committed file', () => {
  const dir = fixtureSite();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/entries.json'), '{}');
  fs.writeFileSync(path.join(dir, 'app.js'), '// source');
  fs.writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *');

  prerender(SAMPLE, { publicDir: dir });

  assert.ok(fs.existsSync(path.join(dir, 'data/entries.json')), 'data/ must survive');
  assert.ok(fs.existsSync(path.join(dir, 'app.js')), 'source files must survive');
  assert.ok(fs.existsSync(path.join(dir, 'robots.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'index.html')));
});

test('a written page that no longer exists is deleted too', () => {
  const dir = fixtureSite();
  // A page from an older build of the site, in the shape the renderer writes.
  // At the top level on purpose: the written pages live there, and a cleanup
  // that only recursed into subdirectories could never retire one of them.
  fs.writeFileSync(path.join(dir, 'old-page.html'), '<p>gone</p>');

  const result = prerender(SAMPLE, { publicDir: dir });

  assert.ok(!fs.existsSync(path.join(dir, 'old-page.html')), 'the retired page should be gone');
  assert.ok(result.removed.includes('/old-page'));
  assert.ok(fs.existsSync(path.join(dir, 'about.html')), 'current pages stay');
});

test('a 404 page is written, unlisted and unindexable', () => {
  // Without this file Cloudflare Pages answers an unknown address with
  // index.html at status 200 - a soft 404. The live site did exactly that: /yo/
  // gba/nonsense and /zzz-not-a-page both returned the front page and told a
  // crawler it was a real page at that address.
  const dir = fixtureSite();
  const result = prerender(SAMPLE, { publicDir: dir });

  const html = fs.readFileSync(path.join(dir, '404.html'), 'utf8');
  assert.match(html, /noindex/, 'an indexable 404 is the same problem with a different status');
  assert.ok(!/<link rel="canonical"/.test(html), 'a 404 should not claim to be a canonical page');
  assert.ok(
    !result.written.some((w) => w.path === '/404'),
    'the 404 must stay out of `written`, which is what the sitemap is built from'
  );
  assert.ok(!fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8').includes('/404'));
});

test('the 404 page survives the stale-page sweep', () => {
  // It is deliberately not in `written`, which is the set the sweep keeps - so
  // the sweep would delete it on the very build that wrote it.
  const dir = fixtureSite();
  prerender(SAMPLE, { publicDir: dir });
  prerender(SAMPLE, { publicDir: dir });
  assert.ok(fs.existsSync(path.join(dir, '404.html')));
});

test('pages are files, so an address serves without a redirect', () => {
  // <path>/index.html and <path>.html both work on Cloudflare Pages, but they
  // answer at different addresses: the first serves /yo/gba/take/ and makes
  // /yo/gba/take a 308 to it. Everything else here - the canonical tag, the
  // sitemap, the pushState in app.js - names the form without the slash.
  const dir = fixtureSite();
  prerender(SAMPLE, { publicDir: dir });

  assert.ok(fs.existsSync(path.join(dir, 'yo/gba/take.html')));
  assert.ok(!fs.existsSync(path.join(dir, 'yo/gba/take/index.html')));
  // A spelling is both a page and a parent, and has to be both at once.
  assert.ok(fs.existsSync(path.join(dir, 'yo/gba.html')), 'the spelling page is a file');
  assert.ok(fs.statSync(path.join(dir, 'yo/gba')).isDirectory(), 'and also a directory');

  const html = fs.readFileSync(path.join(dir, 'yo/gba/take.html'), 'utf8');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];
  assert.ok(!canonical.endsWith('/'), `canonical must name the file's own address, got ${canonical}`);
});
