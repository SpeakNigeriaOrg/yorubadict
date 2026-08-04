// tools/wiktionary/lib/config.mjs
//
// Paths, data loading, and credentials.
//
// Credentials are read from one gitignored file and never from the command
// line, so they cannot end up in a shell history or a process listing.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const REPO_DIR = dirname(dirname(TOOL_DIR));
export const WORK_DIR = join(TOOL_DIR, 'work');
export const RECORDS_DIR = join(TOOL_DIR, 'records');
export const CREDENTIALS_PATH = join(TOOL_DIR, '.credentials.json');

export function workDirFor(page) {
  // Page titles contain characters that are legal in a filename but tedious
  // (a slash makes a subdirectory). Only the slash actually needs handling.
  const dir = join(WORK_DIR, page.replace(/\//g, '∕'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadData() {
  const tasksPath = join(REPO_DIR, 'public/data/wiktionary-tasks.json');
  const entriesPath = join(REPO_DIR, 'public/data/entries.json');
  for (const path of [tasksPath, entriesPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${path}. Run \`npm run build\` first.`);
    }
  }
  const tasks = JSON.parse(readFileSync(tasksPath, 'utf8'));
  const entries = JSON.parse(readFileSync(entriesPath, 'utf8'));
  const byPage = new Map();
  for (const entry of Object.values(entries)) {
    if (!byPage.has(entry.headword)) byPage.set(entry.headword, []);
    byPage.get(entry.headword).push(entry);
  }
  return { tasks, entriesByPage: byPage };
}

export function findTask(tasks, page) {
  const task = tasks.pages.find((p) => p.page === page);
  if (task) return task;
  const near = tasks.pages
    .map((p) => p.page)
    .filter((p) => p.normalize('NFD').replace(/[̀-ͯ]/g, '') === page.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  throw new Error(
    `"${page}" is not in the work queue.` +
      (near.length ? ` Did you mean ${near.map((n) => `"${n}"`).join(' or ')}?` : '') +
      `\nThe queue holds the ${tasks.pages.length} pages where a word points at an ambiguous spelling.`
  );
}

export function loadCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `No credentials at ${CREDENTIALS_PATH}.\n` +
        `See tools/wiktionary/README.md - it takes about a minute at Special:BotPasswords.`
    );
  }
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  if (!credentials.username || !credentials.password) {
    throw new Error(`${CREDENTIALS_PATH} needs both "username" and "password".`);
  }
  if (!credentials.username.includes('@')) {
    throw new Error(
      `"${credentials.username}" is an account name, not a bot password name. ` +
        `Special:BotPasswords issues one that looks like "YourName@yorubadict".`
    );
  }
  return credentials;
}

// The sandbox target is derived from the bot password name rather than
// configured separately, so it cannot drift from the account actually editing.
export function sandboxPageFor(credentials) {
  return `User:${credentials.username.split('@')[0]}/sandbox`;
}
