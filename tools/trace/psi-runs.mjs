#!/usr/bin/env node
// tools/trace/psi-runs.mjs
//
// Runs PageSpeed Insights several times and reports the spread.
//
// Written to answer "is the 87 stable or is it a bad sample", and the answer
// came back stable: 87 every time, with a simulated First Contentful Paint of
// 3010 ms and 3011 ms on two runs against hosts of different speeds. A model
// output agreeing to the millisecond is not noise. Keep it for watching the
// number over time, not for deciding whether to believe it.
//
// What the number is made of, from PageSpeed's own audits:
//
//   Total Blocking Time    0 ms       full marks   30 points
//   Cumulative Layout Sh.  0          full marks   25 points
//   Largest Contentful P.  3160 ms    0.73         18.3
//   First Contentful P.    3010 ms    0.49          4.9
//   Speed Index            3062 ms    0.93          9.3
//                                                  ----
//                                                  87.5
//
// Every lost point is first paint. PageSpeed's LCP breakdown puts 1312.9 ms of
// the 1313 ms into "element render delay" - time after the document has
// arrived and before the element appears - and its filmstrip shows the screen
// blank at 1125 ms and fully drawn at 1500 ms, with all 17 requests finished
// by 741 ms. So the page sits fully downloaded and blank for about six tenths
// of a second on their hardware.
//
// Not the stylesheets: Lighthouse's own counterfactual for the render-blocking
// audit is FCP 0 ms, LCP 0 ms. Not the dictionary: it is requested 12 ms after
// the paint on every run, on both form factors. It is the render delay, and it
// only appears on hosts around a quarter the speed of a 2023 laptop
// (benchmarkIndex ~990 against ~3900). paint-profile.mjs could not reproduce
// it across five viewport profiles, CPU throttling from 1x to 20x, Slow 4G,
// localhost and production - in every local run the paint lands BEFORE load.
//
// Which is why the next step is here rather than there: change one thing, ship
// it, and re-run this. PageSpeed's slow host is the only machine the effect
// has ever been seen on, so it is the instrument.
//
// Needs a key. The keyless quota is a single pool shared by every anonymous
// caller on earth and is usually already exhausted - the failure is a 429 that
// says "quota exceeded for consumer project_number:...", which is Google's,
// not yours. A key is free from
// https://developers.google.com/speed/docs/insights/v5/get-started
//
//   PSI_API_KEY=... node tools/trace/psi-runs.mjs --runs=5
//
// --url takes any page, so a second URL on the same site is a control: if
// /about shows the same render delay, it is the shell (CSS, fonts, app.js
// boot); if only / does, it is something the front page does on its own.

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

export async function runOnce(url, strategy, key) {
  const qs = new URLSearchParams({ url, strategy, category: 'performance' });
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

  // --bisect runs the four pages in public/perf-bisect in order, each of which
  // adds one layer to the one before it. The first page whose OBSERVED first
  // paint jumps to ~1300 ms is the layer that causes the delay; read that
  // column, not the score, which folds in other things.
  const origin = flag('origin', 'https://yorubadict.com');
  const urls = has('bisect')
    ? [
        `${origin}/perf-bisect/01-bare`,
        `${origin}/perf-bisect/02-css`,
        `${origin}/perf-bisect/03-fonts`,
        `${origin}/`,
      ]
    : flag('url', 'https://yorubadict.com/').split(',');
  const runs = Number(flag('runs', has('bisect') ? 3 : 5));
  const strategies = flag('strategy', has('bisect') ? 'mobile' : 'mobile,desktop').split(',');
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
