// build/lib/address.test.mjs
//
// An address is a promise: once a page is linked to or indexed, moving it costs
// whatever that page had earned. So the rule that produces one is worth pinning
// down, particularly the parts that were wrong first time - the folding of marks
// orthography.mjs leaves alone, multi-word Ajami targets, and what happens when
// the fold destroys the only thing telling two entries apart.

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import {
  classify,
  foldToAscii,
  groupBySpelling,
  declaredAltForms,
  isReservedPageName,
  latinNameFromDefinition,
  pathFor,
  spellingPathFor,
  wordFromDefinition,
  RESERVED,
} from './address.mjs';

function entry(spelling, glosses, { pos = 'verb', id = spelling } = {}) {
  return {
    id,
    headword: spelling,
    pos,
    canonicalForm: { value: spelling },
    senses: (Array.isArray(glosses) ? glosses : [glosses]).map((g, i) => ({
      id: `${id}-s${i}`,
      glosses: [g],
    })),
  };
}

test('folding drops tone and underdots, so homographs share a first segment', () => {
  assert.equal(foldToAscii('gbà'), 'gba');
  assert.equal(foldToAscii('gbá'), 'gba');
  assert.equal(foldToAscii('ẹ̀wọ̀n'), 'ewon');
  assert.equal(foldToAscii('ilé'), 'ile');
  assert.equal(foldToAscii('Àbẹ̀ní'), 'abeni');
});

test('folding also drops the two marks orthography.mjs leaves alone', () => {
  // Caron (the old rising-tone mark) and tilde (nasal). orthographyInsensitiveForm
  // keeps both, because search never needed them stripped and its fixture is
  // shared with another repo.
  assert.equal(foldToAscii('ǒ'), 'o');
  assert.equal(foldToAscii('ẽru'), 'eru');
  assert.equal(foldToAscii('ɔ̌'), 'o');
});

test('ɛ and ɔ fold to their Latin counterparts', () => {
  assert.equal(foldToAscii('ɛ'), 'e');
  assert.equal(foldToAscii('mɔ'), 'mo');
  assert.equal(foldToAscii('Ɔ̄'), 'o');
});

test('a spelling with a space becomes one hyphenated segment', () => {
  assert.equal(foldToAscii('aṣọ òkè'), 'aso-oke');
  assert.equal(foldToAscii('sọ̀rọ̀ sókè'), 'soro-soke');
});

test('an ordinary entry defers its word to the ledger', () => {
  const c = classify(entry('gbà', 'to receive'));
  assert.deepEqual(c, { spelling: 'gba', word: null, kind: 'latin' });
});

test('an Ajami spelling sits beside the Latin word it spells', () => {
  const c = classify(entry('فُنفُن', 'Ajami spelling of funfun', { pos: 'adj' }));
  assert.deepEqual(c, { spelling: 'funfun', word: 'ajami', kind: 'ajami' });
  assert.equal(pathFor(c.spelling, c.word), '/yo/funfun/ajami');
});

test('an Ajami spelling of a compound keeps the whole compound', () => {
  // Stopping at the first space filed aṣọ òkè, aṣọ òfì and sọ̀rọ̀ sókè under
  // /aso/ and /so/ - three different words, two addresses.
  assert.equal(classify(entry('اشوَْ وْكعِ', 'Ajami spelling of aṣọ òkè', { pos: 'noun' })).spelling, 'aso-oke');
  assert.equal(classify(entry('اشوَْ وْفِ', 'Ajami spelling of aṣọ òfì', { pos: 'noun' })).spelling, 'aso-ofi');
});

test('a parenthesised meaning is not part of the target', () => {
  const c = classify(entry('ادُرَ', 'Ajami spelling of àdúrà (“prayer”)', { pos: 'noun' }));
  assert.equal(c.spelling, 'adura');
});

test('the Ajami alphabet pages are numbered, and use their number', () => {
  const c = classify(entry('و', 'The twenty-fourth letter of the Yoruba alphabet, written in the Arabic script; preceded by اُ.', { pos: 'character' }));
  assert.deepEqual(c, { spelling: 'ajami-letter', word: 'twenty-fourth', kind: 'ajami-letter' });
});

test('the tone marks are named from their own definitions', () => {
  const low = classify(entry('◌̀', 'A diacritical mark of the Latin script, called àmì ohùn ìsàlẹ̀ (“low-tone mark”) in Yoruba.', { pos: 'character' }));
  assert.deepEqual(low, { spelling: 'tone-mark', word: 'low', kind: 'tone-mark' });
  // The source spells this one “lengthend”; an address should not promise a typo.
  const long = classify(entry('◌̃', 'A diacritical mark of the Latin script, called àmì fàágùn (“lengthend mark”).', { pos: 'character' }));
  assert.equal(long.word, 'lengthened');
});

test('entries sharing a spelling land in one group, which is where a word is chosen', () => {
  const { groups, unresolved } = groupBySpelling([
    entry('gbà', 'to receive', { id: 'a' }),
    entry('gbá', 'to sweep', { id: 'b' }),
    entry('ilé', 'a house', { id: 'c' }),
  ]);
  assert.equal(unresolved.length, 0);
  assert.deepEqual([...groups.keys()], ['gba', 'ile']);
  assert.equal(groups.get('gba').length, 2);
});

test('a derived word that would repeat inside its group is handed back for naming', () => {
  // gbé and gbẹ both fold to gbe, so both Ajami entries want /gbe/ajami. The
  // fold destroyed what told them apart, so neither keeps the derived word -
  // a number here would be an address nobody could read.
  const { groups } = groupBySpelling([
    entry('ڠعِ', 'Ajami spelling of gbé', { id: 'a' }),
    entry('ڠعَِ', 'Ajami spelling of gbẹ', { id: 'b' }),
    entry('اِلعِ', 'Ajami spelling of ilé', { id: 'c', pos: 'noun' }),
  ]);
  assert.deepEqual(groups.get('gbe').map((m) => m.proposedWord), [null, null]);
  assert.deepEqual(groups.get('ile').map((m) => m.proposedWord), ['ajami']);
});

test('groups come back in a stable order regardless of input order', () => {
  const made = (order) => [...groupBySpelling(order).groups.keys()];
  const a = entry('ilé', 'a house', { id: 'a' });
  const b = entry('gbà', 'to receive', { id: 'b' });
  const c = entry('ọwọ́', 'a hand', { id: 'c', pos: 'noun' });
  assert.deepEqual(made([a, b, c]), made([c, a, b]));
  assert.deepEqual(made([a, b, c]), ['gba', 'ile', 'owo']);
});

test('every word lives under /yo/, so the root stays free', () => {
  // The addresses were /gba/take, which handed 4,343 top-level segments to the
  // dictionary and made every future page - /donate, /blog - negotiate with all
  // of them. One reserved segment costs a little length and buys the root back.
  assert.equal(pathFor('gba', 'take'), '/yo/gba/take');
  assert.equal(spellingPathFor('gba'), '/yo/gba');
});

test('a page of the site may not be called yo, or it would sit on the dictionary', () => {
  assert.ok(isReservedPageName('yo'));
  for (const name of ['about', 'learners', 'contribute']) {
    assert.ok(isReservedPageName(name), `${name} is a real page`);
  }
  // And an ordinary word is no longer reserved, because it cannot collide.
  assert.ok(!isReservedPageName('gba'));
  assert.ok(!isReservedPageName('app.js'));
});
// wordFromDefinition is the floor an address falls back to - but more than that,
// it is shown to whoever names the page as a suggestion, and measured against the
// shipped ledger it was kept verbatim about half the time. So a bad suggestion is
// not a bad fallback, it is a bad address. 80% of the addresses that led with a
// frame led with the frame this produced, which is why these cases are pinned.

test('the frame Wiktionary wraps a meaning in is not the meaning', () => {
  assert.equal(wordFromDefinition('type of mat'), 'mat');
  assert.equal(wordFromDefinition('a type of hairstyle'), 'hairstyle');
  // "saying", not "say": the frame comes off, the gerund stays. Turning a gerund
  // back into a stem needs real morphology - "coordinating" is not "coordinat" -
  // and a regex that tried would be wrong more often than the gerund is ugly.
  assert.equal(wordFromDefinition('the act of saying'), 'saying');
  assert.equal(wordFromDefinition('a kind of drum'), 'drum');
});

test('a stative verb is named by its adjective, as the editors named theirs', () => {
  // 130 of the 141 names chosen by hand on Wiktionary are a single bare word and
  // not one of them starts with "be". "to be angry" is angry.
  assert.equal(wordFromDefinition('to be angry'), 'angry');
  assert.equal(wordFromDefinition('to become large'), 'large');
  assert.equal(wordFromDefinition('to be sure, certain'), 'sure');
  // Unless there is nothing else to say, which is a real etymid on Wiktionary.
  assert.equal(wordFromDefinition('to be'), 'be');
});

test('a quoted meaning outranks the prose around it', () => {
  assert.equal(
    wordFromDefinition('a male given name meaning “Royalty befits me”'),
    'royalty-befits-me'
  );
  assert.equal(wordFromDefinition('alternative form of tuntun (“to be new”)'), 'new');
});

test('a category with no meaning beside it suggests nothing at all', () => {
  // Naming a page "male-given-name" tells a reader nothing, and 102 addresses in
  // the shipped ledger were exactly that, kept from this function's own output.
  // Better to hand back nothing and have a person asked.
  assert.equal(wordFromDefinition('a female given name'), '');
  assert.equal(wordFromDefinition('a unisex given name a surname'), '');
  assert.equal(wordFromDefinition('a male given name'), '');
});

test('a relative clause is unwrapped, including the shapes oríkì names use', () => {
  assert.equal(wordFromDefinition('One who is begged for to have'), 'begged-for');
  assert.equal(wordFromDefinition('One we beg for to stay'), 'beg-for');
  assert.equal(wordFromDefinition('Used to express surprise'), 'express-surprise');
});

test('an ordinary definition is left alone', () => {
  assert.equal(wordFromDefinition('to receive'), 'receive');
  assert.equal(wordFromDefinition('hospital'), 'hospital');
  assert.equal(wordFromDefinition('a house, a home'), 'house');
  assert.equal(wordFromDefinition('him, her, it (third-person singular object pronoun)'), 'him');
});

test('a definition that points somewhere is recognised by shape, not by a word list', () => {
  // The rule listed nine qualifiers - alternative, archaic, obsolete and six
  // more - and measured against the corpus it missed 51 definitions that plainly
  // point elsewhere. A hard rule with a hand-listed vocabulary stops firing the
  // moment the source phrases things slightly differently, and nothing reports it.
  assert.equal(wordFromDefinition('Ekiti form of awó (“guinea fowl”)'), 'guinea-fowl');
  assert.equal(wordFromDefinition('synonym of ìrá kùnnùgbá (“hartebeest”)'), 'hartebeest');
  assert.equal(wordFromDefinition('Ondo form of dúró (“to wait”)'), 'wait');
  assert.equal(wordFromDefinition('alternative form of tuntun (“to be new”)'), 'new');
});

test('"in the form of" is a shape, not a redirection', () => {
  // The one phrasing the shape rule cannot tell apart on structure alone.
  assert.equal(wordFromDefinition('bending in the form of a slope or unevenly'), 'bending');
  assert.match(wordFromDefinition('a device used in a form of cleromancy'), /^device/);
});

test('an accented target is folded, not stripped letter by letter', () => {
  // "Negative form of wà" has no quoted meaning, so it falls back to the target -
  // and deleting the accent instead of folding it gave "w", a one-letter address
  // for a real word.
  assert.equal(wordFromDefinition('Negative form of wà'), 'wa');
  assert.equal(wordFromDefinition('alternative form of ẹ̀wọ̀n'), 'ewon');
});

test('RESERVED is derived from the pages that exist, not a hand-copy of them', () => {
  // A hand-copy goes stale: the /go/<id> route was added later, never reserved,
  // and four real Yorùbá verbs landed on top of it.
  for (const name of ['about', 'speak-nigeria', 'learners', 'teachers', 'building-blocks', 'contribute']) {
    assert.ok(RESERVED.has(name), `${name} is a real page and must be reserved`);
  }
  // It no longer needs to list shipped files: nothing at the root is an address.
  assert.ok(!RESERVED.has('app.js'));
});
test('no route the app invents can ever be a folded spelling', () => {
  // /go/<id> was the placeholder for a link built before the dictionary arrived,
  // and go, gò, gọ̀ and gọ are four real Yorùbá verbs - all four landed at
  // /go/<word> and shadowed it. The hand-written reserved list did not have "go"
  // in it, because the route was added later and nobody remembered.
  //
  // An underscore cannot survive foldToAscii, so a route segment containing one
  // is collision-proof by construction. This asserts the property rather than
  // the list, because the list is what went stale.
  for (const segment of ['_entry', '_pending', '_x']) {
    assert.notEqual(foldToAscii(segment), segment, `${segment} must be unfoldable`);
  }
  assert.equal(foldToAscii('go'), 'go', 'and go itself is a word, not a route');
});

test('no route the app matches on can be mistaken for a word', () => {
  // Words live under /yo/, so a route at the root cannot collide with one by
  // construction. What still must not collide is a route inside /yo/, and there
  // are none - asserted by reading app.js rather than by remembering.
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const inLanguageTree = [...app.matchAll(/\\\/yo\\\/\(?([a-z_|-]+)\)?\\\//g)].flatMap((m) =>
    m[1].split('|')
  );
  assert.deepEqual(
    inLanguageTree.filter((r) => foldToAscii(r) === r),
    [],
    'a route inside /yo/ that folds to itself could be a spelling'
  );
});

// A page written in another script has to be told which word it writes. Two
// sources say so, and the order between them was the whole question.

const ajami = (spelling, gloss, { pos = 'noun', id } = {}) => ({
  id: id || `en-${spelling}-yo-${pos}-x`,
  headword: spelling,
  pos,
  canonicalForm: { value: spelling },
  senses: [{ id: 's0', glosses: [gloss] }],
});

const latin = (spelling, alt, { pos = 'noun' } = {}) => ({
  id: `en-${spelling}-yo-${pos}-y`,
  headword: spelling,
  pos,
  canonicalForm: { value: spelling },
  altForms: [{ form: alt, tags: ['alternative'] }],
  senses: [{ id: 's0', glosses: ['a word'] }],
});

test('the definition names the word, and it wins because it is per entry', () => {
  // وْهُنكوْهُن is two different entries - the Ajami for ohunkóhun and the Ajami
  // for àwọsánmà - and only the definition tells them apart. The declaration is
  // keyed on the spelling, so it maps both to whoever declared it.
  const shared = 'وْهُنكوْهُن';
  const declared = declaredAltForms([latin('ohunkóhun', shared)]);
  const one = ajami(shared, 'Ajami spelling of ohunkóhun', { id: 'a' });
  const two = ajami(shared, 'Ajami spelling of àwọsánmà', { id: 'b' });
  assert.equal(classify(one, declared).spelling, 'ohunkohun');
  assert.equal(classify(two, declared).spelling, 'awosanma', 'the declaration would have collided these');
});

test('a declaration covers an entry whose own definition names nothing', () => {
  const declared = declaredAltForms([latin('funfun', 'فُنفُن')]);
  const c = classify(ajami('فُنفُن', 'Ajami form of something'), declared);
  assert.deepEqual(c, { spelling: 'funfun', word: 'ajami', kind: 'declared' });
});

test('an entry nothing can place is refused, not filed as an alphabet letter', () => {
  // This used to fall through: any Arabic-script entry the phrase match missed
  // became /yo/ajami-letter/<something>, so a reworded definition put a real
  // word on an alphabet page. A wrong address rather than an error.
  const c = classify(ajami('ڠعِ', 'some phrasing nobody anticipated'), new Map());
  assert.equal(c.kind, 'unresolved');
  assert.equal(c.spelling, '');
});

test('an alphabet letter is only an alphabet letter when it says so', () => {
  const c = classify(ajami('و', 'The twenty-fourth letter of the Yoruba alphabet', { pos: 'character' }), new Map());
  assert.deepEqual(c, { spelling: 'ajami-letter', word: 'twenty-fourth', kind: 'ajami-letter' });
});

test('an unplaceable entry fails the build rather than getting a wrong address', () => {
  const { unresolved } = groupBySpelling([ajami('ڠعِ', 'nothing recognisable')]);
  assert.equal(unresolved.length, 1, 'build/lib/slugs.mjs throws on these');
});

// 992 of the 6,273 entries are botanical or zoological, and Wiktionary's Yorùbá
// ones very often carry no everyday English name at all - only a Latin binomial.
// An ordinary rule reaches for the only English words present and produces
// "name-variety", which identifies nothing.

test('a genus is the answer when the definition offers no everyday word', () => {
  assert.equal(
    wordFromDefinition(
      'The name for a variety of similar plants, including Terminalia schimperiana, ' +
        'Terminalia macroptera, Microdesmis puberula'
    ),
    'terminalia'
  );
  assert.equal(wordFromDefinition('The name for several plants of the family Apocynaceae'), 'apocynaceae');
});

test('a category word in front of the genus is dropped, not kept', () => {
  // The rule found the genus and buried it: plant-rauvolfia-vomitoria.
  assert.equal(wordFromDefinition('The plant Rauvolfia Vomitoria, often used in medicine'), 'rauvolfia');
  assert.equal(wordFromDefinition('the tree Lophira lanceolata'), 'lophira');
});

test('a common English name beats the Latin one', () => {
  // The point of the whole rule is that it is a fallback. baobab is what anyone
  // would search for; adansonia is not.
  assert.equal(wordFromDefinition('baobab tree, Adansonia digitata'), 'baobab-tree');
  assert.equal(wordFromDefinition('the kapok tree, Ceiba pentandra'), 'kapok-tree');
  // "Tree" here is part of the animal's name, not a category in front of it.
  assert.equal(wordFromDefinition('Tree hyrax; (in particular) the Dendrohyrax interfluvialis'), 'tree-hyrax');
});

test('it never fires on something that is not a living thing', () => {
  // "Latin script" matches a binomial pattern on its own.
  assert.equal(latinNameFromDefinition('The name of the Latin script letter O/o.'), '');
  assert.equal(latinNameFromDefinition('to receive'), '');
  // And a sentence-initial capital is not a genus.
  assert.equal(latinNameFromDefinition('Name of a plant. Further details are uncertain.'), '');
});
