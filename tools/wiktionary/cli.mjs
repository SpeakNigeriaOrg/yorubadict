#!/usr/bin/env node
// tools/wiktionary/cli.mjs
//
// One parent word at a time. There is no batch mode and no loop over pages -
// that is a property of this file, not a setting, and job two will not change
// it.
//
//   propose <page>    write the worksheet.                    reads Wiktionary
//   check   <page>    read the worksheet back.                no network
//   preview <page>    show the exact diff.                    reads Wiktionary
//   submit  <page>    send it, then record what happened.     WRITES, once, on
//                                                             a typed confirmation
//
// Only `submit` authenticates. Everything else is anonymous, and nothing but
// `submit` can change anything on Wiktionary.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { Wiki } from './lib/mediawiki.mjs';
import * as worksheet from './lib/worksheet.mjs';
import { unifiedDiff, changedLines } from './lib/diff.mjs';
import { writeRecord } from './lib/record.mjs';
import {
  loadData,
  findTask,
  loadCredentials,
  sandboxPageFor,
  workDirFor,
  CREDENTIALS_PATH,
} from './lib/config.mjs';
import * as etymid from './lib/jobs/etymid.mjs';

const JOBS = { etymid };

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    job: { type: 'string', default: 'etymid' },
    'target-page': { type: 'string' },
    regenerate: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});
const [command, page] = positionals;

const say = (s = '') => process.stdout.write(`${s}\n`);
const bail = (s) => {
  process.stderr.write(`\n  ${s}\n\n`);
  process.exit(1);
};

// ---------------------------------------------------------------------------

async function readLive(wiki, job, task, targetPage) {
  const located = await wiki.resolveLanguageSection(targetPage || task.page, job.language);
  const live = await wiki.fetchSection(located);
  return { located, live };
}

function worksheetPath(page) {
  return join(workDirFor(page), 'worksheet.md');
}

function loadWorksheet(page) {
  const path = worksheetPath(page);
  if (!existsSync(path)) {
    throw new Error(`No worksheet for "${page}". Run \`propose ${page}\` first.`);
  }
  return { path, parsed: worksheet.parse(readFileSync(path, 'utf8')) };
}

// Rebuild the items from live wikitext, then overlay the decisions from the
// worksheet. The worksheet is the record of what a person decided; it is never
// the record of what is on Wiktionary, which is re-read every time.
function itemsFromWorksheet(job, task, entriesByPage, sectionWikitext, parsed) {
  const collected = job.collect(task, entriesByPage.get(task.page) || [], sectionWikitext);
  const misplaced = [];
  const superseded = [];
  const items = collected.items.map((item) => {
    if (parsed.names.has(`!${item.number}`)) misplaced.push(item.number);
    const chosen = parsed.names.get(item.number);
    if (item.status !== 'proposed') {
      // The worksheet names an etymology that is no longer ours to name -
      // somebody added an anchor between propose and now. Dropping it is the
      // right outcome, but doing it silently would lose a decision without
      // saying so, and the name they chose may not be the one you would have.
      if (chosen && item.status === 'existing') {
        superseded.push({ number: item.number, wanted: chosen, actual: item.existingName });
      }
      return item;
    }
    return chosen === undefined ? item : { ...item, name: chosen };
  });
  return { ...collected, items, misplaced, superseded };
}

function reportGates(verdict, collected) {
  for (const note of verdict.notes) say(`  note      ${note}`);
  if (collected.misplaced?.length) {
    say(
      `  ignored   an id: line under Etymology ${collected.misplaced.join(', ')}, which is ` +
        `already named or has no data`
    );
  }
  for (const s of collected.superseded || []) {
    say(
      `  dropped   your name for Etymology ${s.number} ("${s.wanted}") - somebody named it ` +
        `"${s.actual}" on Wiktionary since the worksheet was written. Theirs stands.`
    );
  }
  if (!verdict.ok) {
    say('');
    for (const problem of verdict.problems) say(`  REFUSING  ${problem}`);
    bail('Nothing was sent.');
  }
}

// ---------------------------------------------------------------------------

async function propose(job, task, entriesByPage) {
  const wiki = new Wiki();
  const { located, live } = await readLive(wiki, job, task);
  say(`  ${task.page}: ${job.language} section is index ${located.index} on "${located.hostPage}"`);
  if (located.hostPage !== located.requestedPage) {
    say(`  note      that is a different page - this entry is split across subpages`);
  }

  let collected = job.collect(task, entriesByPage.get(task.page) || [], live.wikitext);

  const path = worksheetPath(task.page);
  if (existsSync(path)) {
    if (!flags.regenerate) {
      bail(
        `A worksheet already exists at ${path}.\n  ` +
          `Use --regenerate to refresh the reference material and keep your id: lines.`
      );
    }
    collected = worksheet.mergeDecisions(collected, worksheet.parse(readFileSync(path, 'utf8')));
    say('  kept the id: lines already in the worksheet');
  }

  // `check` promises to touch the network not at all, so it needs the wikitext
  // this run read. Kept beside the worksheet, and re-read rather than trusted
  // by anything that writes.
  writeFileSync(join(workDirFor(task.page), 'section.wikitext'), live.wikitext);

  writeFileSync(
    path,
    worksheet.render({
      page: task.page,
      hostPage: located.hostPage,
      sectionIndex: located.index,
      revid: live.revid,
      timestamp: live.timestamp,
      collected,
      summary: job.summary(collected.items),
    })
  );

  const counts = collected.items.reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }), {});
  say(
    `  ${collected.items.length} etymologies: ` +
      `${counts.proposed || 0} to name, ${counts.existing || 0} already named, ` +
      `${counts.unknown || 0} with no data`
  );
  if (!counts.proposed) {
    say('');
    say('  Nothing to write on this page. Every etymology already has a name.');
  }
  say('');
  say(`  ${path}`);
}

async function check(job, task, entriesByPage) {
  const { path, parsed } = loadWorksheet(task.page);
  const cached = join(workDirFor(task.page), 'section.wikitext');
  if (!existsSync(cached)) {
    // `check` promises no network, so it needs the wikitext propose already saw.
    // propose writes it for exactly this reason.
    bail(`No cached wikitext for "${task.page}". Run \`propose ${task.page}\` first.`);
  }
  const collected = itemsFromWorksheet(
    job,
    task,
    entriesByPage,
    readFileSync(cached, 'utf8'),
    parsed
  );

  say(`  ${path}`);
  say(`  header: page=${parsed.header.page} host=${parsed.header.host} ` +
      `section=${parsed.header.section} revision=${parsed.header.revision}`);
  say('');
  for (const item of collected.items) {
    const label =
      item.status === 'proposed'
        ? item.name
          ? `will write  {{etymid|${job.langCode}|${item.name}}}`
          : `skipped     (id: is blank)`
        : item.status === 'existing'
          ? `untouched   already named "${item.existingName}"`
          : `untouched   no data`;
    say(`  Etymology ${item.number.padEnd(2)}  ${label}`);
  }
  say('');
  const verdict = job.verify(readFileSync(cached, 'utf8'), collected.items);
  reportGates(verdict, collected);
  say(`  ${verdict.writableCount} name${verdict.writableCount === 1 ? '' : 's'} would be written. No network was used.`);
}

async function preview(job, task, entriesByPage, { targetPage } = {}) {
  const { parsed } = loadWorksheet(task.page);
  const wiki = new Wiki();
  const { located, live } = await readLive(wiki, job, task, targetPage);

  if (!targetPage && parsed.header.revision && String(live.revid) !== parsed.header.revision) {
    bail(
      `The page moved on. The worksheet was written against revision ${parsed.header.revision}, ` +
        `and the page is now at ${live.revid}.\n  ` +
        `Run \`propose ${task.page} --regenerate\` - etymology numbering can shift under you.`
    );
  }

  const collected = itemsFromWorksheet(job, task, entriesByPage, live.wikitext, parsed);
  const verdict = job.verify(live.wikitext, collected.items);
  reportGates(verdict, collected);

  const updated = job.apply(live.wikitext, collected.items);
  if (updated === live.wikitext) {
    const named = collected.items.filter((i) => i.status === 'existing').length;
    bail(
      named === collected.items.length
        ? `Nothing would change: all ${named} etymologies on "${task.page}" are already named. ` +
            `This page is in the queue because the words built from it do not point at those ` +
            `names yet, which is the next job.`
        : 'Nothing would change: every id: line in the worksheet is blank.'
    );
  }

  const local = unifiedDiff(live.wikitext, updated);
  const server = await wiki.unifiedDiff({ title: located.hostPage, from: live.wikitext, to: updated });

  const agree =
    JSON.stringify(changedLines(local)) === JSON.stringify(changedLines(server));
  say(`  page      ${located.hostPage}  section ${located.index}  revision ${live.revid}`);
  say(`  writing   ${verdict.writableCount} name${verdict.writableCount === 1 ? '' : 's'}`);
  say('');
  say(server || local);
  say('');
  say(`  local diff and server diff ${agree ? 'agree' : 'DISAGREE'}`);
  if (!agree) {
    say('');
    say('  --- ours ---');
    say(local);
    bail('Refusing to go further while the two diffs disagree.');
  }

  const dir = workDirFor(task.page);
  writeFileSync(join(dir, 'preview.diff'), `${server}\n`);
  writeFileSync(join(dir, 'proposed.wikitext'), updated);
  say(`  ${join(dir, 'preview.diff')}`);
  return { wiki, located, live, collected, verdict, updated, diff: server };
}

async function submit(job, task, entriesByPage) {
  const credentials = loadCredentials();
  const targetPage =
    flags['target-page'] === 'sandbox' ? sandboxPageFor(credentials) : flags['target-page'];
  const sandbox = Boolean(targetPage);

  say(sandbox ? `  TARGET    ${targetPage}  (rehearsal, not the real page)` : `  TARGET    ${task.page}  (LIVE on en.wiktionary.org)`);
  say('');
  const { wiki, located, live, collected, updated, diff } = await preview(job, task, entriesByPage, {
    targetPage,
  });

  const expected = located.hostPage;
  if (!flags.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = await rl.question(`\n  Type the page name to send this edit (${expected}): `);
    rl.close();
    if (typed.trim() !== expected) bail('Not sent.');
  }

  const startedAt = new Date().toISOString();
  await wiki.login(credentials);
  say(`  logged in as ${wiki.username}`);

  const result = await wiki.edit({
    title: located.hostPage,
    section: located.index,
    text: updated,
    summary: job.summary(collected.items),
    baserevid: live.revid,
    starttimestamp: startedAt,
  });
  say(`  edit landed: revision ${result.oldrevid} -> ${result.newrevid}`);

  const realizedDiff = await wiki.revisionDiff({ fromrev: result.oldrevid, torev: result.newrevid });
  const matches = JSON.stringify(changedLines(diff)) === JSON.stringify(changedLines(realizedDiff));

  const written = writeRecord({
    job: job.name,
    page: task.page,
    hostPage: located.hostPage,
    section: located.index,
    sandbox,
    startedAt,
    finishedAt: new Date().toISOString(),
    account: wiki.username,
    summary: job.summary(collected.items),
    names: collected.items
      .filter((i) => i.status === 'proposed' && i.name)
      .map((i) => ({ etymology: i.number, name: i.name })),
    oldrevid: result.oldrevid,
    newrevid: result.newrevid,
    previewDiff: diff,
    realizedDiff,
    realizedMatchesPreview: matches,
  });

  say('');
  say(realizedDiff);
  say('');
  say(`  what landed ${matches ? 'matches' : 'DOES NOT MATCH'} what was previewed`);
  say(`  ${written.jsonPath}`);
  say(`  https://en.wiktionary.org/w/index.php?diff=${result.newrevid}`);
  if (!matches) bail('The recorded diff differs from the preview. Check the page by hand.');
}

// ---------------------------------------------------------------------------

const COMMANDS = { propose, check, preview, submit };

if (!command || !page || !COMMANDS[command]) {
  say('');
  say('  node tools/wiktionary/cli.mjs <command> <page> [flags]');
  say('');
  say('    propose <page>              write the worksheet');
  say('    check   <page>              read it back - no network');
  say('    preview <page>              show the exact diff - no write');
  say('    submit  <page>              send it, then record what happened');
  say('');
  say('    --regenerate                refresh a worksheet, keeping your id: lines');
  say('    --target-page sandbox       rehearse against User:<you>/sandbox');
  say('    --job etymid                which job (only etymid so far)');
  say('');
  process.exit(command ? 1 : 0);
}

const job = JOBS[flags.job];
if (!job) bail(`No job called "${flags.job}". Available: ${Object.keys(JOBS).join(', ')}`);

try {
  const { tasks, entriesByPage } = loadData();
  const task = findTask(tasks, page);
  say('');
  await COMMANDS[command](job, task, entriesByPage);
  say('');
} catch (error) {
  bail(error.message);
}
