// build/lib/wiktionary-tasks.mjs
//
// Turns "this dictionary can't tell which meaning a word was built from" into
// a list of specific Wiktionary edits, ordered by how much each one fixes.
//
// NOTHING HERE EVER WRITES TO WIKTIONARY. No API calls, no bot account, no
// auto-submission, now or later. It produces text a person reads, checks and
// types. Every proposal carries the evidence it came from so checking takes
// seconds rather than research. That constraint is deliberate: a wrong edit
// applied at scale by a machine damages a shared resource, and the whole
// reason this dictionary is worth building is that the shared resource exists.
//
// The unit of work is one PAGE, because the two halves have to be applied
// together. Anchoring pa's seven etymology sections is useless until the
// compounds point at those anchors, and pointing at "kill" is wrong if the
// editor named the section "killing". So each page carries both.
//
// Impact is heavily concentrated: measured on the corpus, 20 pages account for
// 415 of the 667 ambiguous references, and 8 of those 20 are on the Key
// Building Block Words list. Ordering by references unlocked is what makes the
// first hour of editing worth far more than the tenth.

const MAX_REFERENCES_PER_PAGE = 60;
const MAX_PAGES = 120;

// Templates whose numeric arguments name component words. Mirrors the set in
// kaikki-yoruba's extractEtymologyMorphemes; kept local because this module
// reads the raw templates rather than the extracted morphemes (it needs the
// argument positions in order to say which idN to add).
const COMPONENT_TEMPLATES = new Set([
  'compound', 'com', 'compound+', 'blend', 'af', 'affix', 'prefix',
]);

const firstDefinition = (entry) => {
  for (const sense of entry.senses || []) {
    if (sense.glosses && sense.glosses[0]) return sense.glosses[0];
  }
  return '';
};

const words = (text) =>
  new Set((text || '').toLowerCase().match(/[a-z0-9]+/g) || []);

const FILLER = new Set(['to', 'a', 'an', 'the', 'of', 'be', 'in', 'on', 'or', 'and', 'is']);

// A definition that only points at another entry says nothing about meaning,
// so it can never be evidence for a match. It is still a real section and can
// still be anchored - it just must not attract one.
const POINTER_DEFINITION =
  /^(alternative|archaic|obsolete|dated|nonstandard|misspelling|standard|superseded|rare)\b.*\b(form|spelling|of)\b/i;

// A Wiktionary definition is normally a comma-separated list of near-synonyms:
// "to tell, to convey" offers two ways of saying one thing. So a recorded
// meaning of "tell" genuinely matches it - "tell" IS one of the alternatives.
//
// What must NOT match is a meaning that only covers part of one alternative.
// "to become" against "to become opaque" is not a synonym, it is a narrowing:
// dàgbà ("to age") records its di as "to become", and the section that actually
// means that is a different one. Matching on the phrase alone put 18 words on
// the wrong section of di and told readers to go and write it down.
//
// So: split the definition into its alternatives, and require the meaning to
// match a WHOLE alternative rather than a prefix of one.
const stripLead = (s) => (s || '').toLowerCase().replace(/^to\s+/, '').trim();
function alternatives(definition) {
  return (definition || '')
    .split(/[;,]/)
    .map(stripLead)
    .filter((x) => x.length > 1);
}
function meaningMatchesDefinition(meaning, definition) {
  const given = alternatives(meaning);
  const offered = alternatives(definition);
  return given.some((g) => offered.some((o) => g === o));
}

// The name to give an etymology section, following the convention de already
// uses: tie down, deputize, wait, arrive, cover. Short, from the first
// definition, and stable - the docs are explicit that changing an id later
// breaks every reference pointing at it.
function proposeSlug(definition, taken) {
  let parts = (definition || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/^to\s+/, '')
    .split(/[;,]/)[0]
    .replace(/[^a-z0-9\s'-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Leading articles and trailing prepositions make for bad names: "the place
  // of" and "use something to" were both proposed before this. The id is a
  // permanent contract once anyone links to it, so it should read like one.
  while (parts.length > 1 && ['the', 'a', 'an'].includes(parts[0])) parts.shift();
  parts = parts.slice(0, 3);
  while (parts.length > 1 && FILLER.has(parts[parts.length - 1])) parts.pop();
  const base = parts.join(' ').trim();
  let slug = base || 'sense';
  let n = 2;
  while (taken.has(slug)) slug = `${base} ${n++}`;
  taken.add(slug);
  return slug;
}

// Does the meaning the compound gives for a component match one etymology
// section and only one?
//
// Strict on purpose. A looser rule put ita's "to be spicy" against "to shoot,
// fire (from a weapon)" on one incidentally shared word. Tier A is the tier a
// reviewer trusts instead of re-deriving, so anything short of a real match is
// demoted rather than guessed at. B is conservative, not junk: pako's oko
// "farm, wilderness" against a definition of "farm, field" is obviously right
// to a human and fails this threshold, which is correct - we shouldn't be the
// one asserting it.
function sectionsMatching(meaning, sections) {
  if (!meaning) return [];
  const given = words(meaning);
  const content = new Set([...given].filter((w) => !FILLER.has(w)));
  const hits = [];
  for (const section of sections) {
    for (const entry of section.entries) {
      for (const sense of entry.senses || []) {
        for (const definition of sense.glosses || []) {
          // A pointer definition still carries its meaning, in the bracket:
          // "alternative form of da (to become)" IS the "to become" sense, and
          // ignoring it is why di's real match was invisible. Match the
          // bracketed part, not the pointer wording.
          const pointer = POINTER_DEFINITION.test(definition);
          const inner = pointer ? (definition.match(/\(([^)]*)\)/) || [])[1] : null;
          const candidate = pointer ? inner : definition;
          if (!candidate) continue;

          const defWords = words(candidate);
          const shared = [...content].filter((w) => defWords.has(w));
          if (meaningMatchesDefinition(meaning, candidate) || shared.length >= 2) {
            hits.push({ section, definition });
          }
        }
      }
    }
  }
  const seen = new Set();
  return hits.filter((h) => !seen.has(h.section.number) && seen.add(h.section.number));
}

// The template as we understand it. Shown for context only - the proposal
// always says which single argument to ADD, never "replace this line", because
// this reconstruction drops nothing but does not preserve the original
// argument order or whitespace.
function renderTemplate(tpl, extra) {
  const args = { ...(tpl.args || {}), ...(extra || {}) };
  const numeric = Object.keys(args).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b);
  const named = Object.keys(args).filter((k) => !/^\d+$/.test(k));
  const parts = [tpl.name, ...numeric.map((k) => args[k]), ...named.map((k) => `${k}=${args[k]}`)];
  return `{{${parts.join('|')}}}`;
}

export function buildWiktionaryTasks(entries, anchorTable) {
  const byPage = new Map();
  for (const entry of entries) {
    if (!byPage.has(entry.headword)) byPage.set(entry.headword, []);
    byPage.get(entry.headword).push(entry);
  }

  // Pages holding more than one etymology are the only ones a reference can be
  // ambiguous about.
  const pages = new Map();
  for (const [page, group] of byPage) {
    const numbers = new Set(group.map((e) => e.etymologyNumber));
    if (numbers.size < 2) continue;
    const sections = [...numbers]
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
      .map((number) => {
        const inSection = group.filter((e) => e.etymologyNumber === number);
        const existing = inSection
          .flatMap((e) => e.etymologyTemplates || [])
          .find((t) => t.name === 'etymid');
        // Every meaning the section covers, not just the first. ta's
        // etymology 6 runs "to shoot" / "to sting" / "to be spicy" / "to kick"
        // / "to pick" - a reviewer told only "to shoot" would reject a
        // perfectly correct proposal for a component meaning "spicy".
        const definitions = [];
        for (const e of inSection) {
          for (const sense of e.senses || []) {
            const d = (sense.glosses || [])[0];
            if (d && !definitions.includes(d)) definitions.push(d);
          }
        }
        return {
          number,
          entries: inSection,
          definition: firstDefinition(inSection[0]),
          definitions,
          existingAnchor: existing ? (existing.args || {})['2'] : null,
        };
      });
    pages.set(page, { page, sections, references: [] });
  }

  // Every component reference landing on one of those pages.
  for (const entry of entries) {
    for (const tpl of entry.etymologyTemplates || []) {
      if (!COMPONENT_TEMPLATES.has(tpl.name)) continue;
      const args = tpl.args || {};
      if (args['1'] !== 'yo') continue;
      const numeric = Object.keys(args)
        .filter((k) => /^\d+$/.test(k) && k !== '1')
        .sort((a, b) => a - b);

      numeric.forEach((key, i) => {
        const form = args[key];
        if (typeof form !== 'string' || !form) return;
        if (form.startsWith('-') || form.endsWith('-')) return; // bound, never ambiguous
        const target = pages.get(form) || pages.get(form.toLowerCase());
        if (!target) return;
        if (args[`id${i + 1}`]) return; // already says which

        const meaning = args[`t${i + 1}`] || null;
        const matches = sectionsMatching(meaning, target.sections);
        let tier;
        if (!meaning) tier = 'C';
        else if (matches.length === 1) tier = 'A';
        else if (matches.length > 1) tier = 'B1';
        else tier = 'B2';

        target.references.push({
          tier,
          word: entry.forms.exact,
          page: entry.headword,
          editUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.headword)}#Yoruba`,
          definition: firstDefinition(entry),
          argument: `id${i + 1}`,
          component: form,
          meaning,
          template: renderTemplate(tpl),
          matchedSection: matches.length === 1 ? matches[0].section.number : null,
          matchedDefinition: matches.length === 1 ? matches[0].definition : null,
        });
      });
    }
  }

  const ranked = [...pages.values()]
    .filter((p) => p.references.length > 0)
    .sort((a, b) => b.references.length - a.references.length)
    .slice(0, MAX_PAGES)
    .map((p) => {
      const taken = new Set(p.sections.map((s) => s.existingAnchor).filter(Boolean));
      const anchors = p.sections.map((section) => {
        const slug = section.existingAnchor || proposeSlug(section.definition, taken);
        return {
          etymologyNumber: section.number,
          definition: section.definition,
          slug,
          alreadyPresent: Boolean(section.existingAnchor),
          wikitext: `{{etymid|yo|${slug}}}`,
        };
      });
      const slugFor = new Map(anchors.map((a) => [a.etymologyNumber, a.slug]));
      const coversFor = new Map(p.sections.map((sec) => [sec.number, sec.definitions]));

      const tierRank = { A: 0, B1: 1, B2: 2, C: 3 };
      const references = [...p.references]
        .sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || a.word.localeCompare(b.word))
        .slice(0, MAX_REFERENCES_PER_PAGE)
        .map((ref) => ({
          ...ref,
          // Filled in only for tier A, where we are prepared to say which.
          proposedValue: ref.tier === 'A' ? slugFor.get(ref.matchedSection) || null : null,
          // The anchor names a whole etymology section, so show everything
          // that section covers rather than only the sense that matched.
          sectionCovers: ref.tier === 'A' ? coversFor.get(ref.matchedSection) || [] : [],
          why:
            ref.tier === 'A'
              ? `its own etymology calls this component “${ref.meaning}”, and Etymology ${ref.matchedSection} covers “${ref.matchedDefinition}”`
              : ref.tier === 'C'
                ? 'its etymology gives no meaning for this component, so somebody has to know the word'
                : `its own etymology calls this component “${ref.meaning}”, which does not single out one section`,
        }));

      return {
        page: p.page,
        editUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(p.page)}#Yoruba`,
        referenceCount: p.references.length,
        referencesOmitted: Math.max(0, p.references.length - references.length),
        anchors,
        references,
      };
    });

  const tiers = {};
  for (const p of pages.values()) for (const r of p.references) tiers[r.tier] = (tiers[r.tier] || 0) + 1;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      pagesNeedingAnchors: [...pages.values()].filter((p) => p.references.length).length,
      references: [...pages.values()].reduce((n, p) => n + p.references.length, 0),
      byTier: tiers,
      resolvedByAnchorToday: anchorTable ? anchorTable.size : 0,
    },
    pages: ranked,
  };
}
