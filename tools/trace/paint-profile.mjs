#!/usr/bin/env node
// tools/trace/paint-profile.mjs
//
// Finds out why the front page's first pixel is late on mobile and not on
// desktop.
//
// -------------------------------------------------------------------------
// The question this exists to answer
// -------------------------------------------------------------------------
// PageSpeed scored the front page 87 on mobile and 99 on desktop. Every point
// lost is first-paint timing: Total Blocking Time is 0 and Cumulative Layout
// Shift is 0, which between them are 55 of the 87. The dictionary download is
// not implicated - app.js waits for the LCP entry before asking for
// entries.json (see the note above the paint gate in app.js), and the trace
// confirms it, with the fetch starting 8ms after the paint on mobile and 68ms
// after on desktop.
//
// What the trace could not explain is this, from the mobile run:
//
//     every resource finished        533 ms
//     load fired                     560 ms
//     first pixel                   1337 ms      <- 777 ms of nothing
//
// and from the desktop run, same code, same connection:
//
//     first pixel                    313 ms
//     load fired                     368 ms      <- paint BEFORE load
//
// Lighthouse attributes the mobile gap to 274 ms of "Other" plus two long
// tasks marked "Unattributable", which is the report saying it does not know.
// Its main-thread breakdown only sees the renderer's main thread, so anything
// on a raster or compositor thread is invisible to it and lands in "Other".
// That is a hypothesis, not a finding, and it is the reason this file records
// a full trace across every process rather than reading a score.
//
// -------------------------------------------------------------------------
// How it answers it
// -------------------------------------------------------------------------
// One page, several emulation profiles, one variable changed at a time. The
// PageSpeed mobile profile differs from its desktop profile in three ways at
// once - viewport width, device scale factor, and the mobile flag - so the
// matrix below separates them:
//
//   desktop          1350x940  dsf 1     mobile:false   the 99 baseline
//   mobile-psi        412x823  dsf 1.75  mobile:true    the 87, reproduced
//   mobile-dsf1       412x823  dsf 1     mobile:true    drops the DPR
//   narrow-desktop    412x823  dsf 1     mobile:false   drops the mobile flag
//   desktop-dsf175   1350x940  dsf 1.75  mobile:false   DPR without the width
//
// Read the result like this:
//   gap follows the width          -> the <=800px CSS in style.css
//   gap follows the scale factor   -> raster cost, off the main thread
//   gap follows the mobile flag    -> emulation, and no real user pays it
//
// Network and CPU are left unthrottled by default because that is the
// condition the gap was observed in: PageSpeed uses throttlingMethod
// "simulate", so its trace is recorded at full speed and the Slow 4G numbers
// are modelled afterwards. Throttling here would be measuring a different run
// than the one with the question in it. --cpu and --net are there for when
// that is what you want.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { Cdp, chromeAvailable, chromePath, launchChrome } from './cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CONFIGS = {
  desktop: { width: 1350, height: 940, dsf: 1, mobile: false },
  'mobile-psi': { width: 412, height: 823, dsf: 1.75, mobile: true },
  'mobile-dsf1': { width: 412, height: 823, dsf: 1, mobile: true },
  'narrow-desktop': { width: 412, height: 823, dsf: 1, mobile: false },
  'desktop-dsf175': { width: 1350, height: 940, dsf: 1.75, mobile: false },
};

// Close to what Lighthouse records. The two disabled-by-default categories are
// the point of the exercise: timeline.frame carries the compositor's frame
// lifecycle and the rasterizer category carries the tile work, which is
// exactly the region Lighthouse reports as "Unattributable".
const TRACE_CATEGORIES = [
  '-*',
  'blink.user_timing',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-devtools.screenshot',
  'loading',
  'latencyInfo',
  'v8.execute',
].join(',');

// ---------------------------------------------------------------------------
// The static server
// ---------------------------------------------------------------------------

// Reuses server/dev-server.mjs rather than serving public/ a second way, so
// what is profiled is what `npm run serve` gives you.
//
// The port is chosen here and handed over in the environment, rather than
// letting the server take PORT=0 and reading back what the OS gave it: the
// dev server logs the port it was asked for, not the one it got, so PORT=0
// prints "localhost:0" and there is nothing to parse. Picking it here also
// keeps a developer's already-running `npm run serve` on 8080 out of the way,
// which while working on a page's performance is always running.
async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function serve() {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(root, 'server', 'dev-server.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev-server did not start')), 10000);
    proc.stdout.on('data', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.on('error', reject);
  });

  return { port, stop: () => proc.kill() };
}

// ---------------------------------------------------------------------------
// Trace analysis
// ---------------------------------------------------------------------------

// Trace timestamps are microseconds on a monotonic clock with an arbitrary
// origin, so everything is reported relative to navigationStart and in ms.
const ms = (us) => Math.round((us / 1000) * 10) / 10;

// Total wall time during which at least one of these events was running.
// Summing durations instead would double-count every nested call - a RunTask
// containing a FunctionCall containing a Layout is one busy millisecond, not
// three - and nesting is exactly what a main thread trace is made of.
function unionDuration(events, from, to) {
  const spans = events
    .map((e) => [Math.max(e.ts, from), Math.min(e.ts + (e.dur || 0), to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of spans) {
    if (!cur) cur = [a, b];
    else if (a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

// The longest stretch inside the window with nothing running on this thread.
// A 700 ms gap with an idle main thread is the whole finding: it means the
// delay is not main-thread work, and every "Unattributable" long task in the
// PageSpeed report is pointing somewhere else.
function longestIdle(events, from, to) {
  const spans = events
    .map((e) => [Math.max(e.ts, from), Math.min(e.ts + (e.dur || 0), to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let worst = 0;
  let cursor = from;
  let at = from;
  for (const [a, b] of spans) {
    if (a > cursor && a - cursor > worst) {
      worst = a - cursor;
      at = cursor;
    }
    cursor = Math.max(cursor, b);
  }
  if (to - cursor > worst) {
    worst = to - cursor;
    at = cursor;
  }
  return { duration: worst, start: at };
}

export function analyze(events, pageUrl) {
  // Metadata events name the processes and threads. Without them every number
  // below is attributed to a pid/tid pair, which answers nothing.
  const threadName = new Map();
  const processName = new Map();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args.name);
    if (e.name === 'process_name') processName.set(e.pid, e.args.name);
  }

  const named = (e) => threadName.get(`${e.pid}:${e.tid}`) || `tid ${e.tid}`;
  const byName = (n) => events.filter((e) => e.name === n);

  // Several navigations exist in any trace (about:blank first). The one that
  // matters is the one that loaded the page under test.
  const navs = byName('navigationStart').filter(
    (e) => !pageUrl || e.args?.data?.documentLoaderURL === pageUrl
  );
  const nav = navs.length ? navs[navs.length - 1] : byName('navigationStart').pop();
  if (!nav) throw new Error('No navigationStart in trace');
  const t0 = nav.ts;
  const frame = nav.args?.frame;

  const first = (n) => {
    const hits = byName(n).filter((e) => e.ts >= t0 && (!frame || (e.args?.frame ?? frame) === frame));
    return hits.length ? hits[0] : null;
  };
  const last = (n) => {
    const hits = byName(n).filter((e) => e.ts >= t0);
    return hits.length ? hits[hits.length - 1] : null;
  };

  const fp = first('firstPaint');
  const fcp = first('firstContentfulPaint');
  const lcp = last('largestContentfulPaint::Candidate');
  const dcl = first('MarkDOMContent');
  const load = first('MarkLoad');

  const milestones = {
    domContentLoaded: dcl ? ms(dcl.ts - t0) : null,
    load: load ? ms(load.ts - t0) : null,
    firstPaint: fp ? ms(fp.ts - t0) : null,
    firstContentfulPaint: fcp ? ms(fcp.ts - t0) : null,
    largestContentfulPaint: lcp ? ms(lcp.ts - t0) : null,
  };

  // Network, taken from the trace rather than from Network domain events so it
  // shares one clock with everything else. Aligning two clocks is a source of
  // exactly the kind of small error this tool exists to rule out.
  const sends = new Map();
  for (const e of byName('ResourceSendRequest')) {
    if (e.ts < t0) continue;
    sends.set(e.args.data.requestId, { url: e.args.data.url, start: ms(e.ts - t0), end: null });
  }
  for (const e of [...byName('ResourceFinish'), ...byName('ResourceReceivedData')]) {
    const r = sends.get(e.args?.data?.requestId);
    if (r) r.end = Math.max(r.end ?? 0, ms(e.ts - t0));
  }
  const requests = [...sends.values()].sort((a, b) => a.start - b.start);

  // The window under investigation: everything is on the wire and the document
  // is done, but nothing is on screen yet.
  const gapFrom = load ? load.ts : t0;
  const gapTo = fp ? fp.ts : gapFrom;
  const gapMs = ms(Math.max(0, gapTo - gapFrom));

  // Complete events only ('X' carries a duration; instant markers do not).
  const durational = events.filter((e) => e.ph === 'X' && e.dur > 0);
  const threads = new Map();
  for (const e of durational) {
    const key = `${processName.get(e.pid) || 'pid ' + e.pid} / ${named(e)}`;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(e);
  }

  const busyInGap = [];
  for (const [key, evs] of threads) {
    const busy = unionDuration(evs, gapFrom, gapTo);
    if (busy > 1000) busyInGap.push({ thread: key, busyMs: ms(busy) });
  }
  busyInGap.sort((a, b) => b.busyMs - a.busyMs);

  // What the renderer's main thread was doing, by event name. Inclusive time,
  // union-ed per name so a name that recurs is not counted twice - enough to
  // point at a culprit, which is all that is wanted here.
  const mainKey = [...threads.keys()].find((k) => k.includes('CrRendererMain'));
  const mainEvents = mainKey ? threads.get(mainKey) : [];
  const byEventName = new Map();
  for (const e of mainEvents) {
    if (e.ts + e.dur < gapFrom || e.ts > gapTo) continue;
    byEventName.set(e.name, (byEventName.get(e.name) || []).concat(e));
  }
  const mainBreakdown = [...byEventName.entries()]
    .map(([name, evs]) => ({ name, ms: ms(unionDuration(evs, gapFrom, gapTo)), count: evs.length }))
    .filter((r) => r.ms >= 1)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 12);

  const idle = longestIdle(mainEvents, gapFrom, gapTo);

  // Raster is the hypothesis the matrix is built to test, so it gets counted
  // on its own rather than being one row among the threads.
  const rasterEvents = durational.filter((e) => e.name === 'RasterTask');
  const rasterThreads = new Set(rasterEvents.map((e) => named(e)));

  return {
    milestones,
    gap: {
      from: ms(gapFrom - t0),
      to: ms(gapTo - t0),
      ms: gapMs,
      mainThreadBusyMs: ms(unionDuration(mainEvents, gapFrom, gapTo)),
      longestMainThreadIdleMs: ms(idle.duration),
      longestIdleStartsAt: ms(idle.start - t0),
      busyByThread: busyInGap,
      mainThreadBreakdown: mainBreakdown,
    },
    raster: {
      totalMsWholeTrace: ms(unionDuration(rasterEvents, t0, Number.MAX_SAFE_INTEGER)),
      msBeforeFirstPaint: fp ? ms(unionDuration(rasterEvents, t0, fp.ts)) : null,
      threads: [...rasterThreads],
      tasks: rasterEvents.length,
    },
    // The service worker installs on a first visit and precaches the shell,
    // which includes entries.json and search-index.json - the same two files
    // app.js has just fetched. So a first visit asks for the dictionary
    // twice. The second ask revalidates (Cloudflare sends an ETag, so it is a
    // 0-byte 304) but the cache write is not free, and unlike the fetch in
    // app.js it is not behind the paint gate: registration happens about 40
    // lines earlier in boot(). Recorded on every run because "not awaited" is
    // not the same as "not competing", and the margin is the only thing
    // keeping it out of the way of the first frame.
    serviceWorker: (() => {
      const seen = new Map();
      for (const r of requests) {
        seen.set(r.url, (seen.get(r.url) || 0) + 1);
      }
      const duplicated = [...seen.entries()]
        .filter(([, n]) => n > 1)
        .map(([url, n]) => ({ url: url.replace(/^https?:\/\/[^/]+/, ''), times: n }));
      const install = requests.find((r) => r.url.endsWith('/data/version.json'));
      const paintAt = milestones.firstPaint;
      return {
        installStart: install ? install.start : null,
        marginAfterPaintMs:
          install && paintAt !== null ? Math.round((install.start - paintAt) * 10) / 10 : null,
        duplicated,
      };
    })(),

    // The claim from the previous analysis, re-checked on every run rather
    // than trusted: the dictionary must be requested after the paint, or the
    // gate in app.js has regressed and LCP goes back to counting 1.9 MB.
    dictionary: (() => {
      const entries = requests.find((r) => r.url.endsWith('/data/entries.json'));
      const index = requests.find((r) => r.url.endsWith('/data/search-index.json'));
      const paintAt = milestones.largestContentfulPaint ?? milestones.firstContentfulPaint;
      return {
        entriesStart: entries ? entries.start : null,
        indexStart: index ? index.start : null,
        paintAt,
        afterPaintByMs:
          entries && paintAt !== null ? Math.round((entries.start - paintAt) * 10) / 10 : null,
      };
    })(),
    requests,
  };
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

export async function profile(cdp, url, config, opts = {}) {
  const { cpu = 1, net = null, bypassServiceWorker = false, reload = false } = opts;

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);

  try {
    await s('Page.enable');
    await s('Network.enable');
    await s('Page.setLifecycleEventsEnabled', { enabled: true });

    await s('Emulation.setDeviceMetricsOverride', {
      width: config.width,
      height: config.height,
      deviceScaleFactor: config.dsf,
      mobile: config.mobile,
      screenWidth: config.width,
      screenHeight: config.height,
    });
    // The mobile flag on its own does not turn on touch, and a page that
    // branches on pointer support would be measured in a state no device is
    // ever in. style.css branches on width, not pointer, but pinning this
    // makes "mobile:true" mean one thing rather than two.
    // maxTouchPoints is only sent when touch is on: the protocol rejects 0 as
    // out of range even while disabling, which fails the whole run.
    await s('Emulation.setTouchEmulationEnabled', {
      enabled: config.mobile,
      ...(config.mobile ? { maxTouchPoints: 5 } : {}),
    });
    if (cpu > 1) await s('Emulation.setCPUThrottlingRate', { rate: cpu });
    if (net === 'slow4g') {
      await s('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: (1638.4 * 1024) / 8,
        uploadThroughput: (675 * 1024) / 8,
      });
    }
    await s('Network.setCacheDisabled', { cacheDisabled: !reload });
    if (bypassServiceWorker) await s('Network.setBypassServiceWorker', { bypass: true });

    // A cold run has to be cold in the way a first visit is cold. sw.js
    // precaches the dictionary on install, so without this the second
    // configuration in the matrix would be measuring a warm cache and the
    // comparison the whole file is built on would be meaningless.
    if (!reload) {
      await s('Storage.clearDataForOrigin', {
        origin: new URL(url).origin,
        storageTypes: 'all',
      }).catch(() => {});
    }

    if (reload) {
      // Warm case: load once, let the service worker install and settle, then
      // trace the second load. This is the repeat-visit path, where
      // public/_headers' max-age=0 policy is actually paid.
      await s('Page.navigate', { url });
      await cdp.once('Page.lifecycleEvent', (p) => p.name === 'networkIdle', 45000).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }

    const collected = [];
    const offData = cdp.on('Tracing.dataCollected', (p) => collected.push(...p.value));
    await cdp.send('Tracing.start', {
      traceConfig: { includedCategories: TRACE_CATEGORIES.split(',') },
      transferMode: 'ReportEvents',
    });

    const fcpSeen = cdp.once(
      'Page.lifecycleEvent',
      (p) => p.name === 'firstContentfulPaint',
      45000
    );
    await s('Page.navigate', { url });
    await fcpSeen;
    // Let the dictionary fetch and the raster settle, so the run captures what
    // happens after the paint as well as before it.
    await new Promise((r) => setTimeout(r, 3000));

    const complete = cdp.once('Tracing.tracingComplete', () => true, 60000);
    await cdp.send('Tracing.end');
    await complete;
    offData();

    return analyze(collected, url);
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pad(s, n) {
  s = String(s ?? '—');
  return s + ' '.repeat(Math.max(0, n - s.length));
}

function report(results) {
  const names = Object.keys(results);
  console.log('\n' + '='.repeat(78));
  console.log('MILESTONES (ms from navigationStart)');
  console.log('='.repeat(78));
  const rows = [
    ['DOMContentLoaded', 'domContentLoaded'],
    ['load', 'load'],
    ['first paint', 'firstPaint'],
    ['first contentful paint', 'firstContentfulPaint'],
    ['largest contentful paint', 'largestContentfulPaint'],
  ];
  console.log(pad('', 26) + names.map((n) => pad(n, 16)).join(''));
  for (const [label, key] of rows) {
    console.log(
      pad(label, 26) + names.map((n) => pad(results[n].milestones[key], 16)).join('')
    );
  }
  console.log(
    pad('GAP load -> first paint', 26) + names.map((n) => pad(results[n].gap.ms, 16)).join('')
  );
  console.log(
    pad('  main thread busy in gap', 26) +
      names.map((n) => pad(results[n].gap.mainThreadBusyMs, 16)).join('')
  );
  console.log(
    pad('  longest main idle', 26) +
      names.map((n) => pad(results[n].gap.longestMainThreadIdleMs, 16)).join('')
  );
  console.log(
    pad('raster ms before paint', 26) +
      names.map((n) => pad(results[n].raster.msBeforeFirstPaint, 16)).join('')
  );
  console.log(
    pad('raster tasks (whole run)', 26) +
      names.map((n) => pad(results[n].raster.tasks, 16)).join('')
  );

  console.log('\n' + '='.repeat(78));
  console.log('DICTIONARY FETCH vs PAINT  (must be positive - see app.js paint gate)');
  console.log('='.repeat(78));
  for (const n of names) {
    const d = results[n].dictionary;
    console.log(
      `${pad(n, 18)} entries.json at ${pad(d.entriesStart, 9)} paint at ${pad(d.paintAt, 9)}` +
        ` -> ${d.afterPaintByMs === null ? '—' : (d.afterPaintByMs > 0 ? '+' : '') + d.afterPaintByMs + ' ms'}`
    );
  }

  console.log('\n' + '='.repeat(78));
  console.log('SERVICE WORKER INSTALL  (not behind the paint gate - see app.js:1056)');
  console.log('='.repeat(78));
  for (const n of names) {
    const sw = results[n].serviceWorker;
    console.log(
      `${pad(n, 18)} install at ${pad(sw.installStart, 9)}` +
        ' (' +
        (sw.marginAfterPaintMs === null
          ? '—'
          : (sw.marginAfterPaintMs > 0 ? '+' : '') + sw.marginAfterPaintMs + ' ms after paint') +
        ')'
    );
    for (const d of sw.duplicated) {
      console.log(`${pad('', 18)}   fetched ${d.times}x: ${d.url}`);
    }
  }

  for (const n of names) {
    const g = results[n].gap;
    if (!g.busyByThread.length && !g.mainThreadBreakdown.length) continue;
    console.log('\n' + '-'.repeat(78));
    console.log(`${n}: what ran during the ${g.ms} ms gap`);
    console.log('-'.repeat(78));
    for (const t of g.busyByThread.slice(0, 8)) {
      console.log(`  ${pad(t.busyMs + ' ms', 10)} ${t.thread}`);
    }
    if (g.mainThreadBreakdown.length) {
      console.log('  renderer main thread, by event:');
      for (const r of g.mainThreadBreakdown) {
        console.log(`    ${pad(r.ms + ' ms', 10)} ${pad(r.name, 30)} x${r.count}`);
      }
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : dflt;
  };
  const has = (name) => argv.includes(`--${name}`);

  if (!(await chromeAvailable())) {
    console.error(`No Chrome at ${chromePath()}. Set CHROME_PATH to point at one.`);
    process.exit(2);
  }

  const only = flag('config', null);
  const configs = only
    ? Object.fromEntries(only.split(',').map((k) => [k, CONFIGS[k]]))
    : CONFIGS;
  for (const [k, v] of Object.entries(configs)) {
    if (!v) {
      console.error(`Unknown config "${k}". Known: ${Object.keys(CONFIGS).join(', ')}`);
      process.exit(2);
    }
  }

  const opts = {
    cpu: Number(flag('cpu', 1)),
    net: flag('net', null),
    bypassServiceWorker: has('no-sw'),
    reload: has('warm'),
  };
  const runs = Number(flag('runs', 1));
  const pagePath = flag('path', '/');

  // --url points at production. This matters more than it looks: over
  // localhost every resource arrives in single-digit milliseconds, the paint
  // lands at ~50 ms, and the gap this file was written to explain does not
  // exist to be measured. The gap was observed against yorubadict.com over a
  // real network, so reproducing it needs a real network. The local server is
  // for testing a change before it ships; --url is for diagnosing what ships.
  const remote = flag('url', null);
  const server = remote ? null : await serve();
  const chrome = await launchChrome({ headless: !has('headed'), gpu: has('gpu') });
  const cdp = await Cdp.connect(chrome.webSocketDebuggerUrl);
  const url = remote ? new URL(pagePath, remote).href : `http://localhost:${server.port}${pagePath}`;

  console.log(`Profiling ${url}`);
  console.log(
    `  chrome: ${chromePath()}  headless:${!has('headed')} gpu:${has('gpu')}` +
      `  cpu:${opts.cpu}x net:${opts.net || 'unthrottled'} sw:${opts.bypassServiceWorker ? 'bypassed' : 'on'}` +
      `  ${opts.reload ? 'WARM (second load)' : 'cold'}  runs:${runs}`
  );

  const results = {};
  try {
    for (const [name, config] of Object.entries(configs)) {
      // Repeated runs take the median gap rather than the mean: one slow run
      // from an unrelated hiccup should not move the number this is read for.
      const attempts = [];
      for (let i = 0; i < runs; i++) {
        process.stdout.write(`  ${name} (${i + 1}/${runs})… `);
        attempts.push(await profile(cdp, url, config, opts));
        process.stdout.write(`${attempts[i].gap.ms} ms gap\n`);
      }
      attempts.sort((a, b) => a.gap.ms - b.gap.ms);
      results[name] = attempts[Math.floor(attempts.length / 2)];
    }
  } finally {
    cdp.close();
    await chrome.close();
    server?.stop();
  }

  report(results);

  if (has('json')) {
    const out = path.join(root, 'tools', 'trace', 'paint-profile.json');
    await writeFile(out, JSON.stringify(results, null, 2));
    console.log(`Full results written to ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
