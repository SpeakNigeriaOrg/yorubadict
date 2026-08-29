// tools/curriculum/find-units.mjs
//
//   node tools/curriculum/find-units.mjs          # the families, and what they share
//   node tools/curriculum/find-units.mjs --all    # every deep word, not just the shared ones
//
// Finds the raw material for a vocabulary unit: words that bottom out in three
// or more building blocks, and then share those blocks with each other.
//
// This is where the three families on the Language of Connections page came
// from. It is a research tool, not part of the build - it narrows 6,273 entries
// to a few dozen candidates, and which of those is worth a reader's time is a
// judgement. The chosen ones are written out by hand in public/page-render.js,
// and build/normalize.mjs fails the build if a word they name leaves the
// dictionary.
//
// Reads public/data/entries.json, so run a build first if the data is stale.
//
// WHY THREE PARTS, AND WHY SHARED
//
// A two-part compound teaches one join. ọmọ ilé ìwé - child of the house of
// books, a student - teaches two, because ilé-ìwé is itself ilé plus ìwé. Words
// like that are the ones worth building a unit around: three short words carry
// a long one, and the short ones are common enough to keep turning up.
//
// The shared part is what makes it a unit rather than a curiosity. ìmọ̀ ẹ̀dá-èdè
// (linguistics) and onímọ̀ ẹ̀dá-èdè (linguist) are three words each and two of
// the three are the same, so the pair teaches the difference between a subject
// and the person who studies it, for the price of one extra word.
//
// WHAT IS EXCLUDED, AND WHY
//
// - Parts the dictionary is not sure of. Yorùbá has many words spelled alike,
//   and where the source does not record which one a compound came from, we
//   show a first guess (see the Contribute page). A unit built on a guess
//   teaches the guess. Only chosenBy meaning/anchor/backLink, or a part with a
//   single candidate, is followed here.
// - Given names. About half the deep compounds in the dictionary are names, and
//   they are a good unit of their own - a Yorùbá name is usually a sentence -
//   but they crowd out everything else in a list like this.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entries = Object.values(
  JSON.parse(readFileSync(path.join(rootDir, 'public', 'data', 'entries.json'), 'utf8'))
);
const byId = new Map(entries.map((e) => [e.id, e]));

const SHOW_ALL = process.argv.includes('--all');
// How deep a word has to bottom out to be interesting, and how much two of them
// have to share before they are a family rather than a coincidence.
const MIN_PARTS = Number(process.env.PARTS || 3);
const MIN_SHARED = Number(process.env.SHARED || 2);

const CONFIDENT = new Set(['meaning', 'anchor', 'backLink', 'none']);

const definition = (e) => {
  for (const s of e.senses || []) if (s.glosses && s.glosses[0]) return s.glosses[0];
  return '';
};

const isName = (e) => e.pos === 'name' || /^[A-ZÀ-ÖØ-Þ]/.test(e.forms.exact);

/** The parts of one word, or null if the dictionary is not sure of them all. */
function partsOf(entry) {
  const morphemes = entry.etymologyMorphemes || [];
  if (morphemes.length < 2) return null;
  const out = [];
  for (const m of morphemes) {
    if (!m.resolved || !CONFIDENT.has(m.chosenBy || 'none')) return null;
    const id = m.chosenEntryId || (m.entryIds || [])[0];
    if (!id || !byId.has(id) || id === entry.id) return null;
    out.push(id);
  }
  return out;
}

/** The building blocks a word bottoms out in, following parts that are
 *  themselves compounds. `seen` guards against a word listed as its own
 *  ancestor, which the data does contain. */
function blocksOf(id, seen = new Set()) {
  if (seen.has(id)) return null;
  const parts = partsOf(byId.get(id));
  if (!parts) return [id];
  const deeper = new Set(seen).add(id);
  const out = [];
  for (const part of parts) {
    const sub = blocksOf(part, deeper);
    if (!sub) return null;
    out.push(...sub);
  }
  return out;
}

const deep = [];
for (const entry of entries) {
  if (isName(entry) || !partsOf(entry)) continue;
  const blocks = blocksOf(entry.id);
  if (!blocks) continue;
  const distinct = [...new Set(blocks)];
  if (distinct.length < MIN_PARTS || distinct.some((id) => isName(byId.get(id)))) continue;
  deep.push({ id: entry.id, form: entry.forms.exact, definition: definition(entry), blocks: distinct });
}

const spell = (id) => byId.get(id).forms.exact;
const show = (w) => `${w.form.padEnd(24)} ${w.definition.slice(0, 40).padEnd(40)} <= ${w.blocks.map(spell).join(' + ')}`;

if (SHOW_ALL) {
  console.log(`${deep.length} words that bottom out in ${MIN_PARTS} or more building blocks:\n`);
  for (const w of deep.sort((a, b) => a.blocks.length - b.blocks.length)) console.log(`  ${show(w)}`);
  console.log('');
}

// Families: deep words joined to each other by the blocks they share, gathered
// by walking the graph those links make.
const links = new Map(deep.map((w) => [w.id, new Set()]));
for (let i = 0; i < deep.length; i++) {
  for (let j = i + 1; j < deep.length; j++) {
    const common = deep[i].blocks.filter((b) => deep[j].blocks.includes(b));
    if (common.length < MIN_SHARED) continue;
    links.get(deep[i].id).add(deep[j].id);
    links.get(deep[j].id).add(deep[i].id);
  }
}

const families = [];
const placed = new Set();
for (const word of deep) {
  if (placed.has(word.id) || !links.get(word.id).size) continue;
  const members = [];
  const queue = [word.id];
  placed.add(word.id);
  while (queue.length) {
    const id = queue.shift();
    members.push(deep.find((w) => w.id === id));
    for (const next of links.get(id)) {
      if (placed.has(next)) continue;
      placed.add(next);
      queue.push(next);
    }
  }
  families.push(members);
}
families.sort((a, b) => b.length - a.length);

console.log(`${deep.length} words bottom out in ${MIN_PARTS}+ building blocks and are not names.`);
console.log(`${families.length} families, where members share ${MIN_SHARED}+ blocks with each other:\n`);
for (const members of families) {
  const shared = new Map();
  for (const w of members) for (const b of w.blocks) shared.set(b, (shared.get(b) || 0) + 1);
  const core = [...shared.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  console.log(`  === ${members.length} words, held together by ${core.map(([b, n]) => `${spell(b)} (${n}x)`).join(', ')}`);
  for (const w of members) console.log(`      ${show(w)}`);
  console.log('');
}
