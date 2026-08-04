// tools/wiktionary/lib/record.mjs
//
// What was actually sent, and what the server said came back.
//
// Records are committed. The point of them is that a month from now the
// question "did that edit do what we meant?" has an answer that does not
// depend on remembering, and that a reviewer on Wiktionary asking what this
// tool does can be shown every edit it has ever made.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RECORDS_DIR } from './config.mjs';

export function writeRecord(record) {
  mkdirSync(RECORDS_DIR, { recursive: true });
  const stamp = record.finishedAt.replace(/[:.]/g, '-');
  const slug = `${record.page.replace(/\//g, '∕')}-${record.job}-${stamp}`;
  const jsonPath = join(RECORDS_DIR, `${slug}.json`);
  const diffPath = join(RECORDS_DIR, `${slug}.diff`);
  writeFileSync(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(diffPath, `${record.realizedDiff}\n`);
  return { jsonPath, diffPath };
}
