// public/sw.js
//
// Makes the offline promise true.
//
// The README has long said this dictionary is "genuinely offline-after-load",
// and until now that was half right in a way worth being exact about. An open
// tab did keep working with no network, because the whole dictionary is in
// memory. But there was no service worker, no manifest, and _headers puts every
// file on max-age=0, must-revalidate - so reloading offline, or opening a
// bookmark offline, got the browser's error page. What was true was "works until
// you reload".
//
// This makes it true properly, and it had to be written now for a second reason:
// every word used to live at one URL, so caching that one page cached the whole
// dictionary. Each word has its own address now, and 6,280 files is not
// something to download on a first visit. So the shell is cached, plus the data,
// and a request for a word we have no file for is answered with the shell -
// app.js then renders that word from the cached dictionary. One visit, and
// every word works offline, including ones never opened.
//
// -------------------------------------------------------------------------
// Why the version check is not optional
// -------------------------------------------------------------------------
// public/_headers exists to stop a visitor holding old JavaScript against a new
// dictionary. Nothing here is fingerprinted - the files are app.js and
// entries.json, by those names - so a max-age is a promise that cannot be
// withdrawn. A service worker is a cache with no expiry at all, which is that
// same problem with the volume turned up: entries.json and app.js ship as a
// matched pair, the renderer tolerates old data with new code by design, and
// nothing guards the reverse.
//
// So the cache is named after the build, the build stamp is fetched from the
// network on every activation, and a changed stamp throws the whole set away
// rather than refreshing part of it. Never a partial update: a mixed set is the
// exact failure this is meant to prevent.

const VERSION_URL = '/data/version.json';

// The shell, and the three files the app cannot work without. Not the 6,280
// word pages: those are served from the shell instead, which is the trade that
// makes a first visit affordable.
const SHELL = [
  '/',
  '/app.js',
  '/entry-render.js',
  '/page-render.js',
  '/english-relevance.js',
  '/style.css',
  '/_tokens.css',
  '/favicon.svg',
  '/data/entries.json',
  '/data/search-index.json',
];

// Fetched on first use rather than up front. Between them they are over half a
// megabyte and nothing on the reading path touches either, which is the same
// reason app.js does not fetch them at boot.
const ON_DEMAND = ['/data/building-blocks.json', '/data/wiktionary-tasks.json', '/data/validation-report.json'];

const cacheName = (build) => `soro-soke-${build}`;

async function currentBuild() {
  // no-store, not no-cache: this is the one request whose whole job is to not be
  // answered from a cache.
  const response = await fetch(VERSION_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`version.json: ${response.status}`);
  const { build } = await response.json();
  if (!build) throw new Error('version.json has no build');
  return build;
}

async function install(build) {
  const cache = await caches.open(cacheName(build));
  // addAll is all-or-nothing on purpose: a shell missing app.js is worse than no
  // shell, because it looks like it worked.
  await cache.addAll(SHELL);
}

async function dropOtherCaches(build) {
  const keep = cacheName(build);
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith('soro-soke-') && name !== keep).map((name) => caches.delete(name))
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const build = await currentBuild();
      await install(build);
      // Take over at once. Waiting for every tab to close would leave the first
      // visit uncached, which is the visit that matters - a reader who came from
      // a search result and then lost their connection.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const build = await currentBuild().catch(() => null);
      if (build) await dropOtherCaches(build);
      await self.clients.claim();
    })()
  );
});

/** The cache for the build currently deployed, or null if we cannot tell. */
async function liveCache() {
  const build = await currentBuild().catch(() => null);
  if (!build) {
    // Offline. Any cache we hold is the one we last verified, so use it.
    const names = (await caches.keys()).filter((name) => name.startsWith('soro-soke-'));
    return names.length ? caches.open(names[names.length - 1]) : null;
  }
  const name = cacheName(build);
  if (await caches.has(name)) return caches.open(name);
  // A new build is live and we hold an old one. Replace the whole set, never
  // part of it.
  await install(build);
  await dropOtherCaches(build);
  return caches.open(name);
}

const isNavigation = (request) =>
  request.mode === 'navigate' || (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The one request that must never be served from a cache.
  if (url.pathname === VERSION_URL) return;

  if (isNavigation(request)) {
    event.respondWith(
      (async () => {
        // Network first for a page. A word's own prerendered file has its
        // definitions in the markup and is what a reader should get when they
        // can reach it; the shell is the fallback, not the plan.
        try {
          return await fetch(request);
        } catch (offline) {
          const cache = await liveCache().catch(() => null);
          if (cache) {
            const page = await cache.match(request, { ignoreSearch: true });
            // The shell, if we have no file for this word. app.js reads the
            // address off the URL and renders the word from the cached
            // dictionary - see the data-prerendered note in handleRoute.
            if (page) return page;
            const shell = await cache.match('/');
            if (shell) return shell;
          }
          throw offline;
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await liveCache().catch(() => null);
      if (cache) {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;
      }
      const response = await fetch(request);
      // The three big files nothing on the reading path needs. Kept once
      // fetched, so the quality report and the contribute queue work offline too
      // after they have been opened once.
      if (cache && response.ok && ON_DEMAND.includes(url.pathname)) {
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
