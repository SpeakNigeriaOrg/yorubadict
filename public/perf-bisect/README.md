# perf-bisect

Four pages that exist to find out which layer of the shell delays the first
paint on PageSpeed's mobile test, and nothing else. Delete the directory when
the question is answered.

## Why they exist

PageSpeed scores both `/` and `/about` at 87 on mobile, with a simulated First
Contentful Paint of 3010 ms on each - the same number to the millisecond, on
two different pages, on hosts benchmarking 576, 794 and 993. The observed first
paint is pinned at about 1320 ms across all of them while `load` moves from 560
to 685 ms with the machine.

A number that ignores machine speed and page content is a fixed wait, not work.
Everything is downloaded by 741 ms and the main thread is nearly idle until the
paint at ~1320 ms, and their own filmstrip shows the screen blank at 1125 ms
and fully drawn at 1500 ms.

It could not be reproduced locally on any hardware available: five viewport
profiles, CPU throttling from 1x to 20x, Slow 4G, a saturated machine,
localhost and production, under both a hand-written tracer and Lighthouse
itself. In every local run the paint lands BEFORE load. PageSpeed's slow host
is the only machine the effect has ever appeared on, so it has to be the
instrument, and these pages are the experiment it runs.

## The pages

The first four find the cost. Each adds exactly one layer to the one above it.

| page | what it has | result |
|---|---|---|
| `01-bare.html`  | one paragraph, no CSS, no fonts, no JS | 100, simulated FCP 764 ms |
| `02-css.html`   | 01 + `_tokens.css` and `style.css` | 100, 901 ms (+137) |
| `03-fonts.html` | 02 + the Google Fonts preload | **92, 2737 ms (+1836)** |
| `/` (the real front page) | 03 + `english-relevance.js` and `app.js` | 88, 3008 ms (+271) |

That is the answer: one `<link>` costs 1836 ms of simulated first paint and 8
of the 12 lost points. The site's own two stylesheets cost 137 ms and nothing.

The reason is origins. At Slow 4G Lantern charges a full DNS + TCP + TLS
handshake - three or four round trips at 150 ms each - for every new origin in
the first-paint path, and that one link brings in two: `fonts.googleapis.com`
for the stylesheet and `fonts.gstatic.com` for the files. Neither can reuse the
connection already open to yorubadict.com. Moving the link to
`preload` + `onload` (see the note in index.html) helped real browsers and did
not take it out of Lighthouse's graph.

The next three each fix it a different way. All three are `02-css` plus one
change, so their scores are directly comparable with each other and with 03.

| page | the fix | keeps |
|---|---|---|
| `04-fonts-inline.html`   | `@font-face` inlined, files still from gstatic | one third-party origin |
| `05-fonts-selfhost.html` | `@font-face` inlined, files from this origin | none |
| `06-fonts-after-paint.html` | the link unchanged, appended by script after the largest paint | both, but out of the graph |

04 and 05 hold the fonts on the first paint, so there is no flash of fallback
text. 06 accepts that flash in exchange for changing nothing about how the
fonts are hosted.

The 12 files in `fonts/` are the latin and latin-ext subsets only, which is
what Yorùbá needs - `ẹ ọ ṣ` and the combining tone marks. Dropping cyrillic,
greek, vietnamese and math takes 33 files to 12. They total 507 KB on disk but
`unicode-range` means a visit downloads about four of them.

## Running it

Deploy, then run PageSpeed mobile on each:

    https://yorubadict.com/perf-bisect/01-bare
    https://yorubadict.com/perf-bisect/02-css
    https://yorubadict.com/perf-bisect/03-fonts
    https://yorubadict.com/perf-bisect/04-fonts-inline
    https://yorubadict.com/perf-bisect/05-fonts-selfhost
    https://yorubadict.com/perf-bisect/06-fonts-after-paint
    https://yorubadict.com/

Or, with a key, all four at once:

    PSI_API_KEY=... node tools/trace/psi-runs.mjs --strategy=mobile \
      --url=https://yorubadict.com/perf-bisect/01-bare

Read the OBSERVED first paint, not the score - the score folds in other things.
The first page whose observed paint jumps to ~1300 ms is the layer that causes
it:

- **01 is already slow** - nothing in this site causes it. It is PageSpeed's
  mobile emulation on a slow host, and no change here will move the number.
- **01 fast, 02 slow** - the two stylesheets, despite Lighthouse's own
  render-blocking counterfactual reporting 0 ms.
- **02 fast, 03 slow** - the font preload flipping to a stylesheet
  (`onload="this.rel='stylesheet'"`), which re-blocks rendering when it fires.
- **03 fast, / slow** - `app.js`, and the boot path is where to look.

`noindex` on all three, and they are listed in robots.txt, so they will not be
crawled or land in the sitemap.
