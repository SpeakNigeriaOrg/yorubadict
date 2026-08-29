// test/app-boot.test.mjs
//
// Boots public/app.js against a stub DOM and asserts it renders.
//
// This is not a browser test and does not try to be one. It exists for one
// failure mode: app.js is a 1,400-line closure and the entry markup was lifted
// out of it into entry-render.js, so a helper can be left behind, or imported
// under the wrong name, and nothing catches it - the module parses, the build
// passes, the tests pass, and the page is blank. Node running the real file
// against a fake document catches it in a second.
//
// It also covers the routing change, which touches every internal link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function stubNode(id) {
  // A real listener registry, for the same reason window got one: a no-op
  // addEventListener means the search box can be typed into and app.js never
  // hears it, so any assertion about what search does is vacuous.
  const listeners = new Map();
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    // app.js sets CSS custom properties on the root element to size the chrome.
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    scrollTop: 0,
    offsetHeight: 0,
    clientHeight: 0,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type) || [];
      const at = set.indexOf(fn);
      if (at >= 0) set.splice(at, 1);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn({ preventDefault() {}, ...event });
      return true;
    },
    appendChild() {},
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    querySelector: () => stubNode('q'),
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
    blur() {},
    scrollIntoView() {},
    insertAdjacentHTML() {},
    getBoundingClientRect: () => ({ top: 0, height: 0, bottom: 0 }),
  };
}

/** One shared node per id, so a test can read back what app.js wrote into it. */
function installDom({ pathname = '/', hash = '', prerendered = null } = {}) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, stubNode(id));
    return nodes.get(id);
  };

  globalThis.document = {
    title: '',
    documentElement: stubNode('html'),
    body: stubNode('body'),
    getElementById: byId,
    querySelector: () => stubNode('q'),
    querySelectorAll: () => [],
    createElement: (tag) => ({ ...stubNode(tag), tagName: tag.toUpperCase() }),
    addEventListener() {},
    readyState: 'complete',
  };
  // A real listener registry, not a no-op. Swallowing addEventListener made the
  // second half of this test assert nothing: it dispatched hashchange a hundred
  // times, app.js never heard one, and the loop just ran out.
  const listeners = new Map();
  const fire = (type) => {
    for (const fn of listeners.get(type) || []) fn({ type });
  };

  globalThis.window = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type) || [];
      const at = set.indexOf(fn);
      if (at >= 0) set.splice(at, 1);
    },
    dispatchEvent: (event) => fire(event.type),
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    location: { hash, pathname, search: '' },
    // pushState and replaceState move the address bar. A no-op here made every
    // routing assertion in this file vacuous: the app navigated correctly and
    // location.pathname never moved, so the test could not tell.
    history: {
      pushState(_state, _title, url) {
        const next = new URL(url, 'https://yorubadict.com');
        globalThis.location.pathname = next.pathname;
        globalThis.location.hash = next.hash;
      },
      replaceState(_state, _title, url) {
        this.pushState(_state, _title, url);
      },
    },
    requestAnimationFrame: (fn) => fn(),
    innerWidth: 1200,
    innerHeight: 800,
    scrollY: 0,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  globalThis.location = window.location;
  globalThis.history = window.history;
  globalThis.matchMedia = window.matchMedia;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.getComputedStyle = window.getComputedStyle;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

  // The app fetches its own data files; serve them off disk.
  //
  // Resolved against location.pathname the way a browser does, NOT by stripping
  // a leading slash. Stripping was the same normalisation for './data/x',
  // '/data/x' and 'data/x', so the stub answered all three and the difference
  // between them - the difference that took the live site down from every page
  // below the root - could not be expressed here at all.
  globalThis.fetch = async (url) => {
    const resolved = new URL(String(url), `https://yorubadict.com${globalThis.location.pathname}`);
    const file = path.join(publicDir, resolved.pathname.replace(/^\//, ''));
    if (!fs.existsSync(file)) throw new Error(`no such file: ${resolved.pathname}`);
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  };

  // english-relevance.js is a classic script that sets a global, and app.js
  // reads that global at module scope.
  const relevance = fs.readFileSync(path.join(publicDir, 'english-relevance.js'), 'utf8');
  new Function(relevance).call(globalThis);

  // What a prerendered file arrives as: content already in the markup, stamped
  // with the address it belongs to.
  const content = byId('entry-content');
  if (prerendered) {
    content.innerHTML = prerendered.html;
    content.getAttribute = (name) =>
      name === 'data-prerendered' ? prerendered.path : null;
    content.removeAttribute = () => {
      content.getAttribute = () => null;
    };
  }

  return { byId, fire };
}

/** A fresh instance of app.js. Modules are cached by specifier, so vary it. */
let bootCount = 0;
const bootApp = () => import(`${path.join(publicDir, 'app.js')}?boot=${++bootCount}`);

const readEntries = () =>
  JSON.parse(fs.readFileSync(path.join(publicDir, 'data/entries.json'), 'utf8'));

/** Wait for boot()'s fetches to land and the route to settle. */
async function settle(check, tries = 100) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

test('app.js boots, loads the dictionary and renders an entry', async () => {
  const { byId, fire } = installDom();
  assert.equal(typeof globalThis.EnglishRelevance, 'object', 'english-relevance.js should set its global');

  await bootApp();

  const content = byId('entry-content');
  assert.equal(
    document.title,
    'Sọ̀rọ̀ Sókè — The People’s Yorùbá Dictionary · Speak Nigeria',
    'the welcome page should paint before the dictionary arrives'
  );

  // boot() fetches entries.json and search-index.json and then routes again, so
  // wait for the dictionary rather than for a fixed time.
  const entries = readEntries();
  const target = Object.values(entries).find((e) => e.canonicalForm.value === 'gbà');
  assert.ok(target, 'the fixture should contain gbà');
  assert.ok(target.path, 'and it should carry its address — see build/lib/slugs.mjs');

  location.pathname = target.path;
  let html = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    fire('popstate');
    html = content.innerHTML;
    if (html.includes('entry-headword')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.match(html, /entry-headword/, 'the entry should have rendered');
  assert.match(html, /gbà/, 'and it should be the word that was asked for');
  assert.equal(document.title, 'gbà — Sọ̀rọ̀ Sókè', 'the tab title follows the entry');

  // Every one of these comes from a helper that now lives in another file. A
  // section rendering empty is what a missing import looks like from outside.
  assert.match(html, /Definitions/, 'definitions section');
  assert.match(html, /entry-section-title/, 'at least one section title');
  assert.ok(
    (html.match(/class="relation-pill/g) || []).length > 0,
    'relation pills, which come from relationPillsHtml'
  );
  assert.match(html, /entry-provenance-note/, 'the provenance note closes the page');
});


test('a prerendered page is left alone, not blanked and redrawn', async () => {
  // The whole reason data-prerendered exists. Rendering over it would destroy
  // the paragraph the browser picked as the Largest Contentful Paint and
  // re-record LCP at whenever 12 MB of dictionary happened to land - which is
  // the bug the comment in boot() is about, in a new place.
  const entries = readEntries();
  const target = Object.values(entries).find((e) => e.canonicalForm.value === 'gbà');
  const marker = '<p id="came-from-the-file">prerendered</p>';

  const { byId } = installDom({
    pathname: target.path,
    prerendered: { path: target.path, html: marker },
  });
  await bootApp();

  const content = byId('entry-content');
  assert.match(content.innerHTML, /came-from-the-file/, 'the markup that arrived should still be there');

  // And it must survive the dictionary landing, which is when the old code
  // would have re-routed.
  await settle(() => false, 12);
  assert.match(
    content.innerHTML,
    /came-from-the-file/,
    'and it should still be there after entries.json has loaded'
  );
});

test('a prerendered page for a DIFFERENT address is replaced', async () => {
  // Offline, the service worker answers a word it has no file for with the
  // cached shell - the welcome page, carrying data-prerendered="/". Honouring
  // that would leave a reader looking at "Ẹ káàbọ̀." at the address of the word
  // they asked for.
  const entries = readEntries();
  const target = Object.values(entries).find((e) => e.canonicalForm.value === 'gbà');

  const { byId } = installDom({
    pathname: target.path,
    prerendered: { path: '/', html: '<div class="entry-welcome"><h1>Ẹ káàbọ̀.</h1></div>' },
  });
  await bootApp();

  const content = byId('entry-content');
  const rendered = await settle(() => content.innerHTML.includes('entry-headword'));
  assert.ok(rendered, 'the word asked for should have been rendered over the shell');
  assert.match(content.innerHTML, /gbà/);
  assert.doesNotMatch(content.innerHTML, /káàbọ̀/, 'and the welcome text should be gone');
});

test('an old #/entry/<id> link is redirected to the word\'s address', async () => {
  // These are in other people\'s pages and messages, and they are the only kind
  // of link this dictionary had for its first year. A fragment never reaches a
  // server, so nothing but the page itself can redirect one.
  const entries = readEntries();
  const target = Object.values(entries).find((e) => e.canonicalForm.value === 'gbà');

  const { byId } = installDom({
    pathname: '/',
    hash: `#/entry/${encodeURIComponent(target.id)}`,
  });
  await bootApp();

  const content = byId('entry-content');
  await settle(() => content.innerHTML.includes('entry-headword'));
  assert.equal(location.pathname, target.path, 'the address should have been rewritten');
  assert.match(content.innerHTML, /entry-headword/, 'and the word should be on the page');
});

test('an old #/about link is redirected to /about', async () => {
  installDom({ pathname: '/', hash: '#/about' });
  await bootApp();
  await settle(() => location.pathname === '/about', 20);
  assert.equal(location.pathname, '/about');
});

test('every URL the client builds is rooted, not relative to the page', () => {
  // The whole site used to live at one address, so fetch('data/entries.json')
  // always resolved to /data/entries.json and relative was indistinguishable
  // from absolute. Under path routing they differ on every page but the front
  // one: from /yo/gba/take that fetch asks for /yo/gba/data/entries.json, gets
  // HTML back, and the app dies on `Unexpected token '<'`. It shipped that way.
  //
  // Checked by reading the source rather than by booting, because the failure
  // is in what the string resolves against - which a stub DOM does not model.
  const files = ['app.js', 'entry-render.js', 'page-render.js', 'sw.js'];
  const offenders = [];
  for (const name of files) {
    const source = fs.readFileSync(path.join(publicDir, name), 'utf8');
    source.split('\n').forEach((line, i) => {
      // A data/ URL in quotes that does not start with / or a scheme.
      for (const m of line.matchAll(/["'`(=]\s*(data\/[A-Za-z0-9._/-]+)/g)) {
        offenders.push(`${name}:${i + 1}  ${m[1]}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `relative data URLs break every page below the root:\n${offenders.join('\n')}`);
});

test('the shell loads its scripts and styles from the root', () => {
  // Same failure, earlier: a relative <script src="app.js"> on /yo/gba/take
  // asks for /yo/gba/app.js and the app never starts at all.
  // Comments stripped first: index.html explains an <img src="favicon.svg"> it
  // deliberately does not use, and a scanner that cannot tell prose from markup
  // reports the explanation as the bug.
  const html = fs
    .readFileSync(path.join(publicDir, 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const bad = refs.filter(
    (r) => !/^([a-z]+:|\/|#|data:)/i.test(r) && !r.startsWith('mailto:')
  );
  assert.deepEqual(bad, [], `these resolve against the current page, not the root: ${bad.join(', ')}`);
});

test('the dictionary loads when the page opened at a word, not at the root', async () => {
  // The production failure, reproduced. Every test above boots at '/', where a
  // relative data URL and a rooted one resolve to the same place - so the whole
  // file passed while the live site showed "Unexpected token '<'" on all 7,109
  // word pages. Opening below the root is what tells them apart.
  const entries = readEntries();
  const target = Object.values(entries).find((e) => e.canonicalForm.value === 'gbà');
  const { byId } = installDom({ pathname: target.path, prerendered: target.path });

  await bootApp();

  // Waited for with the full settle, not a short one. boot() holds the download
  // behind a paint gate whose long stop is five seconds, so a test that gives up
  // after one still sees "Loading the dictionary…" and reads the load as fine -
  // which is exactly how the first version of this test passed against the bug
  // it was written for.
  const settled = await settle(
    () => !byId('entry-content').innerHTML.includes('Loading the dictionary…')
  );
  const entry = byId('entry-content').innerHTML;
  assert.ok(settled, 'boot never finished loading the dictionary');
  assert.ok(
    !entry.includes("Couldn't load"),
    `boot reported a failed load from a nested address: ${entry.slice(0, 200)}`
  );

  // The other half of the same failure: state.ready stays false, so the results
  // panel keeps promising a search that is never coming.
  const searchBox = byId('search-input');
  searchBox.value = 'gba';
  searchBox.dispatchEvent({ type: 'input' });

  const results = byId('results-list').innerHTML;
  assert.ok(
    !results.includes('Loading the dictionary') && !results.includes('did not load'),
    `search should be live once the dictionary is in: ${results.slice(0, 200)}`
  );
});
