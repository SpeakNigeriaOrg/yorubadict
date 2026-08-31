#!/usr/bin/env node
// build/normalize.mjs
//
// Build pipeline orchestrator:
//   kaikki-yoruba's canonical artifact -> Relationship Synthesis
//   -> Validation -> Search Index Builder -> Static Browser Assets
//
// Parsing raw Kaikki JSONL and normalizing it into canonical entries used
// to happen here - that's now kaikki-yoruba's job (shared with
// yoruba_student_dict_platform), including etymology-morpheme extraction
// and resolution (etymologyMorphemes/usedInCompounds arrive already
// resolved). What stays here - resolving derivedTerms/relatedTerms/
// synonyms/antonyms/descendants, validation reporting, and search-index
// building - is yorubadict-specific, not shared.
//
// Usage:
//   node build/normalize.mjs                       fetch kaikki-yoruba's
//                                                    latest GitHub Release
//   node build/normalize.mjs path/to/entries.json   use a local snapshot
//                                                    instead (offline dev,
//                                                    or data/sample.entries.json
//                                                    for the smoke-test
//                                                    fixture)
//
// Writes:
//   public/data/entries.json
//   public/data/search-index.json
//   build/validation-report.json
//   public/yo/<spelling>/<word>/index.html   one per entry, 6,273 of them
//   public/yo/<spelling>/index.html           the words sharing a spelling
//   public/sitemap.xml, public/_redirects

import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadEntriesFromFile, loadLatestEntriesAndMetadata } from './lib/loadEntries.mjs';
import { synthesizeRelationships } from './lib/relationships.mjs';
import { buildValidationReport } from './lib/validator.mjs';
import { buildSearchIndex } from './lib/search-index.mjs';
import { buildBuildingBlocks, assertBuildingBlocksAreUsable } from './lib/building-blocks.mjs';
import { buildWiktionaryTasks } from './lib/wiktionary-tasks.mjs';
import { buildMentionedWords } from './lib/mentioned-words.mjs';
import { attachAddresses } from './lib/slugs.mjs';
import { prerender } from './lib/prerender.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const inputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : null;

// Fields the browser never reads. Every one was checked against public/app.js
// before being listed here, and dropping them takes entries.json from 896 KB
// to 736 KB brotli - an 18% cut, and the largest safe one available. Encoding
// the file differently is not: measured over the whole corpus, removing every
// key name (positional arrays) and interning the repeated vocabularies saves
// 26 KB more, because brotli's context modelling already collapses exactly
// the repetition that makes JSON look wasteful. What ships matters; how it's
// spelled does not.
//
// This trims only the browser artifact. kaikki-yoruba's release keeps
// everything, and so does `linkedEntries` in memory - which matters, because
// buildValidationReport reads etymologyTemplates for the root-meaning-dropped
// check and buildSearchIndex reads the senses. Both run before this point;
// keep it that way.
const BROWSER_OMITS_ENTRY = new Set([
  'etymologyTemplates', // read only by build/lib/validator.mjs, at build time
  'provenance', // source file and line number - a build-time breadcrumb
  'langCode', // 'yo' on all 6,272 of them
]);
const BROWSER_OMITS_SENSE = new Set([
  // Same string as the matching gloss with a grammar-tag prefix. Nothing renders it, and since the
  // measurement written up in search-index.mjs nothing indexes it either - so at this point no code
  // in this repo reads it. kaikki-yoruba's release still carries it, which is where it belongs.
  'rawGlosses',
  'links', // bare strings, never turned into links
  'altOf', // nothing renders alt-of; see the data-quality report instead
]);

// Sense-level relation lists all render, so none of them can be dropped - but
// kaikki-yoruba emits all seven on every sense whether or not there is anything
// in them, because the canonical artifact is a contract and a consumer should not
// need a guard to read `sense.synonyms.length`. Here size is what matters, and
// only 3,655 of 8,162 senses carry any relation at all, so the empty ones are
// 45,000-odd bare arrays. Dropping them saves 12.6 KB brotli and 835 KB of raw
// parse work on first load.
//
// Trimming the ITEMS was measured and rejected. Dropping roman/lang/langCode/type
// and the null englishes recovers 7.2 KB of the 93.5 KB the lists add - 8% - in
// exchange for an item shape relationPillsHtml would have to special-case. Same
// result the note above records for key names generally: brotli already collapses
// exactly the repetition that makes JSON look wasteful.
const BROWSER_OMITS_SENSE_WHEN_EMPTY = new Set([
  'synonyms', 'antonyms', 'derivedTerms', 'relatedTerms',
  'coordinateTerms', 'hyponyms', 'hypernyms',
]);

function forBrowser(entry) {
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (BROWSER_OMITS_ENTRY.has(key)) continue;
    if (BROWSER_OMITS_SENSE_WHEN_EMPTY.has(key) && Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  out.senses = (entry.senses || []).map((sense) => {
    const s = {};
    for (const [key, value] of Object.entries(sense)) {
      if (BROWSER_OMITS_SENSE.has(key)) continue;
      if (BROWSER_OMITS_SENSE_WHEN_EMPTY.has(key) && Array.isArray(value) && value.length === 0) continue;
      s[key] = value;
    }
    return s;
  });
  return out;
}

// What the two first-load artifacts are allowed to weigh, compressed the way a
// host actually serves them. Both are fetched before the dictionary is usable, so
// this is the number that decides how the site feels on a slow connection - and
// it is invisible from the raw byte count, which is why it gets an assertion
// rather than a log line. Failing the build is the same choice
// assertBuildingBlocksAreUsable makes: better than shipping it and finding out.
//
// entries.json measures 883 KB, up from 759 KB before sense-level relations - a
// 125 KB rise, 16%, for 9,344 relation items on 3,337 entries where the artifact
// previously carried 2 synonyms and no antonyms at all. Trimming the items was
// measured rather than assumed: dropping every null english/lang/langCode/roman
// and the constant `type` removes 59,135 keys and saves 11.7 KB, and dropping the
// homograph `resolution` saves 2.4 more. 14 KB for a shape relationPillsHtml
// would have to special-case is not a trade worth making, and it is the same
// answer the note above records for key names generally.
//
// Raise these only with a note saying what was added and what it bought.
// search-index.json rises from 489 KB to about 537 KB for two additions, both measured before
// they were written: the sorted list of the 8,916 English tokens (+23 KB), without which a
// partially-typed English word matches nothing at all, and one document per entry carrying the
// English word its address is named after (+26 KB), which reaches 24 more entries across the 400
// most common definition clauses. Set at 650 to leave the same kind of headroom the number it
// replaced had.
const MAX_BROTLI_KB = { 'entries.json': 950, 'search-index.json': 650 };

// Three documented search features are built entirely from sense-level relation lists: the
// synonym tier, inherited English meanings, and mentioned-words.json. If the upstream release
// stops carrying them, all three build to nothing - and every one of them fails SILENTLY,
// because an empty tier is a valid tier and an index with no inherited documents is a valid
// index. The site then ships with `yan`, `jona` and `venom` returning nothing while the README
// describes at length how they work.
//
// That is not hypothetical: it is what shipped. kaikki-yoruba's sense-level relation work sat on
// an unmerged branch, so no release ever carried it, and the whole feature was dark in production
// for as long as the README claimed it worked. Nothing anywhere said so.
//
// A floor rather than an exact count, for the same reason the entry-count check is a floor:
// Wiktionary gains and loses relations every week and only zero means something is broken.
function assertSenseRelationsArePresent(searchIndex) {
  const items = (searchIndex.synonymReport || {}).items || 0;
  if (items > 0) return;
  throw new Error(
    'The upstream release carries no sense-level relation lists, so the synonym tier, ' +
      'inherited English meanings and mentioned-words.json all built to nothing. ' +
      'Searching a word only named as a synonym will return nothing at all. ' +
      'Check that kaikki-yoruba\'s latest release includes sense.synonyms - the entries.json ' +
      'asset should have relation lists on its senses, not just on its entries.'
  );
}

function assertShippedSizes(paths) {
  for (const p of paths) {
    const name = path.basename(p);
    const limit = MAX_BROTLI_KB[name];
    if (!limit) continue;
    const compressed = brotliCompressSync(readFileSync(p), {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    const kb = compressed.length / 1024;
    if (kb > limit) {
      throw new Error(
        `${name} is ${kb.toFixed(1)} KB brotli, over its ${limit} KB budget. ` +
          `It is fetched on first load, so this is what a slow connection pays. ` +
          `Either trim what was just added, or raise MAX_BROTLI_KB in build/normalize.mjs ` +
          `with a note on what the extra weight buys.`
      );
    }
    console.log(`      ${name} ${kb.toFixed(1)} KB brotli (budget ${limit} KB)`);
  }
}

const outEntriesPath = path.join(rootDir, 'public', 'data', 'entries.json');
const outIndexPath = path.join(rootDir, 'public', 'data', 'search-index.json');
const outValidationPath = path.join(rootDir, 'build', 'validation-report.json');
const outPublicValidationPath = path.join(rootDir, 'public', 'data', 'validation-report.json');
const outBlocksPath = path.join(rootDir, 'public', 'data', 'building-blocks.json');
const outTasksPath = path.join(rootDir, 'public', 'data', 'wiktionary-tasks.json');
const outMentionedPath = path.join(rootDir, 'public', 'data', 'mentioned-words.json');

const blockOptions = {
  yorubaFrequencyPath: path.join(rootDir, 'data', 'frequency', 'yoruba.json'),
  englishFrequencyPath: path.join(rootDir, 'data', 'frequency', 'english.json'),
  overridesPath: path.join(rootDir, 'data', 'building-blocks.overrides.json'),
};

async function main() {
  let entriesById, kaikkiSourceDate, kaikkiReleaseTag, kaikkiParseErrorCount;
  if (inputPath) {
    console.log(`[1/5] Loading ${path.relative(rootDir, inputPath)} ...`);
    entriesById = await loadEntriesFromFile(inputPath);
    kaikkiSourceDate = null;
    kaikkiReleaseTag = null;
    kaikkiParseErrorCount = null;
  } else {
    console.log("[1/5] Fetching kaikki-yoruba's latest release ...");
    const fetched = await loadLatestEntriesAndMetadata();
    entriesById = fetched.entries;
    kaikkiSourceDate = fetched.metadata.sourceDate;
    kaikkiReleaseTag = fetched.tagName;
    kaikkiParseErrorCount = fetched.metadata.parseErrorCount;
  }
  const entries = Object.values(entriesById);
  console.log(`      ${entries.length} entries loaded`);

  console.log('[2/5] Synthesizing relationship graph ...');
  const { entries: linkedEntries, unresolved, dialect, anchorTable, danglingAnchors } =
    synthesizeRelationships(entries);
  console.log(
    `      dialect data on ${dialect.entriesWithData} entries: ${dialect.terms} terms ` +
      `(${dialect.distinctTerms} distinct, ${dialect.resolvedTerms} matching an existing entry)`
  );

  console.log('[3/5] Building validation report ...');
  // Addresses first, because entry.path travels with the browser artifact: the
  // app reads it to build every internal link, and a second file to fetch and
  // keep in step would be one more thing that can disagree with the pages on
  // disk. See build/lib/slugs.mjs for what it will and will not guess.
  const { redirects, stats, provisional, newcomers } = attachAddresses(linkedEntries);
  console.log(
    `      ${stats.total} addresses, ${stats.approved} checked by hand, ` +
      `${stats.provisional} still placeholders, ${redirects.length} retired`
  );
  if (newcomers.length) {
    // Loud, because these are the only addresses on the site nobody has read.
    // They are served and deliberately absent from the sitemap, so nothing is
    // broken by naming them late - but they keep the rule's guess until then.
    console.log(
      `      ${newcomers.length} new since the ledger was written, named by rule and ` +
        `kept out of the sitemap:`
    );
    for (const n of newcomers.slice(0, 10)) {
      console.log(`        ${n.address}  (${n.source}, ${n.spelling || '?'})`);
    }
    if (newcomers.length > 10) console.log(`        ...and ${newcomers.length - 10} more`);
    console.log('        Name them:  python3 tools/slugs/seed.py && python3 tools/slugs/review.py');
  }

  const validationReport = buildValidationReport(
    linkedEntries,
    unresolved,
    [],
    dialect,
    danglingAnchors,
    // Moved above the report rather than passed backwards into it: an entry
    // with an address nobody has read is a thing needing a person, which is
    // what this report is for.
    newcomers
  );
  validationReport.kaikkiSourceDate = kaikkiSourceDate;
  validationReport.kaikkiReleaseTag = kaikkiReleaseTag;
  validationReport.kaikkiParseErrorCount = kaikkiParseErrorCount;

  // Before the search index, which carries the spellings so a pill can become a
  // link and a search can offer a landing page without waiting for a fetch.
  const mentioned = buildMentionedWords(linkedEntries);
  console.log(
    `      ${mentioned.totals.words} words named as a similar word by 2+ entries ` +
      `(${mentioned.totals.mentions} mentions; ${mentioned.totals.namedOnce} more named only once, left out)`
  );

  console.log('[4/5] Building search index ...');
  const searchIndex = buildSearchIndex(linkedEntries, mentioned.words);
  assertSenseRelationsArePresent(searchIndex);

  console.log('[5/5] Choosing building-block words ...');
  const buildingBlocks = buildBuildingBlocks(linkedEntries, blockOptions);
  // Throws rather than shipping a list with a given name or an encyclopedic
  // definition in it - the whole point of the page is that its examples are
  // words a learner would plausibly meet.
  assertBuildingBlocksAreUsable(buildingBlocks);
  console.log(
    `      ${buildingBlocks.blocks.length} blocks, ` +
      `${buildingBlocks.blocks.reduce((n, b) => n + b.examples.length, 0)} examples` +
      `${buildingBlocks.overridesApplied ? ' (overrides applied)' : ''}`
  );

  const tasks = buildWiktionaryTasks(linkedEntries, anchorTable);
  console.log(
    `      ${tasks.totals.references} ambiguous references across ` +
      `${tasks.totals.pagesNeedingAnchors} pages ` +
      `(${JSON.stringify(tasks.totals.byTier)}), ${danglingAnchors.length} dangling anchors`
  );

  mkdirSync(path.dirname(outEntriesPath), { recursive: true });
  mkdirSync(path.dirname(outValidationPath), { recursive: true });

  // Entries are shipped to the browser as an id-keyed object for O(1) lookup.
  const linkedEntriesById = Object.fromEntries(
    linkedEntries.map((e) => [e.id, forBrowser(e)])
  );

  writeFileSync(outEntriesPath, JSON.stringify(linkedEntriesById));
  writeFileSync(outIndexPath, JSON.stringify(searchIndex));
  writeFileSync(outValidationPath, JSON.stringify(validationReport, null, 2));
  writeFileSync(outPublicValidationPath, JSON.stringify(validationReport));
  writeFileSync(outBlocksPath, JSON.stringify(buildingBlocks));
  writeFileSync(outTasksPath, JSON.stringify(tasks));
  writeFileSync(outMentionedPath, JSON.stringify(mentioned));

  // The stamp public/sw.js names its cache after. It has to change whenever any
  // shipped file changes, because nothing here is fingerprinted and a service
  // worker is a cache with no expiry - the mixed-set problem public/_headers
  // exists to prevent, with the volume turned up. The source release plus the
  // build time is enough: a rebuild always moves it, and a redeploy of the same
  // build always moves it too, which is the safe direction to err in.
  const buildStamp = `${kaikkiReleaseTag || 'local'}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  writeFileSync(
    path.join(path.dirname(outEntriesPath), 'version.json'),
    JSON.stringify({
      build: buildStamp,
      kaikkiReleaseTag: kaikkiReleaseTag || null,
      kaikkiSourceDate: kaikkiSourceDate || null,
      entries: linkedEntries.length,
    })
  );

  // A real HTML file per word. This is what makes the dictionary readable
  // without JavaScript, and therefore findable at all - see build/lib/prerender.mjs.
  const pages = prerender(linkedEntries, { redirects, provisional });
  if (pages.missingNamedWords.length) {
    const lines = pages.missingNamedWords.join('\n  ');
    const complaint =
      `${pages.missingNamedWords.length} word(s) named by hand in public/page-render.js are ` +
      `not in this dictionary:\n  ${lines}\n` +
      'Either the entry has gone or its id has changed. Fix the page text: the link points ' +
      'at the front page, and the sentence around it still promises a word.';
    // Only fatal on the real build. Building from a local file is either a
    // pinned snapshot, where this would have fired anyway, or the 16-entry
    // smoke fixture, where every word on every page is missing by design.
    if (!inputPath) throw new Error(complaint);
    console.log(`      note: ${complaint.split('\n')[0]} (not fatal for a local snapshot)`);
  }
  console.log(
    `      ${pages.written.length} pages, ${(pages.bytes / 1024 / 1024).toFixed(1)} MB, ` +
      `sitemap.xml, _redirects (${pages.redirects})` +
      (pages.removed.length ? `, ${pages.removed.length} stale pages removed` : '')
  );

  const sizeOf = (p) => (statSync(p).size / 1024).toFixed(1);
  assertShippedSizes([outEntriesPath, outIndexPath]);

  console.log('\nDone.');
  console.log(`  entries.json size  ${sizeOf(outEntriesPath)} KB`);
  console.log(`  search-index size  ${sizeOf(outIndexPath)} KB`);
  console.log(`  building-blocks    ${sizeOf(outBlocksPath)} KB`);
  console.log(`  wiktionary-tasks   ${sizeOf(outTasksPath)} KB`);
  console.log(`  mentioned-words    ${sizeOf(outMentionedPath)} KB`);
  console.log(`  entries.json       ${linkedEntries.length} entries`);
  console.log(`  search-index.json  ${Object.keys(searchIndex.english.postings).length} English tokens`);
  if (kaikkiSourceDate) console.log(`  kaikki-yoruba data  release ${kaikkiReleaseTag}, sourced ${kaikkiSourceDate}`);

  console.log(`\nData quality: ${validationReport.summary.actionable} actionable items, ` +
    `${validationReport.summary.easyWins} of them easy wins.`);
  for (const issue of validationReport.issues) {
    console.log(
      `  ${issue.effort.padEnd(10)} ${issue.target.padEnd(10)} ` +
        `${String(issue.count).padStart(5)} on ${String(issue.pageCount).padStart(4)} pages  ${issue.title}`
    );
  }
}

main().catch((err) => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
