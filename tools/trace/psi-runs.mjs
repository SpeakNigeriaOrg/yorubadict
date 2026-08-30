#!/usr/bin/env node
// tools/trace/psi-runs.mjs
//
// Runs PageSpeed Insights several times and reports the spread.
//
// Runs PageSpeed Insights several times and reports the spread.
//
// PageSpeed caches a result per URL, so asking twice for the same address
// gives the same answer back and it looks like agreement. This appends a
// unique query string to each request so every run is a real one, which is the
// only reason the numbers below have a spread at all. A single run is not a
// measurement.
//
// What it was built for, and what that found. The mobile score was 87 on every
// page, with a simulated First Contentful Paint of 3010ms that did not move
// between pages or between hosts benchmarking 576 to 993 - a model output
// agreeing to the millisecond, so not noise. The cause was one <link> to
// fonts.googleapis.com. Not its bytes: Lighthouse models a Slow 4G connection
// and charges a full DNS + TCP + TLS handshake, three or four round trips at
// 150ms each, for every new origin on the path to first paint, and that link
// brought in two. Serving the fonts from this origin instead took the front
// page and /about from 87 to about 98. The reasoning now lives above the
// @font-face rules in public/style.css.
//
// Two things worth keeping from how that went:
//
//   Lighthouse's own render-blocking audit reported 0ms of savings for the two
//   local stylesheets, and it was right - they cost 137ms and no points. The
//   thing doing the damage was not flagged by any audit, because a preload
//   that becomes a stylesheet is not what that audit looks for.
//
//   Nothing local reproduced it. Five viewport profiles, CPU throttling from
//   1x to 20x, Slow 4G, a saturated machine, localhost and production, under
//   both tools/trace/paint-profile.mjs and Lighthouse itself. Every local run
//   painted before load. The effect only existed on PageSpeed's own slow
//   hosts, which is why this file exists at all.
//
// Needs a key. The keyless quota is one pool shared by every uncredentialed
// caller and is usually spent - the failure is a 429 naming a project number
// that is Google's, not yours. A key is free from
// https://developers.google.com/speed/docs/insights/v5/get-started, and goes
// in .env.local (copy .env.example).
//
//   node tools/trace/psi-runs.mjs --runs=5
//   node tools/trace/psi-runs.mjs --url=https://yorubadict.com/about --strategy=mobile

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// Reads .env.local if it is there, so the key does not have to be typed onto
// the command line every time. Typing it there is the thing worth avoiding:
// shells keep history, and a key in ~/.zsh_history outlives every intention of
// deleting it. An environment variable set by hand still wins, because a
// developer who exported PSI_API_KEY meant it.
function loadKey() {
  if (process.env.PSI_API_KEY) return process.env.PSI_API_KEY;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const envFile = path.join(root, '.env.local');
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* unreadable or malformed - fall through to the message below */
    }
  }
  const key = (process.env.PSI_API_KEY || '').trim();
  // A placeholder left in from .env.example fails at Google with a 400 that
  // says nothing useful, so it is caught here where the cause is obvious.
  if (!key || key.startsWith('<') || key.toUpperCase() === 'YOUR_KEY_HERE') return null;
  return key;
}

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export async function runOnce(url, strategy, key, { bust = true } = {}) {
  // A unique query string per request. Without it PageSpeed answers from its
  // own cache and repeated runs return byte-identical numbers, which reads as
  // a stable measurement and is actually a single one. The page served is the
  // same either way - the query is not used by anything here.
  const target = bust
    ? url + (url.includes('?') ? '&' : '?') + 'psi=' + process.hrtime.bigint()
    : url;
  const qs = new URLSearchParams({ url: target, strategy, category: 'performance' });
  if (key) qs.set('key', key);
  const res = await fetch(`${API}?${qs}`);
  const body = await res.json();
  if (body.error) throw new Error(`PSI ${body.error.code}: ${body.error.message}`);

  const lh = body.lighthouseResult;
  const a = lh.audits;
  const m = a.metrics.details.items[0];

  // The gap under investigation, recomputed on every sample. Negative means
  // the page painted before load fired, which is the healthy shape and the
  // one every local run produced.
  const gap = m.observedFirstContentfulPaint - m.observedLoad;

  // Re-checks the paint gate in app.js from the other side: PSI's own
  // waterfall must show entries.json requested after the paint. If this ever
  // goes negative, LCP is about to start counting 1.9 MB of dictionary and
  // the score will collapse, exactly as it did before the gate was written.
  const reqs = a['network-requests'].details.items;
  const entries = reqs.find((r) => r.url.endsWith('/data/entries.json'));

  return {
    score: Math.round(lh.categories.performance.score * 100),
    fcp: Math.round(a['first-contentful-paint'].numericValue),
    lcp: Math.round(a['largest-contentful-paint'].numericValue),
    tbt: Math.round(a['total-blocking-time'].numericValue),
    cls: a['cumulative-layout-shift'].numericValue,
    observedFcp: m.observedFirstContentfulPaint,
    observedLoad: m.observedLoad,
    gap,
    benchmarkIndex: lh.environment.benchmarkIndex,
    dictionaryAfterPaintMs: entries
      ? Math.round(entries.networkRequestTime - m.observedLargestContentfulPaint)
      : null,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.split('=').slice(1).join('=') : d;
  };
  const has = (n) => argv.includes(`--${n}`);

  const origin = flag('origin', 'https://yorubadict.com');
  const urls = flag('url', 'https://yorubadict.com/').split(',');
  const runs = Number(flag('runs', 5));
  const strategies = flag('strategy', 'mobile,desktop').split(',');
  const key = loadKey();

  if (!key) {
    console.warn(
      'No PSI_API_KEY found. Falling back to the anonymous quota, which is a single\n' +
        'pool shared by every uncredentialed caller and is usually already spent.\n' +
        'Put a key in .env.local (copy .env.example) to raise the limit.\n'
    );
  }

  const summary = [];
  for (const url of urls) {
   for (const strategy of strategies) {
    const samples = [];
    console.log(`\n${strategy.toUpperCase()}  ${url}`);
    for (let i = 0; i < runs; i++) {
      process.stdout.write(`  run ${i + 1}/${runs}… `);
      try {
        const r = await runOnce(url, strategy, key);
        samples.push(r);
        console.log(
          `score ${r.score}  fcp ${r.fcp}  lcp ${r.lcp}  tbt ${r.tbt}  ` +
            `gap ${r.gap > 0 ? '+' : ''}${r.gap}ms  host ${Math.round(r.benchmarkIndex)}` +
            `  dict ${r.dictionaryAfterPaintMs === null ? '—' : (r.dictionaryAfterPaintMs > 0 ? '+' : '') + r.dictionaryAfterPaintMs + 'ms'}`
        );
      } catch (err) {
        console.log(`failed: ${err.message}`);
      }
    }
    if (!samples.length) continue;

    const col = (k) => samples.map((s) => s[k]);
    const line = (label, k, unit = '') => {
      const xs = col(k);
      console.log(
        `    ${label.padEnd(22)} min ${String(Math.min(...xs)).padEnd(7)}` +
          `median ${String(Math.round(quantile(xs, 0.5) * 10) / 10).padEnd(7)}` +
          `max ${String(Math.max(...xs)).padEnd(7)}${unit}`
      );
    };
    console.log(`  spread over ${samples.length} runs:`);
    line('performance score', 'score');
    line('FCP (simulated)', 'fcp', 'ms');
    line('LCP (simulated)', 'lcp', 'ms');
    line('load -> paint gap', 'gap', 'ms');
    line('host benchmarkIndex', 'benchmarkIndex');
    line('dictionary vs paint', 'dictionaryAfterPaintMs', 'ms');

    const scores = col('score');
    const range = Math.max(...scores) - Math.min(...scores);
    const gaps = col('gap');
    console.log(
      `\n  Score varies by ${range} points across identical runs` +
        (range >= 8
          ? ' - too much to read a single run as a measurement.'
          : ' - stable, so a change in it is a real change.')
    );
    console.log(
      `  load -> paint gap: ${Math.min(...gaps)} to ${Math.max(...gaps)} ms. ` +
        (Math.max(...gaps) > 200
          ? 'Positive means the screen was blank after everything had arrived; that is where the points are.'
          : 'Negative means the page painted before load, which is the healthy shape.')
    );
    const worstDict = Math.min(...col('dictionaryAfterPaintMs').filter((x) => x !== null));
    if (Number.isFinite(worstDict)) {
      console.log(
        `  Closest the dictionary came to the paint: ${worstDict > 0 ? '+' : ''}${worstDict} ms` +
          (worstDict <= 0
            ? '  <-- THE PAINT GATE FAILED. See app.js.'
            : worstDict < 50
              ? '  <-- thin margin; see the paint gate note in app.js.'
              : '')
      );
    }

    summary.push({
      url: url.replace(origin, '') || '/',
      strategy,
      score: Math.round(quantile(col('score'), 0.5)),
      observedFcp: Math.round(quantile(col('observedFcp'), 0.5)),
      observedLoad: Math.round(quantile(col('observedLoad'), 0.5)),
      gap: Math.round(quantile(col('gap'), 0.5)),
      host: Math.round(quantile(col('benchmarkIndex'), 0.5)),
    });
   }
  }

  if (summary.length > 1) {
    console.log('\n' + '='.repeat(74));
    console.log('SIDE BY SIDE  (medians; read observed paint, not score)');
    console.log('='.repeat(74));
    const p = (v, n) => String(v ?? '—').padEnd(n);
    console.log(p('page', 26) + p('score', 8) + p('obs paint', 12) + p('obs load', 11) + p('gap', 9) + 'host');
    for (const r of summary) {
      console.log(
        p(r.url, 26) + p(r.score, 8) + p(r.observedFcp + ' ms', 12) +
          p(r.observedLoad + ' ms', 11) + p((r.gap > 0 ? '+' : '') + r.gap, 9) + r.host
      );
    }
    // The whole point of the run, stated rather than left to be eyeballed.
    const slow = summary.find((r) => r.observedFcp > 900);
    console.log('');
    if (!slow) {
      console.log('  No page showed the delay. Either it has been fixed or the host was fast');
      console.log('  this time - check the host column against ~990, where it was first seen.');
    } else if (slow === summary[0]) {
      console.log(`  ${slow.url} is ALREADY slow, and it is one paragraph with no CSS, no`);
      console.log('  fonts and no JavaScript. Nothing in this site causes the delay: it is');
      console.log("  PageSpeed's mobile emulation on a slow host, and no change here moves it.");
    } else {
      const before = summary[summary.indexOf(slow) - 1];
      console.log(`  ${before.url} paints at ${before.observedFcp} ms and ${slow.url} at ${slow.observedFcp} ms.`);
      console.log(`  The layer added between them is what delays the paint.`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
