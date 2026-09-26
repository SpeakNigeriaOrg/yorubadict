// build/lib/refresh-summary.mjs
//
// What a person needs to know after a refresh, in one short Markdown file:
// build/refresh-summary.md. The weekly workflow shows it on the run's page and
// posts it to a single GitHub issue while there is anything to do, so nobody
// has to read a build log - or remember to look - to find out the site is
// waiting on them. Two refreshes failed unnoticed for a fortnight before this.
//
// Written on success and on failure. A failure is a pause, not a crash: the
// build stops rather than move a page, and says what it needs.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SUMMARY_PATH = path.resolve(__dirname, '../refresh-summary.md');

const WEEKLY = [
  'To name them, on a checkout of `main` with the refreshed data pulled:',
  '',
  '```',
  'python3 tools/slugs/review.py -new      # writes tools/slugs/work/new.md',
  '#   edit the word: lines, set  reviewed: yes  at the top',
  'python3 tools/slugs/review.py -apply',
  'python3 tools/slugs/check.py',
  '```',
  '',
  'then commit `data/url-slugs.json`. Naming one costs nothing - it has never been in the sitemap.',
];

/**
 * @param {object} s
 * @param {'ok'|'paused'} s.status
 * @param {string} [s.release]   e.g. "build-17 (sourced 2026-09-21)"
 * @param {{from: string, to: string}[]} [s.moves]
 * @param {{address: string, spelling?: string, definition?: string}[]} [s.newcomers]
 * @param {string} [s.error]
 */
export function writeRefreshSummary({ status, release, moves = [], newcomers = [], error }) {
  const lines = [];
  if (status === 'paused') {
    lines.push(
      '## Refresh stopped',
      '',
      release ? `Release: ${release}` : '',
      '',
      'The site keeps serving the last good data until this is settled. If the',
      'message is about the address ledger, the stop is deliberate: the build will',
      'not change a live web address on its own. What it said:',
      '',
      '```',
      String(error || 'unknown error').trim(),
      '```',
      '',
      'See tools/slugs/README.md, "Weekly", for what each of these means.'
    );
  } else {
    lines.push(`## Refresh done${release ? ` - ${release}` : ''}`, '');
    if (moves.length) {
      lines.push(
        `**${moves.length} entries changed id upstream and kept their address.** Nothing to decide;`,
        'run `node tools/slugs/rekey.mjs` sometime to write it into the ledger.',
        ''
      );
    }
    if (newcomers.length) {
      lines.push(
        `**${newcomers.length} new words need a name.** Live now at a rule-made address, kept out of the sitemap:`,
        '',
        '| Word | Live at | Meaning |',
        '|---|---|---|',
        ...newcomers.map(
          (n) => `| ${n.spelling || '?'} | \`${n.address}\` | ${(n.definition || '').replace(/\|/g, '/').slice(0, 80)} |`
        ),
        '',
        ...WEEKLY
      );
    }
    if (!moves.length && !newcomers.length) lines.push('Nothing needs a person this week.');
  }
  // Read by the workflow to decide whether the issue stays open. Invisible once
  // rendered, and more reliable than grepping the prose.
  const needsPerson = status === 'paused' || newcomers.length > 0;
  lines.unshift(`<!-- needs-person: ${needsPerson ? 'yes' : 'no'} -->`);
  writeFileSync(SUMMARY_PATH, lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n') + '\n');
}
