// build/lib/address.mjs
//
// The web address of an entry, and the only place that decides it.
//
// An address is two segments: the spelling, then one English word.
//
//     /gba/receive        /ile/home        /ro/ache
//
// This file owns the first segment. The second lives in data/url-slugs.json,
// because it is a permanent contract - once a page is linked to or indexed,
// moving it costs whatever that page had earned - and a value computed fresh
// from the current definition on every build is not a contract. The build reads
// that ledger and never writes it. See tools/slugs/.
//
// Addresses drop tone marks and underdots: gbà, gbá and gba all answer to
// "gba". That loses a real distinction, and the English word is what carries it
// back - which is why the word is chosen per spelling group rather than per
// entry, so the eleven meanings of dá are named against each other.

import { orthographyInsensitiveForm } from './orthography.mjs';

// Two marks orthographyInsensitiveForm leaves alone: caron (the old rising-tone
// mark, ǒ ɛ̌) and tilde (nasal, ẽ). Stripped here rather than there because that
// function feeds build/fixtures/search_agreement.json, shared with
// yoruba_student_dict_platform - widening it would change search results in two
// repos to fix twenty-three addresses.
const REMAINING_MARKS = /[̌̃]/g;

// ɛ and ɔ carry no information a reader of an address can use, and they have one
// obvious Latin counterpart each. Folding them lets those entries join the group
// they belong to: ɔ̌ becomes o, and sits with the rest of o.
const LATINISE = [
  [/[ɛƐ]/g, 'e'], // ɛ Ɛ
  [/[ɔƆ]/g, 'o'], // ɔ Ɔ
];

const ARABIC = /[؀-ۿݐ-ݿ]/;
const DOTTED_CIRCLE = /◌/;

// What a page of the site may not be called.
//
// Much shorter than it was, because every word now lives under /yo/ and so no
// entry can shadow anything at the root any more. That was the list's whole job.
// What is left is the other direction: a written page must not be called "yo",
// or it would sit on top of the dictionary.
//
// Derived from page-render.js rather than typed out, because a hand-copy of a
// list that already exists goes stale - and did: the /go/<id> route was added
// later, never reserved, and four real Yorùbá verbs landed on top of it.
import { createPageRenderer } from '../../public/page-render.js';

const PAGE_NAMES = createPageRenderer({
  pathFor: () => '/',
  pagePath: (name) => `/${name}`,
  escapeHtml: (s) => String(s),
})
  .PAGES.map((page) => page.path.replace(/^\//, ''))
  .filter(Boolean);

export const RESERVED = new Set(PAGE_NAMES);

/** Would this page name collide with the dictionary or with a shipped file? */
export function isReservedPageName(name) {
  return name === 'yo' || RESERVED.has(name);
}

/** Reduce any text to the a-z0-9 form an address can hold, or '' if nothing survives. */
export function foldToAscii(text) {
  let out = orthographyInsensitiveForm(text || '')
    .normalize('NFD')
    .replace(REMAINING_MARKS, '')
    .normalize('NFC');
  for (const [pattern, replacement] of LATINISE) out = out.replace(pattern, replacement);
  return out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const firstDefinition = (entry) => {
  for (const sense of entry.senses || []) {
    if (sense.glosses && sense.glosses[0]) return sense.glosses[0];
  }
  return '';
};

const spellingOf = (entry) => (entry.canonicalForm || {}).value || entry.headword || '';

// The six tone-mark pages name themselves in their own definitions - "àmì ohùn
// ìsàlẹ̀ (“low-tone mark”)" - but one of the six spells it “lengthend”, and a
// typo is a poor thing to promise forever. Six entries, written out.
const TONE_MARK_WORDS = [
  [/low-tone/i, 'low'],
  [/high-tone/i, 'high'],
  [/middle-tone/i, 'middle'],
  [/rising-tone/i, 'rising'],
  [/falling-tone/i, 'falling'],
  [/lengthen/i, 'lengthened'],
];

const ORDINALS = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth)\b/i;

/**
 * Where an entry lives, and how that was decided.
 *
 * Returns { spelling, word, kind }. `word` is a proposal: null means "the
 * ledger decides", a string means the address is derivable and no one needs to
 * be asked. `kind` is why, and is worth keeping - it tells a reviewer which
 * rule produced an address they are being asked to approve.
 */
/**
 * Spelling -> the entries that declare it as an alternative form of themselves.
 *
 * This is how a page written in another script finds out which word it belongs
 * to, and it is a fact recorded in the data rather than a sentence to be parsed:
 * funfun's entry carries altForms [{ form: "فُنفُن" }], so فُنفُن belongs beside
 * funfun. The browser already renders that list as "alternative spellings".
 *
 * It replaces reading "Ajami spelling of funfun" out of the definition, which
 * matched one literal English phrase. Reword the phrase and that match failed
 * silently, and the entry fell through to the branch below and was filed as an
 * alphabet letter - a wrong page rather than an error. It also could not tell
 * فُنفُن (noun) from فُنفُن (verb) from فُنفُن (adj), because it only ever
 * recovered the text "funfun"; a declaration resolves to a specific entry, part
 * of speech included.
 */
export function declaredAltForms(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const alt of entry.altForms || []) {
      if (!alt.form) continue;
      if (!index.has(alt.form)) index.set(alt.form, []);
      index.get(alt.form).push(entry);
    }
  }
  return index;
}

export function classify(entry, declared) {
  const spelling = spellingOf(entry);
  const folded = foldToAscii(spelling);
  if (folded) return { spelling: folded, word: null, kind: 'latin' };

  const definition = firstDefinition(entry);

  // The tone marks: ◌̀ ◌́ ◌̄ ◌̌ ◌̂ ◌̃
  if (DOTTED_CIRCLE.test(spelling)) {
    const hit = TONE_MARK_WORDS.find(([pattern]) => pattern.test(definition));
    return { spelling: 'tone-mark', word: hit ? hit[1] : null, kind: 'tone-mark' };
  }

  // A page written in another script belongs beside the word it writes:
  // فُنفُن lives at /yo/funfun/ajami rather than off in its own corner.
  //
  // Two ways to find that word, and the order is not the obvious one.
  //
  // The definition goes first, even though it is English prose matched by a
  // literal phrase, because it is per-ENTRY. The declaration below is keyed on
  // the spelling, and a spelling can be shared: وْهُنكوْهُن is two different
  // entries, one the Ajami for ohunkóhun and one for àwọsánmà. The prose tells
  // them apart. The declaration cannot - it maps the spelling to whoever
  // declared it and would file both under ohunkóhun, colliding.
  //
  // The declaration is the fallback, and it is the robust one: it is a fact in
  // the data rather than a sentence, so rewording cannot break it, and it covers
  // the entries whose own definition does not name a target.
  const declaredTarget = () => {
    const owners = (declared && declared.get(spelling)) || [];
    const folded = owners.map((owner) => foldToAscii(spellingOf(owner))).filter(Boolean);
    return folded.sort()[0] || '';
  };

  if (ARABIC.test(spelling)) {
    // The whole target phrase, not its first word: plenty of these spell
    // compounds - aṣọ òkè, sọ̀rọ̀ sókè, ẹni tí ọkàn mi yàn - and stopping at the
    // first space filed three different compounds under /aso/ and /so/.
    const target = definition.match(/^Ajami spelling of\s+([^(,;]+)/i);
    const named = target ? foldToAscii(target[1]) : '';
    if (named) return { spelling: named, word: 'ajami', kind: 'ajami' };

    const owned = declaredTarget();
    if (owned) return { spelling: owned, word: 'ajami', kind: 'declared' };

    // The Ajami alphabet's own letter pages, which spell nothing. Their
    // definitions number them, and that number is the only stable thing about
    // them: "The twenty-fourth letter of the Yoruba alphabet".
    //
    // Reached only when the definition says so. It used to be the fall-through
    // for any Arabic-script entry the phrase match missed, which meant a
    // reworded definition put a real word on an alphabet page - a wrong address
    // rather than an error.
    const ordinal = definition.match(ORDINALS);
    if (ordinal) {
      return { spelling: 'ajami-letter', word: ordinal[1].toLowerCase(), kind: 'ajami-letter' };
    }
    return { spelling: '', word: null, kind: 'unresolved' };
  }

  // Any other script. Nothing here reads prose - if somebody declares this
  // spelling, it belongs to them; if not, the build says so rather than guessing.
  const owned = declaredTarget();
  if (owned) return { spelling: owned, word: null, kind: 'declared' };

  return { spelling: '', word: null, kind: 'unresolved' };
}

/**
 * Entries grouped by first segment, in a stable order.
 *
 * This grouping is the unit the English word is chosen in, and that is the
 * point of it: every address collision measured against the shipped data was
 * two entries inside one group, so a group that names its members against each
 * other cannot produce one.
 */
export function groupBySpelling(entries) {
  const groups = new Map();
  const unresolved = [];
  const declared = declaredAltForms(entries);
  for (const entry of entries) {
    const { spelling, word, kind } = classify(entry, declared);
    if (!spelling) {
      unresolved.push(entry);
      continue;
    }
    if (!groups.has(spelling)) groups.set(spelling, []);
    groups.get(spelling).push({ entry, proposedWord: word, kind });
  }
  // A derived word is only usable if it is the only one of its kind in the
  // group. Two Ajami entries can spell words that differ only in tone - gbé and
  // gbẹ both fold to gbe - and the fold has thrown away exactly what told them
  // apart. Rather than paper over that with a number, hand both back to the
  // ledger: the group naming step sees the full definitions and can say what
  // each one means.
  for (const members of groups.values()) {
    const counts = new Map();
    for (const m of members) {
      if (m.proposedWord) counts.set(m.proposedWord, (counts.get(m.proposedWord) || 0) + 1);
    }
    for (const m of members) {
      if (m.proposedWord && counts.get(m.proposedWord) > 1) m.proposedWord = null;
    }
  }

  const ordered = new Map(
    [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  return { groups: ordered, unresolved };
}

// Words that carry no meaning on their own and make a poor address. Kept in
// sync with build/lib/wiktionary-tasks.mjs, which named etymologies by the same
// rule and hit the same problem: "the place of" and "use something to" were both
// proposed as names before this list existed.
export const FILLER = new Set(['to', 'a', 'an', 'the', 'of', 'be', 'in', 'on', 'or', 'and', 'is']);

// A definition that only redirects says nothing about meaning. "alternative form
// of tuntun" gave three entries of titun the same word, which is the single
// largest family of address collisions in the shipped data.
//
// Written as a list of qualifiers once - alternative, archaic, obsolete, dated,
// and five more - and measured against the corpus it missed 51 definitions that
// plainly point somewhere else: "A form of", "synonym of", "abbreviation of",
// "Ekiti form of", "Ondo form of", "Negative form of", "contraction of". A
// hard rule with a hand-listed vocabulary is a rule that silently stops firing
// as soon as the source says something slightly different, and nothing reports
// it.
//
// So it matches the SHAPE instead: a short lead-in ending in one of the words
// that means "this is really that", followed by "of". The qualifier can be
// anything - a dialect, a register, a part of speech - because it is the
// pointing that matters, not which flavour of pointing.
// At most three plain words of qualifier before the pointing phrase, so the
// phrase has to be what the definition IS rather than something buried in it.
// A looser version matched "a device used in a form of cleromancy" and "bending
// in the form of a slope", which point nowhere.
const POINTS_AT =
  /^(?:[A-Za-zÀ-ɏ'-]+\s+){0,3}(form|spelling|synonym|abbreviation|initialism|acronym|contraction|clipping|ellipsis|variant|misspelling)s?\s+of\b/i;

// "in the form of" is a shape, not a redirection, and it is the one phrasing the
// rule above cannot tell apart on structure alone.
const NOT_POINTING = /\bin\s+(?:a|the)\s+form\s+of\b/i;
const REDIRECTING = { test: (text) => POINTS_AT.test(text) && !NOT_POINTING.test(text) };

// A frame around the word rather than the word. Wiktionary writes "type of mat",
// "act of saying", "one of Lagos State's 20 local government areas" - and the
// thing being defined is mat, saying, Lagos. Stripping the frame is worth more
// than any amount of instruction downstream: this function's output is shown to
// whoever names the page as a suggestion, and measured against the shipped
// ledger it is kept verbatim about half the time. 80% of the addresses that led
// with a frame led with the frame this produced. An anchor is followed, so the
// anchor is what has to be right.
const FRAME =
  /^(?:an?|the)?\s*(?:type|kind|sort|variety|form|act|state|process|manner|way|group|member|one)\s+of\s+/i;

// "One who is begged for", "a person who fights", "One we beg for" - the subject
// is a relative clause and the meaning is inside it. Yorùbá oríkì names are
// almost all this shape, which is why "one we", "one whose" and "one they" are
// here beside "one who".
const WHO = /^(?:an?|the)?\s*(?:one|someone|somebody|person|people|thing)\s+(?:who|whom|whose|which|that|we|they|i)\s+(?:is\s+|was\s+|are\s+|were\s+)?/i;

// "Used to express surprise", "used by traders" - the frame says how the word is
// deployed and the meaning follows it.
const USED = /^used\s+(?:to|by|for|in|when|as|at)\s+/i;

// Naming a page after the category it belongs to tells a reader nothing: every
// name is a given name. Where a definition offers only this, the quoted meaning
// beside it is the answer, and if there is none the caller gets nothing rather
// than a label.
const CATEGORY =
  /^(?:a|an|the)?\s*(?:male|female|unisex|common)?\s*(?:given|family|oriki|oríkì|surname|place|nick)?\s*(?:name|surname|title|word|term|prefix|suffix|particle|letter)\b/i;

// Wiktionary's Yorùbá entries for plants and animals very often have no everyday
// English name at all - only a Latin binomial. "The name for a variety of similar
// plants, including Terminalia schimperiana, Terminalia macroptera, Microdesmis
// puberula" offers nothing an ordinary rule can use, so the rule reaches for the
// only English words present and produces "name-variety", which identifies
// nothing. 992 of the 6,273 entries are botanical or zoological.
//
// The genus is the answer: terminalia. It is one word, it is specific, and it is
// what somebody looking for the plant would actually search.
//
// Only ever a fallback. Where a common name IS present - "baobab tree, Adansonia
// digitata" - baobab beats adansonia, and this must not fire.
const LIVING_THING =
  /\b(plants?|trees?|shrubs?|herbs?|grass|vines?|flowers?|fruits?|seeds?|palms?|yams?|beans?|species|genus|family|snakes?|birds?|fish|antelopes?|monkeys?|apes?|insects?|fungus|fungi|mushrooms?|lizards?|rodents?|mammals?)\b/i;

// A rank word introducing the Latin name - "the tree Lophira", "of species
// Annona", "the family Apocynaceae" - or a bare binomial, which is how a list
// like "including Terminalia schimperiana, Terminalia macroptera" is written.
const INTRODUCED_LATIN =
  /\b(?:tree|plant|shrub|herb|grass|vine|palm|species|genus|family|subfamily|order)\s+(?:of\s+)?([A-Z][a-z]{3,})\b/;
const BARE_BINOMIAL = /([A-Z][a-z]{3,})\s+([A-Za-z][a-z]{3,})\b/g;

// Words that get capitalised in these definitions and are not genus names. Small
// and diagnostic: a miss costs a fallback that was already going to be poor.
// An everyday English noun sitting where a species epithet should be. Its
// presence means the capitalised word before it is part of a common name rather
// than a Latin one.
const ENGLISH_AFTER_GENUS = new Set([
  'grass', 'tree', 'palm', 'yam', 'pepper', 'bean', 'nut', 'plant', 'flower',
  'fruit', 'vine', 'herb', 'shrub', 'monkey', 'snake', 'bird', 'fish', 'ant',
]);

const NOT_A_GENUS = new Set([
  'further', 'tree', 'plant', 'name', 'this', 'that', 'these', 'those', 'their',
  'latin', 'yoruba', 'english', 'african', 'west', 'south', 'north', 'east',
  'common', 'also', 'known', 'often', 'used', 'from', 'with', 'when', 'some',
  'other', 'both', 'they', 'there', 'note', 'seed', 'seeds', 'leaf', 'leaves',
]);

/**
 * The genus or family a definition names, when it names no everyday word for it.
 *
 * Returns '' unless the definition is about a living thing, so it cannot fire on
 * "The name of the Latin script letter O/o" - which the binomial pattern alone
 * matches, on "Latin script".
 */
export function latinNameFromDefinition(definition) {
  const text = definition || '';
  if (!LIVING_THING.test(text)) return '';

  // "the wild grass species Guinea grass" fits the shape and Guinea is not a
  // genus - it is half of an English common name. The tell is the word after it:
  // the second half of a binomial is Latin, never an everyday English noun.
  const introduced = text.match(INTRODUCED_LATIN);
  if (introduced && !NOT_A_GENUS.has(introduced[1].toLowerCase())) {
    const after = text
      .slice(introduced.index + introduced[0].length)
      .trimStart()
      .split(/[\s,.;()]/)[0]
      .toLowerCase();
    if (!ENGLISH_AFTER_GENUS.has(after)) return introduced[1].toLowerCase();
  }

  for (const match of text.matchAll(BARE_BINOMIAL)) {
    const candidate = match[1];
    // Not the first word of a sentence: "Further details are uncertain" is not a
    // species of anything.
    const before = text.slice(0, match.index).trimEnd();
    if (before === '' || before.endsWith('.')) continue;
    if (NOT_A_GENUS.has(candidate.toLowerCase())) continue;
    if (NOT_A_GENUS.has(match[2].toLowerCase())) continue;
    // Same test as above: an everyday English noun in the species slot means
    // this is a common name - "Guinea grass" - not a Latin one.
    if (ENGLISH_AFTER_GENUS.has(match[2].toLowerCase())) continue;
    return candidate.toLowerCase();
  }
  return '';
}

/**
 * A word for a definition, by rule.
 *
 * The floor, not the goal: it is what an address falls back to when nobody has
 * chosen anything better, so the build always has one. But it is also what gets
 * shown to whoever names the page, and that turns out to matter more - a
 * suggestion is read as an answer. So it strips the frames Wiktionary wraps
 * meanings in, and prefers a quoted meaning over the prose around it.
 */
export function wordFromDefinition(definition) {
  let text = (definition || '').trim();

  // A quoted meaning is the meaning, whatever the prose around it says. Covers
  // "alternative form of tuntun (“to be new”)" and "a male given name meaning
  // “Royalty befits me”" with one rule instead of two.
  const quoted = text.match(/[\u201c"]([^\u201d"]{2,})[\u201d"]/);
  if (quoted && (REDIRECTING.test(text) || CATEGORY.test(text))) {
    text = quoted[1];
  } else if (REDIRECTING.test(text)) {
    const target = text.match(/\bof\s+([^\s(,;]+)/);
    if (target) text = target[1];
  } else if (CATEGORY.test(text)) {
    // A category with no quoted meaning names nothing. Better to hand back
    // nothing and let the caller ask a person than to suggest "male given name"
    // and have it accepted - unless it is a plant or an animal, where the genus
    // is exactly the specific word the prose is failing to give.
    return latinNameFromDefinition(text);
  }

  // Peel frames until there are none left: "a type of one of" is not a phrase
  // anyone writes, but "a kind of type of" appears, and one pass left half of it.
  for (let round = 0; round < 3; round += 1) {
    const stripped = text.replace(FRAME, '').replace(WHO, '').replace(USED, '');
    if (stripped === text) break;
    text = stripped;
  }

  let parts = text
    .toLowerCase()
    // Decompose and drop the marks rather than letting the a-z filter below
    // delete them. "Negative form of wà" falls back to the target word when
    // there is no quoted meaning, and deleting the accent turned wà into "w" -
    // a one-letter address for a real word.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .split(/[;,]/)[0]
    .replace(/^to\s+/, '')
    // A slash separates alternatives, so it is a word boundary. Deleting it
    // instead turned "he/she/it" into "hesheit".
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // "be" leading, as well as trailing. Wiktionary writes stative verbs as "to be
  // angry" and "to become large", and the names editors chose for the same kind
  // of meaning are "angry" and "large" - 130 of their 141 are a single bare word,
  // and none of them starts with "be". Guarded by length so the etymid "be"
  // itself survives.
  while (parts.length > 1 && ['the', 'a', 'an', 'be', 'become', 'being'].includes(parts[0])) {
    parts.shift();
  }
  parts = parts.slice(0, 3);
  while (parts.length > 1 && FILLER.has(parts[parts.length - 1])) parts.pop();
  const answer = parts.join('-');

  // "The plant Rauvolfia Vomitoria" gives plant-rauvolfia-vomitoria: the rule
  // found the genus and then buried it under the category word in front of it.
  // Where the answer already CONTAINS the genus, the genus alone is the better
  // half of it.
  //
  // Deliberately narrow. "baobab tree, Adansonia digitata" gives baobab-tree,
  // which does not contain adansonia and is the better answer anyway - a common
  // English name beats a Latin one every time. Same for tree-hyrax, where "tree"
  // is part of the animal's name rather than a category.
  const latin = latinNameFromDefinition(text);
  if (latin && answer.split('-').includes(latin)) return latin;

  return answer || '';
}

/** Reduce a chosen word - an etymid name, or something typed by hand - to address form. */
export function foldWord(word) {
  return (word || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Every word lives under /yo/, and that segment is the whole point of it.
//
// The addresses were /gba/take for a while, which reads better and is wrong. It
// hands the entire root namespace to the dictionary: 4,343 top-level segments
// taken, and every page the site might ever want - /donate, /blog, /api - has to
// negotiate with all of them. The build does fail loudly on a collision, but
// "loudly" arrives after somebody has decided to add the page, and by then the
// word got there first and moving it costs a redirect against a hard limit of
// 2,000.
//
// Flattening instead - /yo/gba-take - does not work: 576 spellings contain a
// hyphen and so do 1,534 words, so /yo/aso-oke-cloth cannot be split back into a
// spelling and a word. 252 addresses have hyphens on both sides.
//
// So: one reserved segment, two after it. The root stays free permanently, /yo/
// is somewhere real to put an index, and if the dictionary ever runs the other
// direction it has an obvious home.
export const LANGUAGE_SEGMENT = 'yo';

/** The path an entry is served at. */
export function pathFor(spelling, word) {
  return `/${LANGUAGE_SEGMENT}/${spelling}/${word}`;
}

/** The path listing every word written with one spelling. */
export function spellingPathFor(spelling) {
  return `/${LANGUAGE_SEGMENT}/${spelling}`;
}
