#!/usr/bin/env node
// build/print-address-groups.mjs
//
// Prints the entries of the dictionary grouped by the first segment of their
// web address, as JSON on stdout, for tools/slugs to read.
//
// This exists so that build/lib/address.mjs stays the only thing in the project
// that decides where a page lives. The alternative was a copy of the folding
// rule in Python, and the two would have had to agree exactly and forever - a
// disagreement would not fail, it would quietly file a word at an address the
// site never serves.
//
// Usage:
//   node build/print-address-groups.mjs [path/to/entries.json]
//
// Defaults to public/data/entries.json.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { groupBySpelling, wordFromDefinition } from './lib/address.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entriesPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '../public/data/entries.json');

const entries = Object.values(JSON.parse(readFileSync(entriesPath, 'utf8')));
const { groups, unresolved } = groupBySpelling(entries);

// The reviewer needs the whole definition of every sense, not the first: you
// cannot choose between "to receive" and "to sweep" for gbà without seeing that
// gbà also covers "to accept" and "to agree". Same reason
// tools/wiktionary/lib/data.py's definitions_for takes every sense.
const definitionsOf = (entry) => {
  const out = [];
  for (const sense of entry.senses || []) {
    const gloss = (sense.glosses || [])[0];
    if (gloss && !out.includes(gloss)) out.push(gloss);
  }
  return out;
};

const payload = {
  generatedAt: new Date().toISOString(),
  source: path.relative(path.resolve(__dirname, '..'), entriesPath),
  totals: {
    groups: groups.size,
    entries: entries.length,
    unresolved: unresolved.length,
  },
  groups: [...groups.entries()].map(([spelling, members]) => ({
    spelling,
    entries: members.map(({ entry, proposedWord, kind }) => ({
      id: entry.id,
      // The spelling as written, tone and all. The address dropped it; a person
      // choosing a word must still see it, because it is what the word is for.
      written: (entry.canonicalForm || {}).value || entry.headword,
      headword: entry.headword,
      pos: entry.pos || null,
      etymologyNumber: entry.etymologyNumber ?? null,
      kind,
      // Non-null means the address is already settled by rule and nobody needs
      // to be asked - see build/lib/address.mjs.
      derivedWord: proposedWord,
      // What the rule alone would say. The floor an address falls back to, so
      // the build always has one, and the baseline a proposal is judged against.
      ruleWord: wordFromDefinition(definitionsOf(entry)[0] || ''),
      definitions: definitionsOf(entry),
    })),
  })),
  unresolved: unresolved.map((entry) => ({
    id: entry.id,
    written: (entry.canonicalForm || {}).value || entry.headword,
    pos: entry.pos || null,
  })),
};

process.stdout.write(JSON.stringify(payload));
