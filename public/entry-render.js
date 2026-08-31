// public/entry-render.js
//
// .js, not .mjs, although Node and the build treat it as a module either way
// (package.json says "type": "module"). A browser will refuse to run a module
// served with the wrong content type, and .mjs is exactly the extension a
// static host is liable not to have in its table - the dev server here did not,
// and served it as application/octet-stream.
//
// Every scrap of HTML that makes up an entry page, and nothing that knows about
// a browser.
//
// It used to live in app.js and write straight into the document. It has to
// produce a string instead, because the same markup is now needed twice: once
// by the page you are looking at, and once by the build, which writes a real
// HTML file per word so that a search engine - or anyone with JavaScript off -
// can read the dictionary at all. Before this, the whole dictionary was one URL
// and the only thing Google could see was "Loading the dictionary…".
//
// So there is one renderer and two callers, rather than a renderer and a
// lookalike that drifts. What the two callers do not share is injected:
//
//   ctx.entries                  id -> entry, read at call time. app.js fetches
//                                it after first paint; the build has it up front.
//   ctx.mentionedByKey           spelling key -> spelling, for words with no entry
//   ctx.pathFor(entryId)         the href of an entry
//   ctx.mentionedPath(spelling)  the href of a mentioned-word page
//   ctx.pagePath(name)           the href of a written page, e.g. 'contribute'
//   ctx.orthographyInsensitive   tone- and underdot-stripped form
//
// Read at call time, not destructured here: `entries` is empty when app.js
// builds the renderer and full a moment later.

export function createEntryRenderer(ctx) {
  function firstGloss(entry) {
    for (const sense of entry.senses) {
      if (sense.glosses && sense.glosses[0]) return sense.glosses[0];
    }
    return '';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function dialectTermHtml(term) {
    const label = escapeHtml(term.term);
    const notes = [term.gloss, term.qualifier].filter(Boolean).join('; ');
    return `<span class="dialect-term">${label}${notes ? ` <span class="dialect-term-gloss">${escapeHtml(notes)}</span>` : ''}</span>`;
  }

  function dialectSynonymsHtml(entry) {
    const sets = entry.dialectSynonyms || [];
    if (sets.length === 0) return '';

    return sets.map((set) => {
      const varietyCount = set.groups.reduce((n, g) => n + g.varieties.length, 0);
      const wiktionaryUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.headword)}#Yoruba`;

      const groupsHtml = set.groups.map((group) => `
        <div class="dialect-group">
          ${group.group ? `<h4 class="dialect-group-name">${escapeHtml(group.group)}</h4>` : ''}
          <dl class="dialect-rows">
            ${group.varieties.map((v) => `
              <dt>${escapeHtml(v.display || v.name)}</dt>
              <dd>${v.terms.map(dialectTermHtml).join('<span class="dialect-sep" aria-hidden="true">·</span>')}</dd>
            `).join('')}
          </dl>
        </div>
      `).join('');

      return `
        <details class="dialect-panel">
          <summary>
            <span class="dialect-summary-label">Dialectal synonyms</span>
            ${set.gloss ? `<span class="dialect-summary-gloss">“${escapeHtml(set.gloss)}”</span>` : ''}
            <span class="dialect-summary-count">${varietyCount} varieties</span>
          </summary>
          <div class="dialect-body">
            ${groupsHtml}
            <a class="dialect-source" href="${wiktionaryUrl}" target="_blank" rel="noopener noreferrer">
              View the dialect map on Wiktionary ↗
            </a>
          </div>
        </details>
      `;
    }).join('');
  }

  // The reverse view, on an entry that *is* a dialect form of something else.
  // Deliberately distinct from Wiktionary's own "alternative form of" sense:
  // an alt form claims two spellings are the same word, a dialect synonym
  // claims a variety uses a different word. An entry can be both, and then
  // both are shown.
  function dialectOfHtmlFor(entry) {
    const rels = (entry.synthesizedRelations || []).filter((r) => r.type === 'dialectOf');
    if (rels.length === 0) return '';

    const lines = rels.map((rel) => {
      const target = ctx.entries[rel.entryId];
      if (!target) return '';
      const varieties = (rel.varieties || []).join(', ');
      return `
        <div class="dialect-of-line">
          <span class="dialect-of-varieties">${escapeHtml(varieties)}</span>
          <span class="dialect-of-verb">dialect form of</span>
          <a class="relation-pill" href="${ctx.pathFor(rel.entryId)}">
            <span lang="yo">${escapeHtml(target.canonicalForm.value)}</span>
            <span class="pos-hint">${escapeHtml(target.pos || '')}</span>
          </a>
        </div>
      `;
    }).filter(Boolean).join('');

    return lines ? section('Dialect', `<div class="dialect-of">${lines}</div>`) : '';
  }

  let pillGroupSeq = 0;

  function ambiguityPillHtml(chosenId, candidateIds, opts) {
    const o = opts || {};
    const target = ctx.entries[chosenId];
    if (!target) return '';

    const label = o.label != null ? o.label : target.canonicalForm.value;
    const hint = o.hint != null ? o.hint : target.pos || '';
    const cls = o.synthesized ? 'relation-pill synthesized' : 'relation-pill';
    const searchAttr = o.searchForm ? ` data-search-form="${escapeHtml(o.searchForm)}"` : '';
    const pill =
      `<a class="${cls}" href="${ctx.pathFor(chosenId)}"${searchAttr}>${escapeHtml(label)}` +
      `${hint ? `<span class="pos-hint">${escapeHtml(hint)}</span>` : ''}</a>`;

    // A badge marks doubt, not homography. Where we had evidence and it
    // settled the question, the pill is a plain link: if it's still wrong,
    // the entry it lands on lists its own siblings, so the way back exists on
    // every page whether or not we flagged it here. Badging every shared
    // spelling instead put a badge on 22% of all pages, and a warning that
    // common stops being read as a warning.
    const all = (candidateIds && candidateIds.length ? candidateIds : [chosenId]).filter(
      (id) => ctx.entries[id]
    );
    // A single candidate used to mean "nothing to disambiguate, so nothing to
    // explain". That is true when the match was exact and false when it was a
    // guess at the spelling: ìle matched ilé with exactly one candidate, and so
    // rendered as the most confident link on the page. Doubt now opens the panel
    // whether or not there is a list of alternatives inside it, and the badge
    // reads "?" rather than a count of one.
    if (!o.uncertain || (all.length < 2 && !o.note)) return `<span class="pill-group">${pill}</span>`;

    const panelId = `pill-alts-${++pillGroupSeq}`;
    const rows = all
      .map((id) => {
        const alt = ctx.entries[id];
        return `<a class="sibling-row${id === chosenId ? ' current' : ''}" href="${ctx.pathFor(id)}">
          <span class="sibling-word" lang="yo">${escapeHtml(alt.canonicalForm.value)}</span>
          <span class="sibling-meta">${escapeHtml(alt.pos || '')}${alt.etymologyNumber ? ` · etym. ${escapeHtml(alt.etymologyNumber)}` : ''}</span>
          <span class="sibling-gloss">${escapeHtml(firstGloss(alt))}</span>
        </a>`;
      })
      .join('');

    return `<span class="pill-group has-alts">
      ${pill}
      <button type="button" class="pill-more" aria-expanded="false" aria-controls="${panelId}"
        title="${escapeHtml(o.note || `${all.length} entries share this spelling`)}">${all.length > 1 ? all.length : '?'}</button>
      <span class="pill-alternatives" id="${panelId}" hidden>
        <span class="pill-alternatives-note">${escapeHtml(o.note || `${all.length} entries share this spelling. We link to the first.`)}</span>
        ${rows}
      </span>
    </span>`;
  }

  // Several relations pointing at entries that share a spelling and part of
  // speech render as indistinguishable pills, so they're folded into one
  // group. Relations pointing at different spellings are different words (a
  // compound is derived from each of its components) and keep their own pills.
  function groupBySpelling(items) {
    const groups = new Map();
    for (const item of items || []) {
      const ids = (item.entryIds && item.entryIds.length ? item.entryIds : [item.entryId]).filter(
        (id) => ctx.entries[id]
      );
      if (!ids.length) continue;
      const target = ctx.entries[ids[0]];
      const key = `${target.forms.exact} ${target.pos || ''}`;
      if (!groups.has(key)) {
        groups.set(key, {
          chosen: ids.includes(item.entryId) ? item.entryId : ids[0],
          ids: [],
          resolution: item.resolution,
          matchedBy: item.matchedBy,
          claimedText: item.claimedText,
        });
      }
      const g = groups.get(key);
      for (const id of ids) if (!g.ids.includes(id)) g.ids.push(id);
    }
    return [...groups.values()];
  }

  // A cross-reference we could only match by ignoring tone marks or underdots -
  // which are exactly what tell one Yorùbá word from another. Two things could
  // be true and the data cannot say which: somebody mistyped a word we have, or
  // they correctly named a word nobody has written up yet. Saying so is worth
  // more than picking one, because the second case is a page somebody could go
  // and write.
  /** A relation we could only resolve by ignoring tone marks or underdots. */
  function isLooseMatch(rel) {
    return Boolean(rel.matchedBy) && rel.matchedBy !== 'exact';
  }

  function looseMatchNote(text, targetId, matchedBy) {
    const target = ctx.entries[targetId];
    const what = matchedBy === 'underdot' ? 'underdots' : 'tone marks';
    return (
      `Wiktionary points at “${text}”. No word here is spelled that way, so we have linked ` +
      `“${target.canonicalForm.value}”, which matches once ${what} are ignored. ` +
      `It may be a misspelling, or “${text}” may be a word nobody has written up yet.`
    );
  }

  // The same doubt seen from the other end. On ilé's page the guess was not
  // about lè - that spelling is exact - but about the word lè's own list named,
  // which is the word this page was matched to.
  function looseBackLinkNote(claimedText, sourceId, matchedBy) {
    const source = ctx.entries[sourceId];
    const what = matchedBy === 'underdot' ? 'underdots' : 'tone marks';
    return (
      `“${source.canonicalForm.value}” lists “${claimedText}” as a word built from it. ` +
      `No word here is spelled that way, so this page was matched to it by ignoring ${what}. ` +
      `It may be a misspelling, or “${claimedText}” may be a word nobody has written up yet.`
    );
  }

  function ambiguityNote(count, spelling) {
    return `Wiktionary lists this word under ${count} separate “${spelling}” entries and does not say which one it comes from. Any of these could be the root.`;
  }

  // Why a component word links where it does. Only ever shown when we
  // couldn't settle it, so it never has to explain a pick that was right.
  function morphemeNote(morpheme, count) {
    const spelling = morpheme.form;
    if (morpheme.chosenBy === 'meaningTied') {
      return `${count} entries are spelled “${spelling}”. The etymology calls it “${morpheme.gloss}”, but that isn't enough to tell them apart — we've linked to the first.`;
    }
    return `${count} entries are spelled “${spelling}”, and the etymology doesn't say which one this word is built from — we've linked to the first.`;
  }

  // One section, two sources. A word lands here because an editor typed it into
  // a Wiktionary `derived` list, or because some entry's etymology decomposes to
  // this one, or - 499 times, across 218 pages - both, which used to print the
  // same word twice on one page under two headings.
  //
  // Where the two agree, the word is rendered once, as a plain pill. The ↺ means
  // "we worked this out, Wiktionary didn't say it", and on a word Wiktionary
  // *did* say it is simply false - agreement between the two sources is the
  // strongest evidence on the page, so it should not be the thing wearing the
  // inferred mark. What survives is the synthesized group's own resolution: it
  // knows which meaning the compound was built from, and its note counts the
  // distinct words sharing a spelling. Handing those 514 pills wholesale to the
  // declared list instead would print a doubt badge on 66 links etymology had
  // already settled, and point 34 of them at a different entry.
  function relationPillsHtml(list, extraSynthesized, currentEntry) {
    const selfId = currentEntry ? currentEntry.id : null;
    const synthesized = [];
    const claimedIds = new Set();
    const claimedForms = new Set();

    // What the declared list vouches for, read before anything renders, because
    // a synthesized pill has to know whether it was corroborated before it can
    // decide how to draw itself.
    const declaredIds = new Set();
    const declaredForms = new Set();
    for (const rel of list || []) {
      if (rel.type === 'external_link' || rel.foreign) continue;
      const ids = (rel.entryIds || []).filter((id) => ctx.entries[id] && id !== selfId);
      if (ids.length) for (const id of ids) declaredIds.add(id);
      else if (rel.text) declaredForms.add(rel.text);
    }

    for (const group of groupBySpelling(extraSynthesized)) {
      const ids = group.ids.filter((id) => id !== selfId);
      if (!ids.length) continue;
      const chosen = ids.includes(group.chosen) ? group.chosen : ids[0];
      const spelling = ctx.entries[chosen].forms.exact;
      // Two different reasons a group holds more than one entry, and only one
      // of them is doubt. A "Derived from" group is competing readings of a
      // single claim, settled or not (resolution.method). A "Used in" group is
      // several genuinely distinct compounds that happen to share a spelling —
      // nothing is uncertain there, but collapsing them would hide real words,
      // so the count has to stay.
      const method = group.resolution && group.resolution.method;
      // Two independent doubts, and the rule used to see only one. "Which of
      // these same-spelled words?" is answered by the candidate count. "Is this
      // the right word at all?" is answered by how the spelling matched, and a
      // loose match with a single candidate scored as the most certain link on
      // the page - the rule inverted on exactly the case that needed the badge.
      const loose = group.matchedBy && group.matchedBy !== 'exact';
      const uncertain =
        loose || (ids.length > 1 && method !== 'glossOverlap' && method !== 'unique');
      const corroborated = ids.some((id) => declaredIds.has(id)) || declaredForms.has(spelling);
      for (const id of ids) claimedIds.add(id);
      claimedForms.add(spelling);
      synthesized.push({
        sort: spelling,
        html: ambiguityPillHtml(chosen, ids, {
          synthesized: !corroborated,
          uncertain,
          note: loose
            ? looseBackLinkNote(group.claimedText, chosen, group.matchedBy)
            : method
              ? ambiguityNote(ids.length, spelling)
              : `${ids.length} different words are spelled “${spelling}”, and this word is part of each of them.`,
        }),
      });
    }

    const declared = [];
    for (const rel of list || []) {
      // Flattened dialect tables used to arrive here as debris, with a
      // synthetic "external_link" item standing in for whatever had been
      // dropped. They're now imported from Wiktionary's own source modules
      // and rendered by renderDialectSynonyms instead, so both are gone.
      if (rel.type === 'external_link') continue;

      // A descendant in another language has no Yoruba entry to link to by
      // definition. It used to be matched against the Yoruba index anyway,
      // which turned English "dodo" into eight Yoruba dòdò pills.
      if (rel.foreign) {
        declared.push({
          sort: rel.text || '',
          html: `<span class="pill-group"><span class="relation-pill foreign">${escapeHtml(rel.text)}${
            rel.lang ? `<span class="pos-hint">${escapeHtml(rel.lang)}</span>` : ''
          }</span></span>`,
        });
        continue;
      }

      if (rel.resolved && rel.entryIds && rel.entryIds.length > 0) {
        const ids = rel.entryIds.filter((id) => ctx.entries[id] && id !== selfId);
        if (!ids.length) continue;
        if (ids.some((id) => claimedIds.has(id))) continue;
        const spelling = ctx.entries[ids[0]].forms.exact;
        const loose = rel.matchedBy && rel.matchedBy !== 'exact';
        // The pill carries Wiktionary's spelling when we had to guess at it.
        // Printing the word we landed on instead is what made "ìle (erection)"
        // read as "ilé, noun" - a word Wiktionary never wrote, under a heading
        // asserting it was built from this meaning, with the one field that
        // disproves it thrown away.
        declared.push({
          sort: loose ? rel.text || spelling : spelling,
          html: ambiguityPillHtml(ids[0], ids, {
            label: loose ? rel.text : undefined,
            hint: loose ? rel.english || undefined : undefined,
            // Nothing in a declared relation list says which homograph is meant,
            // so a multi-candidate one is always a guess.
            uncertain: loose || ids.length > 1,
            note: loose
              ? looseMatchNote(rel.text, ids[0], rel.matchedBy)
              : `${ids.length} entries are spelled “${spelling}”, and the list this came from doesn't say which one is meant — we've linked to the first.`,
          }),
        });
      } else {
        // Matched on the spelling as written, not folded: tone and underdots
        // are what tell ilé from ilẹ̀, so folding them here would silence a
        // different word rather than a duplicate of this one.
        if (claimedForms.has(rel.text)) continue;
        // A word with no entry is still a dead end unless enough other entries
        // name it to be worth a page of its own. 157 of them clear that bar.
        const mentionedHref = mentionedPathFor(rel.text);
        declared.push({
          sort: rel.text || '',
          html: mentionedHref
            ? `<span class="pill-group"><a class="relation-pill unresolved mentioned" href="${mentionedHref}" title="No entry yet - see which words name it">${escapeHtml(rel.text)}</a></span>`
            : `<span class="pill-group"><span class="relation-pill unresolved" title="Not in this dictionary yet">${escapeHtml(rel.text)}</span></span>`,
        });
      }
    }

    // Only a section fed by both sources gets sorted. Stacking every declared
    // pill above every synthesized one would rebuild the split this merge
    // removes - the reader would see one list with a seam down the middle -
    // and sorting the single-source sections would churn their order for
    // nothing.
    const elements = declared.concat(synthesized);
    if (declared.length && synthesized.length) {
      elements.sort((a, b) => a.sort.localeCompare(b.sort, 'yo'));
    }

    return elements.length
      ? `<div class="relation-list">${elements.map((el) => el.html).join('')}</div>`
      : '';
  }

  /** The landing-page path for a word, or '' if it has no page. */
  function mentionedPathFor(text) {
    const byKey = ctx.mentionedByKey || {};
    const key = ctx.orthographyInsensitive(text || '');
    return byKey[key] ? ctx.mentionedPath(byKey[key]) : '';
  }

  // Wiktionary attaches these to a single MEANING, not to the word, so they render
  // with the meaning they belong to. sun's second etymology means both "to roast"
  // and "to burn; to set on fire", and the two have completely different sets:
  // yan and wì against jó, jóná and dáná sun. Pooling them into one list at the
  // bottom of the page - which is all the entry-level sections could ever do -
  // would claim yan is a word for setting fires.
  //
  // Plain-word labels rather than the bottom sections' titles: they say what the
  // relationship is to someone who has never met the word "hypernym". The
  // sense-level derived list is the same relation as the entry's "Used in"
  // section, narrowed to one meaning, so it is worded that way - and the entry
  // section stays a separate block because it holds the words Wiktionary
  // attached to no particular meaning.
  // Each row has two headings: the one used when we matched the spelling letter
  // for letter, and the one used when we had to guess at it. Written out rather
  // than derived by sticking "Possibly" on the front, which produced "Possibly
  // others in the same set".
  const SENSE_RELATION_LABELS = [
    ['synonyms', 'Similar words', 'Possibly similar words'],
    ['antonyms', 'Opposites', 'Possibly opposites'],
    // Named "Used in" like the section at the foot of the page, because it is
    // the same relation - the words built from this one - and only the scope
    // differs: here, the words built from this one meaning. Position already
    // says that, since this row sits inside the definition it belongs to. It
    // was "Built from this meaning", which made one relation answer to two
    // names on a single page, and the front page now teaches "Used in" as one
    // of the two terms an entry uses.
    ['derivedTerms', 'Used in', 'Possibly used in'],
    ['relatedTerms', 'Related words', 'Possibly related words'],
    ['hypernyms', 'A kind of', 'Possibly a kind of'],
    ['hyponyms', 'Kinds of this', 'Possibly kinds of this'],
    ['coordinateTerms', 'Others in the same set', 'Possibly in the same set'],
  ];

  function senseRelationsHtml(sense, entry) {
    const rows = [];
    const row = (label, pills) =>
      pills && rows.push(
        `<div class="sense-relation"><span class="sense-relation-label">${label}</span>${pills}</div>`
      );
    for (const [field, label, unsureLabel] of SENSE_RELATION_LABELS) {
      // `|| []` throughout: an artifact published before sense relations existed
      // has none of these keys, and the site has to keep working against it while
      // the two repos' refresh workflows land hours apart.
      const items = sense[field] || [];
      // Split the same way the sections at the foot of the page are. A doubt
      // badge on the pill is not a substitute for the heading above it: this row
      // sits directly under the definition, which is the most prominent place on
      // the page, and it was the one asserting "built from this meaning" over a
      // spelling we had guessed at while the bottom of the page said "possibly"
      // about the identical doubt.
      const certain = items.filter((r) => !isLooseMatch(r));
      const guessed = items.filter(isLooseMatch);
      row(label, relationPillsHtml(certain, [], entry));
      row(unsureLabel, relationPillsHtml(guessed, [], entry));
    }
    return rows.length ? `<div class="sense-relations">${rows.join('')}</div>` : '';
  }

  // "wì is another word for sun, in its 'to roast' meaning" - the reverse of a
  // link sun declared and wì never did. Naming the meaning is the whole point: sun
  // has eleven of them across seven etymologies, so "listed as a synonym of sun"
  // on its own says almost nothing.
  //
  // The meaning is looked up rather than shipped. The build sends sourceSenseIndex
  // and the browser already holds the source entry.
  function namedByHtml(entry, type) {
    const rows = (entry.synthesizedRelations || []).filter((r) => r.type === type);
    if (!rows.length) return '';
    const items = rows.map((rel) => {
      const source = ctx.entries[rel.entryId];
      if (!source) return '';
      const meaning =
        rel.sourceSenseIndex !== undefined && source.senses[rel.sourceSenseIndex]
          ? (source.senses[rel.sourceSenseIndex].glosses || []).join('; ')
          : '';
      const pill = relationPillsHtml([], [rel], entry);
      return `<div class="named-by-row">${pill}${
        meaning ? `<span class="named-by-meaning">${escapeHtml(meaning)}</span>` : ''
      }</div>`;
    });
    return items.filter(Boolean).join('');
  }

  // 943 entries carry more than one competing etymology, and the sections are
  // flattened into a single list of parts. Where two analyses overlap, the
  // shared part is listed once per analysis: nìtorí is recorded both as
  // ní + ìtorí and as ní + ti + orí, so "ní" appeared twice — once bare and
  // once glossed "on, at" — reading as though the word had five parts, two of
  // them the same. Only the copies are folded together, never two parts that
  // carry different meanings: àmọ̀tẹ́kùn really is à- + mọ̀ + tó ("that") +
  // tó ("is equal to") + ẹkùn, and both tó belong there.
  //
  // Done here rather than in the build because the duplicate is in the source
  // and the pipeline's rule is to supplement it, never to drop from it.
  function foldRepeatedMorphemes(morphemes) {
    const out = [];
    for (const m of morphemes) {
      const twinIndex = out.findIndex(
        (o) => o.form === m.form && !(o.gloss && m.gloss && o.gloss !== m.gloss)
      );
      if (twinIndex === -1) {
        out.push(m);
      } else if (!out[twinIndex].gloss && m.gloss) {
        out[twinIndex] = m; // keep whichever copy actually says what it means
      }
    }
    return out;
  }

  // A word's parts, one line per decomposition. 81 entries record more than
  // one way of breaking the same word down, and they are alternatives rather
  // than parts of a single longer word: nìtorí is ní + ìtorí *or*
  // ní + ti + orí, and mùwé is mọ̀ + ùwé in Èkìtì and Oǹdó *or* mù + ùwé in
  // Ìjẹ̀bú. Run together in one list they read as a four-part word that
  // nobody has ever proposed - and joining them with "+" is what makes the
  // section teach anything, since the structure is the point.
  function morphemesHtml(allMorphemes) {
    const morphemes = allMorphemes || [];
    if (!morphemes.length) return '';

    // Grouping comes from upstream (see kaikki-yoruba's extractEtymologyMorphemes,
    // where it is the only place the template boundaries are still visible).
    // Data published before that lands has no `analysis`, so it keeps the old
    // flat rendering, with repeats folded to hide the worst of the confusion.
    if (morphemes.every((m) => typeof m.analysis === 'number')) {
      const groups = [];
      for (const m of morphemes) {
        const g = groups.find((x) => x.analysis === m.analysis);
        if (g) g.items.push(m);
        else groups.push({ analysis: m.analysis, items: [m] });
      }
      const note =
        groups.length > 1
          ? `<div class="morpheme-note">Wiktionary records ${groups.length} different ways of breaking this word down. Each line is one of them, not a further part.</div>`
          : '';
      return (
        note +
        groups
          .map(
            (g) =>
              `<div class="morpheme-analysis">${g.items
                .map(morphemePillHtml)
                .join('<span class="morpheme-plus" aria-hidden="true">+</span>')}</div>`
          )
          .join('')
      );
    }

    return legacyFlatMorphemesHtml(foldRepeatedMorphemes(morphemes));
  }

  // Exactly one element per morpheme, regardless of how many entries share
  // its spelling: every entryId on a morpheme refers to the SAME text from the
  // SAME etymology template, so one pill per entryId would just repeat
  // identical text. The upstream resolver's tone-exact filter can only narrow
  // to the tone group, never within it, so on a shared spelling this shows one
  // candidate — badged when choosing it was a guess.
  function morphemePillHtml(m) {
    const glossHtml = m.gloss ? `<span class="pos-hint">${escapeHtml(m.gloss)}</span>` : '';
    if (m.bound) {
      return `<span class="pill-group"><span class="relation-pill unresolved" title="Word part — not used on its own">${escapeHtml(m.form)}${glossHtml}</span></span>`;
    }
    if (m.resolved && m.entryIds && m.entryIds.length > 0) {
      const ids = m.entryIds.filter((id) => ctx.entries[id]);
      if (ids.length) {
        const chosen = ids.includes(m.chosenEntryId) ? m.chosenEntryId : ids[0];
        return ambiguityPillHtml(chosen, ids, {
          label: m.form,
          hint: m.gloss || '',
          searchForm: m.form,
          // 'backLink': another entry's own derived list named exactly one of
          // these candidates, which is a second source agreeing, not a guess.
          uncertain:
            ids.length > 1 &&
            m.chosenBy !== 'meaning' &&
            m.chosenBy !== 'anchor' &&
            m.chosenBy !== 'backLink',
          note: morphemeNote(m, ids.length),
        });
      }
    }
    return `<span class="pill-group"><span class="relation-pill unresolved" title="Not yet in this dictionary">${escapeHtml(m.form)}${glossHtml}</span></span>`;
  }

  // Where a Component words pill actually points - the only thing a "Derived
  // from" pill can be redundant with. It mirrors morphemePillHtml's own pick
  // rather than reading chosenEntryId straight off the morpheme, because that
  // field can name an entry this artifact doesn't have and the pill falls back
  // to the first candidate when it does. A set that disagreed with the pills
  // beside it would drop the wrong words.
  function morphemeLinkTargets(entry) {
    const targets = new Set();
    for (const m of entry.etymologyMorphemes || []) {
      if (m.bound || !m.resolved || !m.entryIds) continue;
      const ids = m.entryIds.filter((id) => ctx.entries[id]);
      if (!ids.length) continue;
      targets.add(ids.includes(m.chosenEntryId) ? m.chosenEntryId : ids[0]);
    }
    return targets;
  }

  function legacyFlatMorphemesHtml(morphemes) {
    if (!morphemes.length) return '';
    return `<div class="relation-list">${morphemes.map(morphemePillHtml).join('')}</div>`;
  }

  // Entries sharing an exact, tone-marked spelling are the same written word
  // carrying different senses, and nothing on the page used to say so - you
  // could read one of eleven dá entries and never learn the other ten existed.
  function siblingsHtml(entry) {
    const ids = (entry.siblingEntryIds || []).filter((id) => ctx.entries[id]);
    if (!ids.length) return '';
    const rows = ids
      .map((id) => {
        const s = ctx.entries[id];
        return `<a class="sibling-row" href="${ctx.pathFor(id)}">
          <span class="sibling-word" lang="yo">${escapeHtml(s.canonicalForm.value)}</span>
          <span class="sibling-meta">${escapeHtml(s.pos || '')}${s.etymologyNumber ? ` · etym. ${escapeHtml(s.etymologyNumber)}` : ''}</span>
          <span class="sibling-gloss">${escapeHtml(firstGloss(s))}</span>
        </a>`;
      })
      .join('');
    return `<div class="sibling-note">Wiktionary records ${ids.length + 1} entries spelled “${escapeHtml(entry.canonicalForm.value)}”. You're reading one of them; here are the others.</div>
      <div class="sibling-list">${rows}</div>`;
  }

  function section(title, innerHtml, infoHtml) {
    if (!innerHtml) return '';
    if (!infoHtml) {
      return `<div class="entry-section">
        <div class="entry-section-title">${escapeHtml(title)}</div>
        ${innerHtml}
      </div>`;
    }
    // A heading that needs explaining gets a button, not a title= tooltip:
    // hover doesn't exist on a phone, and this is the section people are most
    // likely to disbelieve.
    const noteId = `section-info-${++pillGroupSeq}`;
    return `<div class="entry-section">
      <div class="entry-section-title">
        ${escapeHtml(title)}
        <button type="button" class="info-toggle" aria-expanded="false" aria-controls="${noteId}"
          aria-label="Why is this uncertain?">i</button>
      </div>
      <div class="info-note" id="${noteId}" hidden>${infoHtml}</div>
      ${innerHtml}
    </div>`;
  }

  function entryHtml(entry) {
    const ipaHtml = entry.ipa.length
      ? entry.ipa.map((s) => `<span class="entry-ipa">${escapeHtml(s.ipa)}</span>${s.note ? ` <span class="sense-tag">${escapeHtml(s.note)}</span>` : ''}`).join('  ')
      : '';

    const inferredBadge = entry.canonicalForm.inferenceMethod !== 'explicit_canonical_tag'
      ? `<span class="entry-inferred-badge" title="Wiktionary didn't mark which spelling is the main one, so we show its own spelling as-is (“${escapeHtml(entry.canonicalForm.originalValue)}”).">spelling unconfirmed</span>`
      : '';

    const sensesHtml = entry.senses.length
      ? `<ol class="sense-list">${entry.senses.map((sense) => `
          <li class="sense-item">
            <span class="sense-gloss">${escapeHtml((sense.glosses || []).join('; '))}</span>
            ${sense.tags && sense.tags.length ? `<span class="sense-tags">${sense.tags.map((t) => `<span class="sense-tag">${escapeHtml(t)}</span>`).join('')}</span>` : ''}
            ${(sense.examples || []).map((ex) => `
              <div class="sense-example">
                ${ex.text ? `<span class="yo-text">${escapeHtml(ex.text)}</span>` : ''}
                ${ex.translation ? `<span class="en-text">${escapeHtml(ex.translation)}</span>` : ''}
              </div>
            `).join('')}
            ${senseRelationsHtml(sense, entry)}
          </li>
        `).join('')}</ol>`
      : '';

    const altFormsHtml = entry.altForms && entry.altForms.length
      ? `<div class="alt-forms">${entry.altForms.map((f) => `<span lang="yo">${escapeHtml(f.form)}</span>${f.tags.length ? ` <span class="form-tag">(${escapeHtml(f.tags.join(', '))})</span>` : ''}`).join(', ')}</div>`
      : '';

    const etymologyHtml = entry.etymologyText
      ? `<div class="etymology-text">${escapeHtml(entry.etymologyText)}</div>`
      : '';
    const morphemesHtmlStr = morphemesHtml(entry.etymologyMorphemes);

    const dialectHtml = dialectSynonymsHtml(entry);
    const dialectOfHtml = dialectOfHtmlFor(entry);
    const relatedHtml = relationPillsHtml(entry.relatedTerms, [], entry);
    const synonymsHtml = relationPillsHtml(entry.synonyms, [], entry);
    const antonymsHtml = relationPillsHtml(entry.antonyms, [], entry);
    const descendantsHtml = relationPillsHtml(entry.descendants, [], entry);
    // A word's parts and the words that claim it are one fact from two sides,
    // and 489 of the 586 "Derived from" items on a page that also decomposes
    // named an entry a Component words pill already linked - the same word, the
    // same meaning, twice on one page.
    //
    // Dropped only where the two point at the same entry. A back-link naming a
    // different meaning of the same spelling is a second reading, not a repeat,
    // and keeping it is the whole reason the section still exists - along with
    // the intermediate steps (ìwúre decomposes to ì- + wú + ire and is derived
    // from wúre) and the words whose decomposition we don't have at all.
    const componentTargets = morphemeLinkTargets(entry);
    const derivedFromAll = (entry.synthesizedRelations || [])
      .filter((r) => r.type === 'derivedFrom')
      .filter((r) => !componentTargets.has(r.entryId));
    const derivedFromHtml = relationPillsHtml([], derivedFromAll.filter((r) => !isLooseMatch(r)), entry);
    const maybeDerivedFromHtml = relationPillsHtml([], derivedFromAll.filter(isLooseMatch), entry);
    const maybeDerivedFromNote = `
      <p>Each of these pages lists a word as built from it, spelled a little differently from this one — a different tone mark, or an underdot this word doesn't have.</p>
      <p>Tone and underdots are what tell two Yorùbá words apart, so we can't say whether the other page meant this word and mistyped it, or meant a word that has no page here yet.</p>
      <p>Writing that word up on Wiktionary settles it. <a href="${ctx.pagePath('contribute')}">How to help</a>.</p>`;
    const coordinateHtml = relationPillsHtml(entry.coordinateTerms || [], [], entry);
    const hyponymsHtml = relationPillsHtml(entry.hyponyms || [], [], entry);
    const hypernymsHtml = relationPillsHtml(entry.hypernyms || [], [], entry);
    // The other side of a link this word never declared. Kept apart from the
    // declared Synonyms/Antonyms sections so the page never presents something we
    // worked out as something the source said.
    const namedSynonymHtml = namedByHtml(entry, 'synonyms');
    const namedAntonymHtml = namedByHtml(entry, 'antonyms');
    const namedByNote = `
      <p>These words list this one in their own definitions. This word does not list them back, so Wiktionary records the link in one direction only.</p>
      <p>The meaning shown next to each is the one that named this word.</p>`;
    // Both lists answer the reader's one question - what other words is this
    // word part of - and differ only in where the answer came from, which is
    // our bookkeeping and not theirs. Two headings made them look like two
    // different facts, and put 499 words on the page twice.
    // Wiktionary's own list splits by how well the spelling matched. An entry it
    // names outright belongs beside the etymology evidence in "Used in"; one we
    // could only reach by ignoring tone or underdots is a guess about which word
    // was meant, which is the doubt "Possibly used in" already exists to hold.
    const declaredUsedIn = entry.derivedTerms || [];
    const usedInHtml = relationPillsHtml(
      declaredUsedIn.filter((r) => !isLooseMatch(r)),
      entry.usedInCompounds || [],
      entry
    );
    const maybeUsedInHtml = relationPillsHtml(
      declaredUsedIn.filter(isLooseMatch),
      entry.possiblyUsedIn || [],
      entry
    );
    // Two different doubts under one heading, because they answer one question -
    // what might this word be part of? Which doubt applies is on each pill.
    const maybeUsedInNote = `
      <p>We are not certain about these, for one of two reasons.</p>
      <p>Wiktionary says some of them were built from a word spelled like this one, without saying which meaning, so we show each under every meaning it could have come from.</p>
      <p>The rest are spelled a little differently from anything here — a tone mark or an underdot apart — so we cannot tell a misspelling of this word from a word that has no page yet.</p>
      <p>Both are fixable on Wiktionary, one word at a time. <a href="${ctx.pagePath('contribute')}">How to help</a>.</p>`;
    const siblingsHtmlStr = siblingsHtml(entry);

    return `
      <div class="entry-header">
        <span class="entry-headword" lang="yo">${escapeHtml(entry.canonicalForm.value)}</span>
        ${entry.pos ? `<span class="entry-pos">${escapeHtml(entry.pos)}</span>` : ''}
        ${ipaHtml}
        ${inferredBadge}
      </div>
      ${altFormsHtml}
      <div class="tone-rule divider" aria-hidden="true"><span></span><span></span><span></span></div>

      ${section('Definitions', sensesHtml)}
      ${section('Other entries with this spelling', siblingsHtmlStr)}
      ${dialectOfHtml}
      ${section('Etymology', etymologyHtml)}
      ${section('Component words', morphemesHtmlStr)}
      ${dialectHtml}
      ${section('Used in', usedInHtml)}
      ${section('Possibly used in', maybeUsedInHtml, maybeUsedInNote)}
      ${section('Derived from', derivedFromHtml)}
      ${section('Possibly derived from', maybeDerivedFromHtml, maybeDerivedFromNote)}
      ${section('Related terms', relatedHtml)}
      ${section('Synonyms', synonymsHtml)}
      ${section('Antonyms', antonymsHtml)}
      ${section('Listed as a similar word by', namedSynonymHtml, namedByNote)}
      ${section('Listed as an opposite by', namedAntonymHtml, namedByNote)}
      ${section('A kind of', hypernymsHtml)}
      ${section('Kinds of this', hyponymsHtml)}
      ${section('Others in the same set', coordinateHtml)}
      ${section('Descendants', descendantsHtml)}

      <div class="entry-provenance-note">
        Source: Wiktionary${entry.etymologyNumber ? ` · etymology ${escapeHtml(entry.etymologyNumber)}` : ''},
        where this word is spelled “${escapeHtml(entry.headword)}”.
        Reference: <code>${escapeHtml(entry.id)}</code>
      </div>
    `;
  }

  /** The browser-tab title, and the <title> of the prerendered page. */
  function titleFor(entry) {
    return `${entry.canonicalForm.value} — Sọ̀rọ̀ Sókè`;
  }
  return {
    entryHtml,
    titleFor,
    section,
    escapeHtml,
    firstGloss,
    relationPillsHtml,
    mentionedPathFor,
    ambiguityPillHtml,
    dialectSynonymsHtml,
  };
}
