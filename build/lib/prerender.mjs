// build/lib/prerender.mjs
//
// Writes a real HTML file for every word in the dictionary.
//
// Why this exists: for its first year this site was one URL. Every entry lived
// behind a #/entry/<id> fragment, a fragment is never sent to a server, and so
// the only page a search engine could ever see was the front one. Worse, a
// crawler that does run JavaScript was locked out too - robots.txt disallows
// /data/, which is where the dictionary is, so a renderer got as far as
// "Loading the dictionary…" and captured that. Nobody searching for a Yorùbá
// word could land on it.
//
// So: 6,273 files, each with its definitions already in the markup, a real
// title and description, a canonical URL, and ordinary <a> links to related
// words - which is the other half of the problem, because search results used
// to be <button>s and there was no link graph to follow at all.
//
// The markup comes from public/entry-render.js and public/page-render.js, the
// same files the browser uses. Not a copy: a copy drifts, and the drift shows
// up as a page that reads differently to a crawler than to a person, which is
// the one thing you must never ship.
//
// The shell comes from public/index.html, read as a template. Its head and its
// #entry-content are marked, and only what is between the markers is replaced,
// so reading it is idempotent and the header, footer and stylesheets can never
// fall out of step with the app.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { groupBySpelling, spellingPathFor } from './address.mjs';
import { createEntryRenderer } from '../../public/entry-render.js';
import { createPageRenderer } from '../../public/page-render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

export const ORIGIN = 'https://yorubadict.com';

const HEAD_OPEN = '<!--PRERENDER-HEAD-->';
const HEAD_CLOSE = '<!--/PRERENDER-HEAD-->';
const BODY_OPEN = '<!--PRERENDER-BODY-->';
const BODY_CLOSE = '<!--/PRERENDER-BODY-->';

const escapeAttr = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function readTemplate(templatePath) {
  const html = readFileSync(templatePath, 'utf8');
  for (const marker of [HEAD_OPEN, HEAD_CLOSE, BODY_OPEN, BODY_CLOSE]) {
    if (!html.includes(marker)) {
      throw new Error(
        `${path.relative(process.cwd(), templatePath)} is missing ${marker}.\n` +
          'The prerenderer replaces what is between the markers and cannot guess ' +
          'where they were meant to be.'
      );
    }
  }
  return html;
}

function fill(template, { head, body, urlPath }) {
  const headStart = template.indexOf(HEAD_OPEN) + HEAD_OPEN.length;
  const headEnd = template.indexOf(HEAD_CLOSE);
  const withHead = template.slice(0, headStart) + '\n' + head + '\n' + template.slice(headEnd);

  const bodyStart = withHead.indexOf(BODY_OPEN) + BODY_OPEN.length;
  const bodyEnd = withHead.indexOf(BODY_CLOSE);
  const withBody = withHead.slice(0, bodyStart) + body + withHead.slice(bodyEnd);

  // Which page this markup is, not merely that it was prerendered. app.js skips
  // its first render when this matches the address it was opened at, and renders
  // normally when it does not - which is what happens when the service worker
  // answers an uncached word with the cached shell.
  //
  // Matched by attribute, not by its value: / is written last and overwrites the
  // very file the template was read from, so on the next build the shell says
  // data-prerendered="/" rather than "true". Looking for the literal "true"
  // worked once and then silently stopped stamping anything.
  return withBody.replace(
    /data-prerendered="[^"]*"/,
    `data-prerendered="${escapeAttr(urlPath)}"`
  );
}

/**
 * The head of one page.
 *
 * A description per page rather than one for the site, because the site-wide one
 * was what every entry got, and a search result whose snippet describes the
 * dictionary rather than the word is a result nobody clicks.
 */
function head({ title, description, canonical, jsonLd }) {
  const lines = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
    `<link rel="canonical" href="${escapeAttr(canonical)}" />`,
    '<meta property="og:type" content="article" />',
    '<meta property="og:site_name" content="Sọ̀rọ̀ Sókè" />',
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${escapeAttr(canonical)}" />`,
    // One card for the whole site rather than one per word. A per-word image
    // would mean 7,109 PNGs to render and keep in step, and the title and
    // description beside it already name the word - which is the part a reader
    // scanning a shared link actually reads.
    `<meta property="og:image" content="${ORIGIN}/og-image.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Yorùbá Dictionary — search Yorùbá or English, either direction" />',
    // Without this the card is a thumbnail beside the text instead of the
    // full-width image, on Twitter and on everything that copied its tags.
    '<meta name="twitter:card" content="summary_large_image" />',
  ];
  if (jsonLd) {
    // </script> inside a JSON string would close this block early.
    lines.push(
      '<script type="application/ld+json">' +
        JSON.stringify(jsonLd).replace(/</g, '\\u003c') +
        '</script>'
    );
  }
  return lines.join('\n');
}

const definitionsOf = (entry) => {
  const out = [];
  for (const sense of entry.senses || []) {
    const gloss = (sense.glosses || [])[0];
    if (gloss && !out.includes(gloss)) out.push(gloss);
  }
  return out;
};

/**
 * What a search result should say about this word.
 *
 * The spelling, its part of speech, and as many of its meanings as fit. Wiktionary
 * definitions are terse enough that two or three fit in the ~155 characters a
 * result shows, and they are the only thing a reader is looking for.
 */
export function descriptionFor(entry) {
  const spelling = (entry.canonicalForm || {}).value || entry.headword;
  const definitions = definitionsOf(entry);
  const lead = `${spelling}${entry.pos ? ` (${entry.pos})` : ''} in Yorùbá: `;
  let out = lead;
  for (const definition of definitions) {
    const next = out === lead ? out + definition : `${out}; ${definition}`;
    if (next.length > 155 && out !== lead) break;
    out = next;
    if (out.length > 155) break;
  }
  if (out === lead) out = `${lead}a Yorùbá word in Sọ̀rọ̀ Sókè, The People’s Yorùbá Dictionary.`;
  return out.length > 300 ? `${out.slice(0, 297)}…` : out;
}

/** Schema.org, so the definition can be read as a definition and not just prose. */
function jsonLdFor(entry, canonical) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: (entry.canonicalForm || {}).value || entry.headword,
    inLanguage: 'yo',
    url: canonical,
    description: definitionsOf(entry).join('; ') || undefined,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'Sọ̀rọ̀ Sókè — The People’s Yorùbá Dictionary',
      url: `${ORIGIN}/`,
    },
  };
}

/**
 * Write every page of the site.
 *
 * entries must already carry `path` - see build/lib/slugs.mjs, which is also
 * what refuses to let two of them share one.
 */
export function prerender(entries, { publicDir = PUBLIC_DIR, redirects = [], provisional = new Set() } = {}) {
  const template = readTemplate(path.join(publicDir, 'index.html'));
  const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));

  const renderer = createEntryRenderer({
    entries: byId,
    // Empty on purpose. mentioned-words.json currently holds no words, so every
    // link it could produce would be a dead one; a prerendered dead link is
    // worse than none, because a crawler follows it.
    mentionedByKey: {},
    pathFor: (entryId) => (byId[entryId] ? byId[entryId].path : '/'),
    mentionedPath: (spelling) => `/mentioned/${encodeURIComponent(spelling)}`,
    pagePath: (name) => (name === 'welcome' ? '/' : `/${name}`),
    orthographyInsensitive: (s) =>
      (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase(),
  });

  // The written pages name entries by id, by hand - ilé ayé on About, the three
  // sample units on Language of Connections, pàdé on Contribute. A refresh can
  // drop any of them, and the fallback below turns that into a link to the front
  // page: no error, no broken link, just a paragraph that stops meaning what it
  // says. So every id asked for is recorded and returned as missingNamedWords.
  const missingPageIds = new Set();
  const pages = createPageRenderer({
    pathFor: (entryId) => {
      if (byId[entryId]) return byId[entryId].path;
      missingPageIds.add(entryId);
      return '/';
    },
    pagePath: (name) => (name === 'welcome' ? '/' : `/${name}`),
    escapeHtml: renderer.escapeHtml,
  });

  const written = [];
  // Pages that exist but are not destinations. Kept apart from `written`
  // because that one list feeds two different things - the sitemap and the
  // stale-page sweep - and these belong in exactly one of them. In the sitemap
  // they would be 3,514 URLs asking to be indexed on their way somewhere else;
  // outside the sweep's keep-set they would be deleted by the build that wrote
  // them, which is what happened to 404.html until it was excepted by name.
  const forwarded = [];

  // <path>.html, not <path>/index.html. Cloudflare Pages resolves both, but not
  // to the same address: a directory holding an index.html is served at
  // /yo/gba/take/ and /yo/gba/take is a 308 to it, while take.html is served at
  // /yo/gba/take itself. The form without the slash is the one this project
  // already commits to everywhere else - the canonical tag, the sitemap, the
  // pushState in app.js - so the files follow that rather than the reverse.
  // Built the other way round, all 7,109 pages cost a redirect before they
  // answer, and all 7,109 canonicals name a URL that redirects.
  // Written and swept like any other page, but absent from the sitemap. Kept as
  // a set of paths rather than a third list so `written` stays the one answer to
  // "what pages exist", which is what the sweep needs.
  const unlisted = new Set();
  const write = (urlPath, html, { listed = true } = {}) => {
    if (!listed) unlisted.add(urlPath);
    const file =
      urlPath === '/'
        ? path.join(publicDir, 'index.html')
        : path.join(publicDir, `${urlPath.replace(/^\//, '')}.html`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, html);
    written.push({ path: urlPath, bytes: html.length });
  };

  for (const entry of entries) {
    const canonical = ORIGIN + entry.path;
    // A provisional address is a rule's guess at a word nobody has read yet,
    // and it is meant to be replaced. The page is written and served; it is the
    // sitemap it stays out of, so the guess is not advertised for indexing
    // before it settles. See build/lib/slugs.mjs.
    const listed = !provisional.has(entry.id);
    write(
      entry.path,
      fill(template, {
        urlPath: entry.path,
        head: head({
          title: renderer.titleFor(entry),
          description: descriptionFor(entry),
          canonical,
          jsonLd: jsonLdFor(entry, canonical),
        }),
        body: renderer.entryHtml(entry),
      }),
      { listed }
    );
  }

  // A page for each spelling more than one word is written with.
  //
  // A spelling only one word is written with. /yo/amala is not a page in its own
  // right - there is nothing to disambiguate, and a list of one word would say
  // nothing the word's own page does not while competing with it for the same
  // search. But it should not be a dead end either: it is what somebody gets by
  // trimming /yo/amala/pudding back, and 3,514 of the 4,343 spellings are like
  // this, so leaving them to 404 makes most of the second segment unusable.
  //
  // So it forwards. The canonical names the word's own page, which is the tag
  // that decides which of the two is the real one. No noindex: that would say
  // "nothing here worth having" while the canonical says "the content is over
  // there", and a crawler reading both has been told two different things.
  //
  // A redirect proper would be better and is not available - Cloudflare Pages
  // caps static redirects at 2,000 and there are 3,514 of these. The meta
  // refresh is what a static host can do; the visible link is what a reader
  // gets if it does not fire.
  const forwardSpelling = (spelling, entry) => {
    const urlPath = spellingPathFor(spelling);
    const target = entry.path;
    const word = (entry.canonicalForm || {}).value || spelling;
    const file =
      path.join(publicDir, `${urlPath.replace(/^\//, '')}.html`);
    const html = fill(template, {
      urlPath,
      head: [
        `<title>${escapeAttr(word)} — Sọ̀rọ̀ Sókè</title>`,
        `<link rel="canonical" href="${escapeAttr(ORIGIN + target)}" />`,
        `<meta http-equiv="refresh" content="0; url=${escapeAttr(target)}" />`,
      ].join('\n'),
      body:
        `<article class="entry"><p>One Yorùbá word is written ` +
        `<b lang="yo">${escapeAttr(spelling)}</b>: ` +
        `<a href="${escapeAttr(target)}" lang="yo">${escapeAttr(word)}</a>.</p></article>`,
    });
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, html);
    forwarded.push(urlPath);
  };

  // /yo/gba/ used to 404 - a directory with no index.html - and that was a wasted
  // URL, because nine different words are spelled gba and the list of them is
  // exactly what somebody truncating the address or searching "gba meaning"
  // wants. Only where there IS more than one: a page listing a single word says
  // nothing the word's own page does not, and would compete with it.
  let spellingPages = 0;
  for (const [spelling, members] of groupBySpelling(entries).groups) {
    const listed = members.map(({ entry }) => entry).filter((entry) => entry.path);
    if (listed.length === 0) continue;
    if (listed.length === 1) {
      forwardSpelling(spelling, listed[0]);
      continue;
    }
    const urlPath = spellingPathFor(spelling);
    spellingPages += 1;
    write(
      urlPath,
      fill(template, {
        urlPath,
        head: head({
          title: `${spelling} — ${listed.length} Yorùbá words — Sọ̀rọ̀ Sókè`,
          description:
            `${listed.length} different Yorùbá words are written ${spelling} once tone marks ` +
            `are removed: ${listed
              .map((entry) => (entry.canonicalForm || {}).value)
              .join(', ')}. Tone changes what a word means.`,
          canonical: ORIGIN + urlPath,
        }),
        body: spellingHtml(spelling, listed, renderer),
      })
    );
  }

  // The written pages last, so / overwrites the template we read from with the
  // welcome page. Safe in this order because the template is already in memory,
  // and safe next time because only what is between the markers changed.
  for (const page of pages.PAGES) {
    write(
      page.path,
      fill(template, {
        urlPath: page.path,
        head: head({
          title: page.title,
          description: page.description,
          canonical: page.path === '/' ? `${ORIGIN}/` : ORIGIN + page.path,
        }),
        // Called with no data: the building-block list and the contribute queue
        // are fetched on first visit, and what belongs in a file is the prose
        // around them, which is the part worth reading and the part that keeps.
        body: page.html(null),
      })
    );
  }

  const removed = removeStalePages(
    publicDir,
    new Set([...written.map((w) => w.path), ...forwarded])
  );

  // Cloudflare Pages serves this for any address that has no file, and serves
  // it with a real 404. Without it Pages falls back to index.html at status
  // 200, so every typo and every retired address answered as though it were a
  // page - a soft 404. That is worse than a missing page: a crawler is told the
  // front page exists at thousands of addresses, and the duplicates compete
  // with the real ones.
  //
  // Not in `written`, so it stays out of the sitemap. noindex because a 404
  // that gets indexed is the same problem wearing a different status code.
  writeFileSync(
    path.join(publicDir, '404.html'),
    fill(template, {
      urlPath: '/404',
      head: [
        '<title>No such page — Sọ̀rọ̀ Sókè</title>',
        '<meta name="robots" content="noindex" />',
      ].join('\n'),
      body:
        '<article class="entry">' +
        '<h1>No such page</h1>' +
        '<p>There is no word at this address. It may have been mistyped, or ' +
        'it may be a link to a word this dictionary does not have.</p>' +
        '<p><a href="/">Search the dictionary</a></p>' +
        '</article>',
    })
  );

  writeFileSync(
    path.join(publicDir, 'sitemap.xml'),
    sitemap(written.filter((w) => !unlisted.has(w.path)))
  );
  writeFileSync(
    path.join(publicDir, '_redirects'),
    redirectsFile([...pages.RETIRED_PAGES, ...redirects])
  );

  return {
    written,
    unlisted: unlisted.size,
    spellingPages,
    forwarded: forwarded.length,
    removed,
    bytes: written.reduce((n, w) => n + w.bytes, 0),
    redirects: redirects.length + pages.RETIRED_PAGES.length,
    // Reported rather than thrown, because who should care depends on the
    // corpus: against the real dictionary this is a broken page and must stop
    // the build, and against the 16-entry smoke fixture it is every link on
    // every page and means nothing. build/normalize.mjs decides.
    missingNamedWords: [...missingPageIds],
  };
}

/**
 * Delete pages from a previous build that this one did not write.
 *
 * Writing without deleting leaves a page at the old address forever. It is not
 * in the sitemap and nothing links to it, but it is still served, still
 * indexable, and still says it is the current page for that word - so a reader
 * who found it once keeps finding it, and the 301 that was supposed to move
 * them never fires because there is a real file in the way. Two of gbà's nine
 * addresses were already like this after a handful of builds.
 *
 * Deliberately narrow: only .html files, only ones this renderer would have
 * written, and never data/ or the two at the root that are not pages. Every
 * committed file is left alone - public/index.html is the only .html in git.
 */
function removeStalePages(publicDir, keep) {
  const removed = [];
  // Checked at every level, because a name can be both a page and a parent:
  // /yo/gba is gba.html AND a directory gba/ holding a file per word. Treating
  // "has children" as "is not a page" meant a stale spelling page could never be
  // reached by the cleanup.
  const walk = (dir, urlPath) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const child = path.join(dir, name);
      if (statSync(child).isDirectory()) {
        walk(child, `${urlPath}/${name}`);
        continue;
      }
      if (!name.endsWith('.html')) continue;
      // The two at the root that are not pages: index.html is the shell this
      // build read its own template from, and 404.html is deliberately not in
      // `written` because it must stay out of the sitemap.
      if (!urlPath && (name === 'index.html' || name === '404.html')) continue;
      const pagePath = `${urlPath}/${name.slice(0, -5)}`;
      if (keep.has(pagePath)) continue;
      rmSync(child);
      removed.push(pagePath);
    }

    if (urlPath && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
  };

  // The root is walked as a page directory in its own right, not just descended
  // into. /about is public/about.html now, a file at the top level, so a loop
  // that only recursed into subdirectories could never retire one of the seven
  // written pages. data/ is the one subtree held back - it is build output of a
  // different kind and holds no pages.
  const skip = new Set(['data']);
  const rootWalk = (dir, urlPath) => walk(dir, urlPath);
  for (const name of readdirSync(publicDir)) {
    if (skip.has(name) || name.startsWith('.')) continue;
    const child = path.join(publicDir, name);
    if (statSync(child).isDirectory()) rootWalk(child, `/${name}`);
  }
  // Then the root's own files, after its directories, so an emptied directory
  // is already gone before the root is considered.
  for (const name of readdirSync(publicDir)) {
    if (skip.has(name) || name.startsWith('.')) continue;
    const child = path.join(publicDir, name);
    if (statSync(child).isDirectory() || !name.endsWith('.html')) continue;
    if (name === 'index.html' || name === '404.html') continue;
    const pagePath = `/${name.slice(0, -5)}`;
    if (keep.has(pagePath)) continue;
    rmSync(child);
    removed.push(pagePath);
  }
  return removed;
}

/**
 * The words one spelling is shared by.
 *
 * Deliberately says what it is rather than pretending to be an entry: nothing
 * here invents a definition, a part of speech or an etymology. It reports that
 * several words are written this way once tone is removed, which is a fact about
 * Yorùbá orthography and the single most useful thing to tell someone who
 * arrived at a spelling rather than a word.
 */
function spellingHtml(spelling, entries, renderer) {
  const esc = renderer.escapeHtml;
  const rows = entries
    .map((entry) => {
      const first = (entry.senses || []).find((s) => (s.glosses || [])[0]);
      return `<a class="sibling-row" href="${esc(entry.path)}">
        <span class="sibling-word" lang="yo">${esc((entry.canonicalForm || {}).value || entry.headword)}</span>
        <span class="sibling-meta">${esc(entry.pos || '')}${
          entry.etymologyNumber ? ` · etym. ${esc(entry.etymologyNumber)}` : ''
        }</span>
        <span class="sibling-gloss">${esc(first ? first.glosses[0] : '')}</span>
      </a>`;
    })
    .join('');
  return `
      <div class="entry-header">
        <span class="entry-headword" lang="yo">${esc(spelling)}</span>
        <span class="entry-pos">${entries.length} words</span>
      </div>
      <div class="tone-rule divider" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="entry-section">
        <div class="entry-section-title">Words written this way</div>
        <p>${entries.length} different Yorùbá words are written <em>${esc(spelling)}</em> once
        tone marks and underdots are removed. Tone is part of the word, not decoration:
        these are as different from each other as any other words are.</p>
        <div class="sibling-list">${rows}</div>
      </div>
      <div class="entry-provenance-note">
        Source: Wiktionary. This page is not a dictionary entry — it lists the words
        written one way, and nothing else.
      </div>
    `;
}

function sitemap(written) {
  // Written pages first, then words. Order carries no weight to a crawler, but a
  // person opening this file should see the shape of the site before 6,273 rows.
  const ordered = [
    ...written.filter((w) => w.path.split('/').length < 3),
    ...written.filter((w) => w.path.split('/').length >= 3),
  ];
  const urls = ordered
    .map((w) => `  <url><loc>${escapeAttr(ORIGIN + (w.path === '/' ? '/' : w.path))}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function redirectsFile(redirects) {
  const header = [
    '# Cloudflare Pages redirects. Generated by build/lib/prerender.mjs - do not',
    '# hand-edit. Two sources: RETIRED_PAGES in public/page-render.js for the',
    '# written pages, and the `retired` list in data/url-slugs.json for words.',
    '#',
    '# One line per address that used to serve a page and no longer does, so a',
    '# link somebody already made keeps working. There is deliberately NO',
    '# catch-all rewrite: every real address has a real file, and a catch-all',
    '# would answer every typo with 200 and the app shell, which a crawler reads',
    '# as a page rather than as the mistake it is.',
    '#',
    '# Cloudflare Pages allows 2,000 static redirects here (its headline 2,100',
    '# includes 100 dynamic ones, which we do not use). One retired address is one',
    '# redirect, so changing more than ~32% of the 6,273 addresses after launch',
    '# exhausts the file. tools/slugs/check.py warns at 1,500.',
    '',
  ];
  if (!redirects.length) header.push('# No addresses have been retired yet.');
  return (
    header.join('\n') +
    '\n' +
    redirects.map((r) => `${r.from} ${r.to} 301`).join('\n') +
    (redirects.length ? '\n' : '')
  );
}
