// Copy the shared analytics files into the other two repos.
//
// None of the three sites has a build step, so without this they drift: a fix
// to the consent logic lands on one site and quietly does not land on the other
// two. ANALYTICS.md §1 records the same lesson about the Cloudflare beacon -
// configuration that lives in one place and is invisible from the others.
//
//   node analytics/copy-to-siblings.mjs           # copy
//   node analytics/copy-to-siblings.mjs --check   # verify, exit 1 on drift
//
// --check is the CI-shaped form: it changes nothing and fails if any copy is
// out of date, so a stale copy is caught rather than discovered.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// The files that must be identical everywhere. events.schema.json is included
// deliberately: it is the contract between the three repos, and a repo working
// from an old copy is how one site starts emitting level_id where the others
// emit levelId.
const SHARED = ['consent.js', 'track.js', 'page-events.js', 'events.schema.json'];

// Where each sibling wants them. Both serve from a directory that deploys, so
// the path is part of the site, not of its tooling.
const TARGETS = [
  { name: 'website', dir: resolve(REPO, '..', 'website', 'assets', 'analytics') },
  { name: 'website-games', dir: resolve(REPO, '..', 'website-games', 'public', 'analytics') }
];

const check = process.argv.includes('--check');

let drifted = 0;
let copied = 0;
let missing = 0;

for (const target of TARGETS) {
  const parent = resolve(target.dir, '..');
  if (!existsSync(parent)) {
    console.error(`  ${target.name}: ${parent} does not exist - is the repo checked out?`);
    missing++;
    continue;
  }
  if (!check && !existsSync(target.dir)) mkdirSync(target.dir, { recursive: true });

  for (const file of SHARED) {
    const from = join(HERE, file);
    const to = join(target.dir, file);
    const source = readFileSync(from, 'utf8');

    if (check) {
      const current = existsSync(to) ? readFileSync(to, 'utf8') : null;
      if (current !== source) {
        console.error(`  DRIFT  ${target.name}/${file}${current === null ? ' (missing)' : ''}`);
        drifted++;
      }
      continue;
    }

    writeFileSync(to, source);
    console.log(`  copied ${file} -> ${target.name}`);
    copied++;
  }
}

if (missing) {
  console.error(`\n${missing} repo(s) not found. Nothing was written.`);
  process.exit(1);
}

if (check) {
  if (drifted) {
    console.error(`\n${drifted} file(s) out of date. Run: node analytics/copy-to-siblings.mjs`);
    process.exit(1);
  }
  console.log('All shared analytics files are identical across the three repos.');
} else {
  console.log(`\n${copied} file(s) copied. Commit them in each repo.`);
}
