// test/service-worker.test.mjs
//
// public/sw.js caches a fixed list of files by name, with cache.addAll, which is
// all-or-nothing. One wrong name and the worker never installs - and nothing
// visible happens: the site works, and offline quietly does not. A test is the
// only place that gets noticed.
//
// Not a test of the caching behaviour, which needs a browser. A test of the two
// things that go wrong by editing a file somewhere else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoDir, 'public');
const sw = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');

/** The string array assigned to `name` in sw.js. */
function listNamed(name) {
  const at = sw.indexOf(`const ${name} = [`);
  assert.ok(at >= 0, `sw.js should declare ${name}`);
  const open = sw.indexOf('[', at);
  const close = sw.indexOf('];', open);
  assert.ok(close > open, `${name} should be a closed array literal`);
  return [...sw.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every file the service worker caches by name exists', () => {
  for (const urlPath of [...listNamed('SHELL'), ...listNamed('ON_DEMAND')]) {
    // '/' is index.html; everything else is the path under public/.
    const file = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    assert.ok(
      fs.existsSync(path.join(publicDir, file)),
      `sw.js caches ${urlPath}, but public/${file} does not exist — addAll would ` +
        'reject and the worker would never install'
    );
  }
});

test('the shell holds everything the app needs to run with no network', () => {
  const shell = listNamed('SHELL');
  // Read off index.html rather than listed here, so adding a script or a
  // stylesheet to the page cannot quietly leave it out of the offline set.
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const referenced = [
    ...[...html.matchAll(/<script[^>]+src="(\/[^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(\/[^"]+)"/g)].map((m) => m[1]),
  ];
  assert.ok(referenced.length >= 3, 'index.html should reference its own scripts and styles');
  for (const asset of referenced) {
    assert.ok(shell.includes(asset), `index.html loads ${asset}, but sw.js does not cache it`);
  }
  assert.ok(shell.includes('/'), 'the shell itself must be cached');
  // app.js imports these two; they are not in the markup.
  for (const imported of ['/entry-render.js', '/page-render.js']) {
    assert.ok(shell.includes(imported), `app.js imports ${imported}, but sw.js does not cache it`);
  }
  // The dictionary. Without these the shell renders and every word is missing.
  for (const data of ['/data/entries.json', '/data/search-index.json']) {
    assert.ok(shell.includes(data), `sw.js must cache ${data}`);
  }
});

test('the build stamp is never served from a cache', () => {
  // The one request whose whole job is to not be answered from a cache. If it
  // ever is, a stale worker can never find out it is stale.
  assert.match(sw, /const VERSION_URL = '\/data\/version\.json'/);
  assert.match(sw, /fetch\(VERSION_URL, \{ cache: 'no-store' \}\)/);
  assert.match(sw, /if \(url\.pathname === VERSION_URL\) return;/);
});

test('the build writes the stamp the worker keys on', () => {
  const normalize = fs.readFileSync(path.join(repoDir, 'build/normalize.mjs'), 'utf8');
  assert.match(normalize, /version\.json/, 'build/normalize.mjs must write data/version.json');
  const versionPath = path.join(publicDir, 'data/version.json');
  if (!fs.existsSync(versionPath)) return; // fresh clone, nothing built yet
  const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  assert.ok(version.build && version.build.length > 4, 'version.json needs a build stamp');
});

test('app.js registers the worker, and does not wait on it', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  // A reader who has just arrived should not wait on a cache they only benefit
  // from next time.
  assert.doesNotMatch(app, /await navigator\.serviceWorker\.register/);
});
