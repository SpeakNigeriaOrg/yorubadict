// build/lib/parser.mjs
//
// Stage 1: Parser. Turns raw Kaikki JSONL into an array of raw JS objects.
// Deliberately does no interpretation of the data — that's the normalizer's
// job. This stage's only responsibility is: read lines, parse JSON, skip
// blank lines, report which lines failed to parse.

import { readFileSync } from 'node:fs';

export function parseJsonl(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const records = [];
  const errors = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      records.push(JSON.parse(trimmed));
    } catch (err) {
      errors.push({ line: i + 1, message: err.message });
    }
  });

  return { records, errors };
}
