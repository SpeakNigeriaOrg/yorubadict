// build/lib/building-blocks.mjs
//
// Stage 5: the Key Building Block Words list — the roots that build the most
// other words, each with a few examples of what they build.
//
// Yorùbá rewards learning roots. Someone who knows ilé ("home") and ayé
// ("life") can read ilé ayé ("Earth") the first time they meet it, and every
// further root multiplies what they can decompose. This produces the list of
// roots worth learning first, and it is generated rather than written so it
// reflects the dictionary as it actually is.
//
// Two things this gets right that a first attempt would not:
//
// 1. A building block is a MEANING, not a spelling. "gba" is not a word; gbá
//    ("to hit") and gbà ("to accept") are different words that happen to share
//    letters. So blocks are keyed on entry ids via etymologyMorphemes[]
//    .chosenEntryId, which relationships.mjs resolved to a single entry. NOT on
//    the rendered usedInCompounds/possiblyUsedIn pair: the second of those
//    deliberately lists an uncertain compound under every homograph it might
//    belong to, so counting it would credit gbà "to rescue" for words built
//    from gbà "to accept". A count has to commit to one answer even where the
//    display refuses to.
//
// 2. Picking examples needs outside data. Every signal available inside the
//    corpus - sense count, usage examples, IPA, dialect coverage - measures
//    editor attention, which follows cultural notability rather than
//    commonness. Ranked on those, ọmọ ("child") is exemplified by agẹmọ
//    (chameleon), ọmọdó (pestle) and Agẹmọ (an orisha). See
//    data/frequency/README.md.

import { readFileSync, existsSync } from 'node:fs';

const HOW_MANY_BLOCKS = 25;
const EXAMPLES_PER_BLOCK = 5;

// Below this, the Leipzig Wikipedia counts stop being about the language and
// start being about Wikipedia - at 1 to 4 occurrences the list is monarch
// titles and orisha names. Above it, the ordering is genuinely useful.
const TRUSTWORTHY_COUNT = 5;

// A definition that runs longer than this is describing a particular thing
// rather than naming a concept, and is not what a learner needs first.
const MAX_DEFINITION_WORDS = 6;

// "ọ̀rọ̀ àìbófin-ilé-ìgbìmọ̀-aṣòfin-mu" is a real entry meaning
// "unparliamentary language". It is not an example anyone should meet second.
const MAX_EXAMPLE_LENGTH = 24;

const ENCYCLOPEDIC = /^(also known as|an? (male|female|unisex) given name|a primordial|a powerful|title of)/i;

// Entries whose definition only points at another entry. Real words, but they
// teach the reader nothing about the root they contain - "lẹ́hìn: archaic
// spelling of lẹ́yìn" is a worse example than lẹ́yìn itself, which is already
// in the list.
const POINTER_DEFINITION = /^(alternative|archaic|obsolete|dated|nonstandard|misspelling|standard|superseded|rare)\b.*\b(form|spelling|of)\b/i;

function firstDefinition(entry) {
  for (const sense of entry.senses || []) {
    if (sense.glosses && sense.glosses[0]) return sense.glosses[0];
  }
  return '';
}

function loadFrequency(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

// How much a word is actually used, from the Leipzig corpus. Tries the toned
// spelling first, then the untoned Wiktionary title, since the corpus is not
// consistently diacritized.
function corpusCount(entry, yoruba) {
  for (const spelling of [entry.forms?.exact, entry.headword, entry.forms?.toneInsensitive]) {
    if (spelling && yoruba[spelling.toLowerCase()] != null) return yoruba[spelling.toLowerCase()];
  }
  return 0;
}

// How ordinary the concept is, from its English definition. Averaged over the
// definition rather than taking its most common word: "Also known as Mọ́remí
// Àjàṣorò, she was…" contains "she" and "was", and scoring on the best word
// alone puts every encyclopedic entry at the top. Returns 0..1.
function conceptCommonness(entry, english, total) {
  const words = firstDefinition(entry).toLowerCase().match(/[a-z]+/g) || [];
  const ranks = words.map((w) => english[w]).filter((r) => r != null);
  if (ranks.length === 0) return 0;
  const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  return 1 - mean / total;
}

function usableAsExample(entry) {
  // A given name teaches nothing about the root it contains.
  if (entry.pos === 'name') return false;
  if ((entry.forms?.exact || '').length > MAX_EXAMPLE_LENGTH) return false;
  const definition = firstDefinition(entry);
  if (!definition) return false;
  if (definition.split(/\s+/).length > MAX_DEFINITION_WORDS) return false;
  if (ENCYCLOPEDIC.test(definition)) return false;
  if (POINTER_DEFINITION.test(definition)) return false;
  return true;
}

export function buildBuildingBlocks(entries, options = {}) {
  const yoruba = loadFrequency(options.yorubaFrequencyPath);
  const english = loadFrequency(options.englishFrequencyPath);
  const englishTotal = Math.max(1, ...Object.values(english)) + 1;
  const byId = new Map(entries.map((e) => [e.id, e]));

  // root entry id -> the entries built from it
  const builds = new Map();
  for (const entry of entries) {
    for (const morpheme of entry.etymologyMorphemes || []) {
      if (!morpheme.resolved) continue;
      const rootId = morpheme.chosenEntryId || (morpheme.entryIds || [])[0];
      if (!rootId || rootId === entry.id || !byId.has(rootId)) continue;
      if (!builds.has(rootId)) builds.set(rootId, new Set());
      builds.get(rootId).add(entry.id);
    }
  }

  const exampleScore = (entry) => {
    const count = corpusCount(entry, yoruba);
    // Real usage wins outright where we can measure it; the concept score only
    // orders the words the corpus never saw.
    if (count >= TRUSTWORTHY_COUNT) return 10 + Math.log1p(count);
    return conceptCommonness(entry, english, englishTotal);
  };

  const blocks = [...builds.entries()]
    .map(([rootId, derivedIds]) => {
      const root = byId.get(rootId);
      const seenSpelling = new Set();
      const examples = [...derivedIds]
        .map((id) => byId.get(id))
        .filter(usableAsExample)
        .sort((a, b) => exampleScore(b) - exampleScore(a))
        .filter((e) => {
          // ọ̀rọ̀kọ́rọ̀ exists twice as separate entries; one is enough here.
          const key = e.forms.exact;
          if (seenSpelling.has(key)) return false;
          seenSpelling.add(key);
          return true;
        })
        .slice(0, EXAMPLES_PER_BLOCK)
        .map((e) => ({
          entryId: e.id,
          form: e.forms.exact,
          pos: e.pos,
          definition: firstDefinition(e),
          corpusCount: corpusCount(e, yoruba),
        }));

      return {
        entryId: rootId,
        form: root.forms.exact,
        pos: root.pos,
        definition: firstDefinition(root),
        buildsCount: derivedIds.size,
        examples,
      };
    })
    // A root with nothing showable is not useful on the page, however much it
    // technically builds.
    .filter((b) => b.examples.length >= 3)
    .sort((a, b) => b.buildsCount - a.buildsCount || a.form.localeCompare(b.form));

  const result = {
    generatedAt: new Date().toISOString(),
    // Credited on the page too; CC BY 4.0 requires it.
    frequencySource: 'Leipzig Corpora Collection (yor_wikipedia_2021_10K), CC BY 4.0',
    blocks: blocks.slice(0, HOW_MANY_BLOCKS),
  };

  return applyOverrides(result, options.overridesPath);
}

// The hand-edit path. Nothing uses it yet, and the file need not exist - it is
// here so that correcting the list later is an edit to data rather than a code
// change. Shapes:
//   { "exclude": ["<entryId>", …],
//     "pin":     ["<entryId>", …],                 moved to the front, in order
//     "examples": { "<entryId>": ["<entryId>", …] } replaces that block's list }
function applyOverrides(result, overridesPath) {
  if (!overridesPath || !existsSync(overridesPath)) return result;
  const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));

  let blocks = result.blocks;
  if (overrides.exclude) {
    const drop = new Set(overrides.exclude);
    blocks = blocks.filter((b) => !drop.has(b.entryId));
  }
  if (overrides.pin) {
    const rank = new Map(overrides.pin.map((id, i) => [id, i]));
    blocks = [...blocks].sort(
      (a, b) => (rank.has(a.entryId) ? rank.get(a.entryId) : Infinity)
        - (rank.has(b.entryId) ? rank.get(b.entryId) : Infinity)
    );
  }
  if (overrides.examples) {
    const wanted = new Map(Object.entries(overrides.examples));
    blocks = blocks.map((b) => {
      if (!wanted.has(b.entryId)) return b;
      const order = wanted.get(b.entryId);
      const have = new Map(b.examples.map((e) => [e.entryId, e]));
      return { ...b, examples: order.map((id) => have.get(id)).filter(Boolean) };
    });
  }

  return { ...result, blocks, overridesApplied: true };
}

// Run as part of the build rather than in a test, so a bad list fails the build
// instead of reaching the page. Every rule here is one the research showed
// matters; see the module header.
export function assertBuildingBlocksAreUsable(result) {
  const problems = [];
  for (const block of result.blocks) {
    if (block.examples.length < 3) {
      problems.push(`${block.form} has only ${block.examples.length} examples`);
    }
    const spellings = new Set();
    for (const example of block.examples) {
      if (example.pos === 'name') problems.push(`${block.form}: ${example.form} is a given name`);
      if (example.definition.split(/\s+/).length > MAX_DEFINITION_WORDS) {
        problems.push(`${block.form}: ${example.form} has an encyclopedic definition`);
      }
      if (spellings.has(example.form)) problems.push(`${block.form}: ${example.form} appears twice`);
      spellings.add(example.form);
    }
  }
  if (problems.length) {
    throw new Error(`Building-block list is not usable:\n  ${problems.join('\n  ')}`);
  }
}
