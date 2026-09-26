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

/**
 * @param {object} s
 * @param {'ok'|'paused'} s.status
 * @param {string} [s.release]   e.g. "build-17 (sourced 2026-09-21)"
 * @param {object[]} [s.moves]      matched automatically (continuity.mjs)
 * @param {object[]} [s.newcomers]  no record yet: new, or a probable rename
 * @param {object[]} [s.drifted]    spelling changed, served at the old address
 * @param {object[]} [s.vanished]   entry gone, address redirected for now
 * @param {string} [s.error]
 */
export function writeRefreshSummary({ status, release, moves = [], newcomers = [], drifted = [], vanished = [], error }) {
  const lines = [];
  if (status === 'paused') {
    lines.push(
      '## Refresh stopped',
      '',
      release ? `Release: ${release}` : '',
      '',
      'The site keeps serving the last good data until this is settled. What it said:',
      '',
      '```',
      String(error || 'unknown error').trim(),
      '```'
    );
  } else {
    lines.push(`## Refresh done${release ? ` - ${release}` : ''}`, '');
    const probable = newcomers.filter((n) => (n.candidates || []).length);
    const fresh = newcomers.length - probable.length;
    const flagged = moves.filter((m) => m.meaningChanged).length;
    const rows = [
      [moves.length, 'kept their address under a new id (matched automatically)' + (flagged ? `, ${flagged} of them with a meaning change to look at` : '')],
      [probable.length, 'look like renames of a word that left, waiting for a yes'],
      [fresh, 'are new words, live at a rule-made address until named'],
      [vanished.length, 'addresses lost their word and redirect to its spelling for now'],
      [drifted.length, 'changed spelling, still served at the old address until confirmed'],
    ].filter(([n]) => n);
    if (rows.length) {
      lines.push('| | This week |', '|---:|---|', ...rows.map(([n, t]) => `| ${n} | ${t} |`), '');
      lines.push('All of it is live in a safe form. It is settled in the **Dictionary changes** pull request.');
    } else {
      lines.push('Nothing needs a person this week.');
    }
  }
  // Read by the workflow to decide whether the issue stays open. Invisible once
  // rendered, and more reliable than grepping the prose.
  const needsPerson =
    status === 'paused' || newcomers.length + drifted.length + vanished.length + moves.length > 0;
  lines.unshift(`<!-- needs-person: ${needsPerson ? 'yes' : 'no'} -->`);
  writeFileSync(SUMMARY_PATH, lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n') + '\n');
}
