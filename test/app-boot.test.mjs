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
    addEventListener() {},
    removeEventListener() {},
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
  globalThis.fetch = async (url) => {
    const file = path.join(publicDir, String(url).replace(/^\.?\//, ''));
    if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
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
