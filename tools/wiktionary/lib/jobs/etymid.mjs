// tools/wiktionary/lib/jobs/etymid.mjs
//
// Job one: give every etymology on a page a name, so that other pages can
// point at one meaning instead of at a spelling.
//
// This is the first implementation of the job interface that cli.mjs drives.
// Job two - putting the matching idN= pointers on each derived word - is the
// same shape over more pages, which is why the driver knows none of the
// vocabulary below.
//
//   pages()       which pages this job touches. One, here.
//   collect()     what could be written, and everything needed to judge it
//   renderItems() the editable part of the worksheet
//   parseItems()  read it back
//   verify()      refuse to write if the page is not what we think it is
//   apply()       pure wikitext -> wikitext

import {
  splitEtymologies,
  reassemble,
  definitionLines,
  definitionsAgree,
  existingEtymid,
  insertEtymid,
  validateName,
} from '../wikitext.mjs';

export const name = 'etymid';
export const language = 'Yoruba';
export const langCode = 'yo';

export function pages(task) {
  return [{ title: task.page, role: 'parent' }];
}

export function collect(task, entriesByPage, sectionWikitext) {
  const { blocks } = splitEtymologies(sectionWikitext);
  const liveByNumber = new Map(blocks.map((b) => [b.number, b]));
  const anchorsByNumber = new Map((task.anchors || []).map((a) => [a.etymologyNumber, a]));

  // References the build could tie to a specific etymology become that
  // etymology's evidence. The rest - a component whose tone is wrong, or which
  // records no meaning at all - belong to no section and are reported once for
  // the page, because a reader who only saw the per-section lists would think
  // naming these seven things fixed all eight words.
  const pointers = new Map();
  const unattributable = [];
  for (const reference of task.references || []) {
    if (reference.matchedSection) {
      if (!pointers.has(reference.matchedSection)) pointers.set(reference.matchedSection, []);
      pointers.get(reference.matchedSection).push(reference);
    } else {
      unattributable.push(reference);
    }
  }

  const items = [];
  for (const block of blocks) {
    const number = block.number;
    const anchor = anchorsByNumber.get(number);
    const entries = (entriesByPage || []).filter((e) => e.etymologyNumber === number);
    const existing = existingEtymid(block, langCode);

    // Wikitext can carry an etymology Kaikki dropped - `ga` has an Etymology 2
    // with no part-of-speech section, so nothing was extracted from it. We have
    // no definition for it and therefore no business naming it, but leaving it
    // silently absent from the worksheet would make a gap on the page look like
    // an oversight rather than a decision.
    const status = existing ? 'existing' : anchor && entries.length ? 'proposed' : 'unknown';

    items.push({
      number,
      status,
      name: existing || (anchor ? anchor.slug : ''),
      existingName: existing,
      proposedName: anchor ? anchor.slug : null,
      pos: entries[0]?.pos || null,
      spelling: entries[0]?.canonicalForm?.value || null,
      ipa: entries[0]?.ipa?.[0]?.ipa || null,
      definitions: entries.flatMap((e) => (e.senses || []).map((s) => (s.glosses || [])[0]).filter(Boolean)),
      liveDefinitions: definitionLines(block),
      pointedAtBy: pointers.get(number) || [],
    });
  }

  return {
    page: task.page,
    items,
    unattributable,
    missingFromWikitext: [...anchorsByNumber.keys()].filter((n) => !liveByNumber.has(n)),
  };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export function verify(sectionWikitext, items) {
  const problems = [];
  const notes = [];
  const { blocks } = splitEtymologies(sectionWikitext);
  const liveByNumber = new Map(blocks.map((b) => [b.number, b]));

  const writable = items.filter((i) => i.status === 'proposed' && i.name);

  // Gate: the page still has the etymologies the worksheet was written about.
  for (const item of items) {
    if (!liveByNumber.has(item.number)) {
      problems.push(`Etymology ${item.number} is no longer on the page. Regenerate the worksheet.`);
    }
  }

  // Gate: our numbering means what the page means by it. This is the one that
  // stops {{etymid|yo|write}} landing on the section that means "to hang".
  // Sections whose definition is entirely template - 33 of the 536 in the
  // queue - cannot be checked and do not count against the page; the other
  // sections carry the check.
  let checked = 0;
  for (const item of items) {
    const block = liveByNumber.get(item.number);
    if (!block || !item.definitions.length) continue;
    const live = definitionLines(block);
    const verdicts = live
      .flatMap((l) => item.definitions.map((d) => definitionsAgree(l, d)))
      .filter((v) => v !== null);
    if (!verdicts.length) {
      notes.push(`Etymology ${item.number}: definition is all template, so it cannot be checked.`);
      continue;
    }
    checked += 1;
    if (!verdicts.some(Boolean)) {
      problems.push(
        `Etymology ${item.number} does not match our data.\n` +
          `        on the page: ${live.join(' / ') || '(nothing)'}\n` +
          `        our record:  ${item.definitions.join(' / ')}\n` +
          `        The page has been renumbered or reordered since the last data refresh. ` +
          `Writing here would name the wrong meaning.`
      );
    }
  }
  if (writable.length && !checked) {
    problems.push(
      'Not one etymology on this page could be checked against our data, so there is no ' +
        'evidence the numbering still lines up. Refusing to write.'
    );
  }

  // Gate: never write over a name that already exists. Judged here, on live
  // wikitext, not on the build output - which is up to a week old, and anyone
  // can add an anchor in the meantime.
  for (const item of writable) {
    const live = existingEtymid(liveByNumber.get(item.number), langCode);
    if (live) {
      problems.push(
        `Etymology ${item.number} is already named "${live}" on the page. ` +
          `Regenerate the worksheet - this appeared after it was written.`
      );
    }
  }

  // Gate: names are usable, and unique across the whole page including the ones
  // already there. A duplicate would make the anchor ambiguous.
  const seen = new Map();
  for (const item of items) {
    if (!item.name) continue;
    if (item.status === 'proposed') {
      for (const problem of validateName(item.name)) {
        problems.push(`Etymology ${item.number}: the name "${item.name}" ${problem}.`);
      }
    }
    const key = item.name.toLowerCase();
    if (seen.has(key)) {
      problems.push(
        `Etymology ${item.number} and Etymology ${seen.get(key)} would both be named ` +
          `"${item.name}". Names have to be different to be worth anything.`
      );
    }
    seen.set(key, item.number);
  }

  return { ok: !problems.length, problems, notes, writableCount: writable.length };
}

export function apply(sectionWikitext, items) {
  const { preamble, blocks } = splitEtymologies(sectionWikitext);
  const byNumber = new Map(
    items.filter((i) => i.status === 'proposed' && i.name).map((i) => [i.number, i.name])
  );
  const updated = blocks.map((block) =>
    byNumber.has(block.number) ? insertEtymid(block, langCode, byNumber.get(block.number)) : block
  );
  return reassemble(preamble, updated);
}

export function summary(items) {
  const n = items.filter((i) => i.status === 'proposed' && i.name).length;
  return (
    `Add {{etymid}} to ${n} Yoruba ${n === 1 ? 'etymology' : 'etymologies'} so other entries ` +
    `can point at one meaning (semi-automated, reviewed by hand)`
  );
}
