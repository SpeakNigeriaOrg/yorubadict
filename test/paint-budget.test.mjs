// test/paint-budget.test.mjs
//
// Guards the paint gate in app.js, in a real browser.
//
// -------------------------------------------------------------------------
// Why this needs a browser when nothing else here does
// -------------------------------------------------------------------------
// Every other test in this directory runs against a stub DOM, because every
// other thing worth checking is a fact about the markup. This one is not: the
// gate at the bottom of boot() in public/app.js waits for a
// largest-contentful-paint PerformanceObserver entry before requesting 1.9 MB
// of dictionary, and neither the observer nor the paint exists outside a real
// renderer. A stub DOM would resolve the gate instantly and assert nothing.
//
// The comments around that gate record two regressions already - one where a
// single frame's wait was not enough because the filter is on when a request
// STARTS, and one where an idle callback raced the observer and won on a slow
// load, scoring 65 where the same code scored 99. Both were invisible to every
// test that existed. Both would be caught here.
//
// -------------------------------------------------------------------------
// Why localhost is the right place to run it
// -------------------------------------------------------------------------
// Counter-intuitively, the fast case is the dangerous one. The failure mode is
// the dictionary arriving BEFORE the paint is recorded, and the faster the
// connection the easier that is - the note in app.js measured entries.json
// finishing at 852 ms against a first paint at 2,333 ms in production, which
// is how a paragraph that was on screen at 2.3 s got reported as an LCP of
// 14.1 s. Over the local dev server the dictionary is available in single-
// digit milliseconds, so if the gate can be beaten anywhere, it is here.
//
// Not in `npm test` by default: it launches Chrome and takes about half a
// minute, and the rest of this suite is instant. Run it with
//
//   npm run test:paint
//
// or set PAINT_TEST=1.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Cdp, chromeAvailable, chromePath, launchChrome } from '../tools/trace/cdp.mjs';
import { CONFIGS, profile, serve } from '../tools/trace/paint-profile.mjs';

const optedIn = process.env.PAINT_TEST === '1';
const skip = !optedIn
  ? 'set PAINT_TEST=1 (or run `npm run test:paint`) - launches Chrome'
  : !(await chromeAvailable())
    ? `no Chrome at ${chromePath()}; set CHROME_PATH`
    : false;

describe('first paint and the dictionary download', { skip }, () => {
  let server;
  let chrome;
  let cdp;
  const runs = {};

  before(async () => {
    server = await serve();
    chrome = await launchChrome({ headless: true });
    cdp = await Cdp.connect(chrome.webSocketDebuggerUrl);
    const url = `http://localhost:${server.port}/`;
    // Both viewports, because the scores that prompted this differ between
    // them and a gate that holds on one and not the other is not a gate.
    for (const name of ['desktop', 'mobile-psi']) {
      runs[name] = await profile(cdp, url, CONFIGS[name]);
    }
  });

  after(async () => {
    cdp?.close();
    await chrome?.close();
    server?.stop();
  });

  for (const name of ['desktop', 'mobile-psi']) {
    test(`${name}: the dictionary is requested after the paint`, () => {
      const d = runs[name].dictionary;
      assert.notEqual(d.entriesStart, null, 'entries.json was never requested');
      assert.notEqual(d.paintAt, null, 'no paint was recorded');
      assert.ok(
        d.afterPaintByMs > 0,
        `entries.json was requested ${-d.afterPaintByMs} ms BEFORE the paint at ` +
          `${d.paintAt} ms. Anything requested before LCP is treated as something ` +
          `the paint waited for, and Lighthouse will re-time 1.9 MB at slow-4G ` +
          `speed. The gate at the end of boot() in public/app.js is what stops ` +
          `this; read the note above it before changing either.`
      );
    });

    test(`${name}: search-index.json waits for the same gate`, () => {
      const d = runs[name].dictionary;
      assert.ok(
        d.indexStart > d.paintAt,
        `search-index.json was requested at ${d.indexStart} ms, before the paint ` +
          `at ${d.paintAt} ms. It is fetched in the same Promise.all as ` +
          `entries.json, so this failing while entries.json passes means the two ` +
          `have been separated.`
      );
    });

    test(`${name}: the welcome text is painted, not waited for`, () => {
      // The LCP element is prerendered into index.html by build/lib/prerender.mjs
      // precisely so it does not wait on data. If the paint ever lands after the
      // dictionary arrives, that prerendering has stopped working - app.js is
      // blanking and redrawing the element instead of leaving the first render
      // alone, which is what data-prerendered on #entry-content is for.
      const m = runs[name].milestones;
      assert.ok(
        m.firstContentfulPaint !== null && m.firstContentfulPaint < 2000,
        `first contentful paint at ${m.firstContentfulPaint} ms over localhost is ` +
          `far too late for markup that is already in the HTML`
      );
    });

    test(`${name}: the service worker installs after the paint`, () => {
      // Registration sits about forty lines above the paint gate in boot(),
      // so unlike the dictionary fetch nothing holds it back. Its install
      // precaches the shell - which is the same entries.json and
      // search-index.json app.js has just downloaded - and the only thing
      // keeping that off the first frame is that the paint happens to get in
      // first. This records the size of that margin so a change that shrinks
      // it is visible rather than silent.
      const sw = runs[name].serviceWorker;
      if (sw.installStart === null) return; // no service worker on this run
      assert.ok(
        sw.marginAfterPaintMs > 0,
        `the service worker began installing ${-sw.marginAfterPaintMs} ms BEFORE the ` +
          `first paint. It precaches ${sw.duplicated.length} files including the whole ` +
          `dictionary, and doing that in front of the first frame is the problem the ` +
          `paint gate was written to solve for the fetch in app.js.`
      );
    });

    test(`${name}: nothing stalls between load and the first pixel`, () => {
      // The 777 ms stall that prompted this whole tool. It has never
      // reproduced locally - the paint normally lands before load fires, so
      // the gap is 0 - and this is here to say so if that ever changes. The
      // budget is deliberately loose: a small positive gap is ordinary
      // scheduling, and only a stall of a quarter of a second is a finding.
      const g = runs[name].gap;
      assert.ok(
        g.ms < 250,
        `${g.ms} ms passed between load and the first pixel, with the main thread ` +
          `busy for only ${g.mainThreadBusyMs} ms of it and its longest idle stretch ` +
          `${g.longestMainThreadIdleMs} ms. Run \`npm run trace\` for the ` +
          `per-thread breakdown.`
      );
    });
  }
});
