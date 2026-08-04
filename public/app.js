// public/app.js
//
// Runtime responsibilities (per spec section 3.2): load the prebuilt
// browser-ready assets, perform all searches locally, render entries,
// navigate between entries. No network requests after initial load.

(function () {
  'use strict';

  const state = {
    entries: null,
    index: null,
    validation: null,
    buildingBlocks: null,
    tasks: null,
    activeResults: [],
    activeIndex: -1,
    searchMode: 'both', // 'both', 'yoruba', or 'english'
    // The dictionary is ~1.7 MB gzipped and the whole app is unusable without
    // it, but the page around it isn't - see boot().
    ready: false,
  };

  const els = {
    searchInput: document.getElementById('search-input'),
    resultsList: document.getElementById('results-list'),
    entryContent: document.getElementById('entry-content'),
    entryPane: document.getElementById('entry-pane'),
    sheetHandle: document.getElementById('sheet-handle'),
    header: document.querySelector('.site-header'),
    menuToggle: document.getElementById('menu-toggle'),
    headerMenu: document.getElementById('header-menu'),
    modeCycle: document.getElementById('mode-cycle'),
    qualityToggle: document.getElementById('data-quality-toggle'),
    qualityPanel: document.getElementById('quality-panel'),
    qualityClose: document.getElementById('quality-close'),
    qualityContent: document.getElementById('quality-content'),
  };

  // ---------------------------------------------------------------
  // Orthography normalization (mirrors build/lib/orthography.mjs —
  // the browser must apply the exact same rules to the user's query
  // as the build pipeline applied to the headwords, or the tiers
  // won't line up).
  // ---------------------------------------------------------------

  const TONE_MARKS = /[\u0300\u0301\u0302\u0304]/g;
  const UNDERDOT_MARKS = /[\u0323\u0307]/g;

  function toneInsensitive(s) {
    return s.normalize('NFD').replace(TONE_MARKS, '').normalize('NFC').toLowerCase();
  }
  function orthographyInsensitive(s) {
    return s
      .normalize('NFD')
      .replace(TONE_MARKS, '')
      .replace(UNDERDOT_MARKS, '')
      .normalize('NFC')
      .toLowerCase();
  }

  // ---------------------------------------------------------------
  // Sorted-array search helpers (binary search for exact + prefix)
  // ---------------------------------------------------------------

  function lowerBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function exactMatch(tier, query) {
    const i = lowerBound(tier.spellings, query);
    if (i < tier.spellings.length && tier.spellings[i] === query) {
      return tier.postings[tier.spellings[i]];
    }
    return [];
  }

  function prefixMatches(tier, prefix, limit) {
    const start = lowerBound(tier.spellings, prefix);
    const results = [];
    for (let i = start; i < tier.spellings.length; i++) {
      const spelling = tier.spellings[i];
      if (!spelling.startsWith(prefix)) break;
      for (const id of tier.postings[spelling]) results.push(id);
      if (results.length >= limit) break;
    }
    return results;
  }

  // ---------------------------------------------------------------
  // English BM25 scoring over the prebuilt inverted index
  // ---------------------------------------------------------------

  function bm25Search(query, limit) {
    const eng = state.index.english;
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((t) => t.length > 1);
    if (tokens.length === 0) return [];

    const k1 = 1.5, b = 0.75;
    const scores = new Map();

    for (const tok of tokens) {
      const postings = eng.postings[tok];
      if (!postings) continue;
      const df = eng.df[tok] || postings.length;
      const idf = Math.log(1 + (eng.totalDocs - df + 0.5) / (df + 0.5));
      for (const [docId, tf] of postings) {
        const docLen = eng.docLengths[docId] || 1;
        const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (docLen / eng.avgDocLength)));
        scores.set(docId, (scores.get(docId) || 0) + idf * norm);
      }
    }

    return [...scores.entries()]
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  // ---------------------------------------------------------------
  // Combined ranking (spec section 7):
  //   1. exact Yoruba match
  //   2. tone-insensitive match
  //   3. orthography-insensitive match
  //   4. prefix matches
  //   5. English full-text matches
  // Deterministic: dedupes by id, preserving first-seen tier order.
  // ---------------------------------------------------------------

  function search(query, limit = 40) {
    const trimmed = query.trim();
    if (!trimmed || !state.ready) return [];

    const seen = new Set();
    const ordered = [];
    const push = (ids) => {
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          ordered.push(id);
        }
      }
    };

    const mode = state.searchMode;
    const y = state.index.yoruba;

    // Why the dialect tier is last among the Yorùbá tiers: it matches a word
    // that a *variety* uses and returns the standard entry it belongs to, so
    // it must never outrank a real headword. It's Yorùbá, so it belongs to the
    // YO scope and is skipped when only EN is lit.
    state.dialectMatches = new Map();

    // 1. Yorùbá Search Path
    if (mode === 'both' || mode === 'yoruba') {
      push(exactMatch(y.exact, trimmed));
      push(exactMatch(y.tone, toneInsensitive(trimmed)));
      push(exactMatch(y.ortho, orthographyInsensitive(trimmed)));
      push(prefixMatches(y.ortho, orthographyInsensitive(trimmed), limit));
      push(dialectMatches(y.dialect, orthographyInsensitive(trimmed), limit));
    }

    // 2. English Search Path
    if (mode === 'both' || mode === 'english') {
      push(bm25Search(trimmed, limit));
    }

    return ordered.slice(0, limit).map((id) => state.entries[id]);
  }

  // Exact then prefix over the dialect tier. Records which varieties produced
  // each hit in state.dialectMatches, so a result row can say why it appeared
  // rather than looking like an unrelated word.
  function dialectMatches(tier, query, limit) {
    if (!tier || !query) return [];
    const ids = [];
    const start = lowerBound(tier.spellings, query);
    for (let i = start; i < tier.spellings.length; i++) {
      const spelling = tier.spellings[i];
      if (!spelling.startsWith(query)) break;
      for (const posting of tier.postings[spelling]) {
        if (!state.dialectMatches.has(posting.id)) state.dialectMatches.set(posting.id, new Set());
        for (const v of posting.varieties) state.dialectMatches.get(posting.id).add(v);
        ids.push(posting.id);
      }
      if (ids.length >= limit) break;
    }
    return ids;
  }

  // ---------------------------------------------------------------
  // Rendering: results list
  // ---------------------------------------------------------------

  function firstGloss(entry) {
    for (const sense of entry.senses) {
      if (sense.glosses && sense.glosses[0]) return sense.glosses[0];
    }
    return '';
  }

  function renderResults(results) {
    state.activeResults = results;
    state.activeIndex = -1;
    els.resultsList.innerHTML = '';

    if (results.length === 0) {
      // Both messages are scope-specific — see MODE_UI.
      const ui = MODE_UI[state.searchMode];
      const typed = els.searchInput.value.trim();
      // "No words found" would be a lie while the dictionary is still on its
      // way; the search runs again by itself once it lands.
      const message = !typed
        ? `<div class="results-hint">${escapeHtml(ui.hint)}</div>`
        : state.ready
          ? `<div class="results-empty">${escapeHtml(ui.empty)}</div>`
          : '<div class="results-hint">Loading the dictionary… your search will run as soon as it’s here.</div>';
      els.resultsList.innerHTML = message;
      els.resultsList.removeAttribute('role');
      return;
    }
    els.resultsList.setAttribute('role', 'listbox');

    results.forEach((entry, i) => {
      const btn = document.createElement('button');
      btn.className = 'result-item';
      btn.setAttribute('role', 'option');
      btn.dataset.index = String(i);
      // A dialect-tier hit isn't a spelling of this headword - it's a word a
      // variety uses for it - so the row says which varieties matched instead
      // of leaving an apparently unrelated result unexplained.
      const varieties = state.dialectMatches?.get(entry.id);
      const dialectNote = varieties
        ? `<div class="result-dialect">${escapeHtml([...varieties].slice(0, 3).join(' · '))}${varieties.size > 3 ? ` +${varieties.size - 3}` : ''}</div>`
        : '';

      btn.innerHTML = `
        <div class="result-headword">${escapeHtml(entry.canonicalForm.value)}</div>
        <div class="result-meta">${escapeHtml(entry.pos || '')}${entry.etymologyNumber ? ' · etym. ' + escapeHtml(entry.etymologyNumber) : ''}</div>
        <div class="result-gloss">${escapeHtml(firstGloss(entry))}</div>
        ${dialectNote}
      `;
      btn.addEventListener('click', () => navigateTo(entry.id));
      els.resultsList.appendChild(btn);
    });
  }

  function highlightActive() {
    const buttons = els.resultsList.querySelectorAll('.result-item');
    buttons.forEach((b, i) => {
      b.classList.toggle('active', i === state.activeIndex);
      if (i === state.activeIndex) b.scrollIntoView({ block: 'nearest' });
    });
  }

  // ---------------------------------------------------------------
  // Rendering: entry detail
  // ---------------------------------------------------------------

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------------------------------------------------------------
  // Dialect synonyms
  //
  // Imported from Wiktionary's own Module:dialect synonyms/yo/<term> rather
  // than recovered from Kaikki's flattened rendering of the same table (which
  // is unrecoverable - see kaikki-yoruba/src/lib/relationDebris.mjs). Grouped
  // by the variety hierarchy the source defines, and collapsed by default:
  // some entries list well over a hundred varieties, which would otherwise
  // bury the definition.
  // ---------------------------------------------------------------

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
      const target = state.entries[rel.entryId];
      if (!target) return '';
      const varieties = (rel.varieties || []).join(', ');
      return `
        <div class="dialect-of-line">
          <span class="dialect-of-varieties">${escapeHtml(varieties)}</span>
          <span class="dialect-of-verb">dialect form of</span>
          <a class="relation-pill" href="#/entry/${encodeURIComponent(rel.entryId)}">
            ${escapeHtml(target.canonicalForm.value)}
            <span class="pos-hint">${escapeHtml(target.pos || '')}</span>
          </a>
        </div>
      `;
    }).filter(Boolean).join('');

    return lines ? section('Dialect', `<div class="dialect-of">${lines}</div>`) : '';
  }

  // A pill stands for one word, not one database row. Where several entries
  // share a spelling we have to pick one to link to, and that pick is
  // frequently a guess: 20 of the 24 ambiguous "Derived from" groups can't be
  // resolved from anything Wiktionary records, and every "Component words"
  // pill over a shared spelling is showing you the first candidate. Rendering
  // one pill per entry instead just repeated identical text (ìdá showed ten
  // identical "dá verb" pills); rendering one pill and saying nothing hides a
  // wrong guess behind a confident link. So: one pill, with every alternative
  // reachable from it and the reason we're unsure stated in words.
  let pillGroupSeq = 0;

  function ambiguityPillHtml(chosenId, candidateIds, opts) {
    const o = opts || {};
    const target = state.entries[chosenId];
    if (!target) return '';

    const label = o.label != null ? o.label : target.canonicalForm.value;
    const hint = o.hint != null ? o.hint : target.pos || '';
    const cls = o.synthesized ? 'relation-pill synthesized' : 'relation-pill';
    const searchAttr = o.searchForm ? ` data-search-form="${escapeHtml(o.searchForm)}"` : '';
    const pill =
      `<a class="${cls}" href="#/entry/${encodeURIComponent(chosenId)}"${searchAttr}>${escapeHtml(label)}` +
      `${hint ? `<span class="pos-hint">${escapeHtml(hint)}</span>` : ''}</a>`;

    // A badge marks doubt, not homography. Where we had evidence and it
    // settled the question, the pill is a plain link: if it's still wrong,
    // the entry it lands on lists its own siblings, so the way back exists on
    // every page whether or not we flagged it here. Badging every shared
    // spelling instead put a badge on 22% of all pages, and a warning that
    // common stops being read as a warning.
    const all = (candidateIds && candidateIds.length ? candidateIds : [chosenId]).filter(
      (id) => state.entries[id]
    );
    if (all.length < 2 || !o.uncertain) return `<span class="pill-group">${pill}</span>`;

    const panelId = `pill-alts-${++pillGroupSeq}`;
    const rows = all
      .map((id) => {
        const alt = state.entries[id];
        return `<a class="sibling-row${id === chosenId ? ' current' : ''}" href="#/entry/${encodeURIComponent(id)}">
          <span class="sibling-word">${escapeHtml(alt.canonicalForm.value)}</span>
          <span class="sibling-meta">${escapeHtml(alt.pos || '')}${alt.etymologyNumber ? ` · etym. ${escapeHtml(alt.etymologyNumber)}` : ''}</span>
          <span class="sibling-gloss">${escapeHtml(firstGloss(alt))}</span>
        </a>`;
      })
      .join('');

    return `<span class="pill-group has-alts">
      ${pill}
      <button type="button" class="pill-more" aria-expanded="false" aria-controls="${panelId}"
        title="${escapeHtml(o.note || `${all.length} entries share this spelling`)}">${all.length}</button>
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
        (id) => state.entries[id]
      );
      if (!ids.length) continue;
      const target = state.entries[ids[0]];
      const key = `${target.forms.exact} ${target.pos || ''}`;
      if (!groups.has(key)) {
        groups.set(key, { chosen: ids.includes(item.entryId) ? item.entryId : ids[0], ids: [], resolution: item.resolution });
      }
      const g = groups.get(key);
      for (const id of ids) if (!g.ids.includes(id)) g.ids.push(id);
    }
    return [...groups.values()];
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

  function relationPillsHtml(list, extraSynthesized, currentEntry) {
    const elements = [];
    const selfId = currentEntry ? currentEntry.id : null;

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
        elements.push(`<span class="pill-group"><span class="relation-pill foreign">${escapeHtml(rel.text)}${
          rel.lang ? `<span class="pos-hint">${escapeHtml(rel.lang)}</span>` : ''
        }</span></span>`);
        continue;
      }

      if (rel.resolved && rel.entryIds && rel.entryIds.length > 0) {
        const ids = rel.entryIds.filter((id) => state.entries[id] && id !== selfId);
        if (!ids.length) continue;
        const spelling = state.entries[ids[0]].forms.exact;
        // Nothing in a declared relation list says which homograph is meant,
        // so a multi-candidate one is always a guess.
        elements.push(
          ambiguityPillHtml(ids[0], ids, {
            uncertain: ids.length > 1,
            note: `${ids.length} entries are spelled “${spelling}”, and the list this came from doesn't say which one is meant — we've linked to the first.`,
          })
        );
      } else {
        elements.push(`<span class="pill-group"><span class="relation-pill unresolved" title="Not in this dictionary yet">${escapeHtml(rel.text)}</span></span>`);
      }
    }

    for (const group of groupBySpelling(extraSynthesized)) {
      const ids = group.ids.filter((id) => id !== selfId);
      if (!ids.length) continue;
      const chosen = ids.includes(group.chosen) ? group.chosen : ids[0];
      const spelling = state.entries[chosen].forms.exact;
      // Two different reasons a group holds more than one entry, and only one
      // of them is doubt. A "Derived from" group is competing readings of a
      // single claim, settled or not (resolution.method). A "Used in" group is
      // several genuinely distinct compounds that happen to share a spelling —
      // nothing is uncertain there, but collapsing them would hide real words,
      // so the count has to stay.
      const method = group.resolution && group.resolution.method;
      const uncertain = ids.length > 1 && method !== 'glossOverlap' && method !== 'unique';
      elements.push(
        ambiguityPillHtml(chosen, ids, {
          synthesized: true,
          uncertain,
          note: method
            ? ambiguityNote(ids.length, spelling)
            : `${ids.length} different words are spelled “${spelling}”, and this word is part of each of them.`,
        })
      );
    }

    return elements.length ? `<div class="relation-list">${elements.join('')}</div>` : '';
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
      const ids = m.entryIds.filter((id) => state.entries[id]);
      if (ids.length) {
        const chosen = ids.includes(m.chosenEntryId) ? m.chosenEntryId : ids[0];
        return ambiguityPillHtml(chosen, ids, {
          label: m.form,
          hint: m.gloss || '',
          searchForm: m.form,
          uncertain: ids.length > 1 && m.chosenBy !== 'meaning' && m.chosenBy !== 'anchor',
          note: morphemeNote(m, ids.length),
        });
      }
    }
    return `<span class="pill-group"><span class="relation-pill unresolved" title="Not yet in this dictionary">${escapeHtml(m.form)}${glossHtml}</span></span>`;
  }

  function legacyFlatMorphemesHtml(morphemes) {
    if (!morphemes.length) return '';
    return `<div class="relation-list">${morphemes.map(morphemePillHtml).join('')}</div>`;
  }

  // Entries sharing an exact, tone-marked spelling are the same written word
  // carrying different senses, and nothing on the page used to say so - you
  // could read one of eleven dá entries and never learn the other ten existed.
  function siblingsHtml(entry) {
    const ids = (entry.siblingEntryIds || []).filter((id) => state.entries[id]);
    if (!ids.length) return '';
    const rows = ids
      .map((id) => {
        const s = state.entries[id];
        return `<a class="sibling-row" href="#/entry/${encodeURIComponent(id)}">
          <span class="sibling-word">${escapeHtml(s.canonicalForm.value)}</span>
          <span class="sibling-meta">${escapeHtml(s.pos || '')}${s.etymologyNumber ? ` · etym. ${escapeHtml(s.etymologyNumber)}` : ''}</span>
          <span class="sibling-gloss">${escapeHtml(firstGloss(s))}</span>
        </a>`;
      })
      .join('');
    return `<div class="sibling-note">Wiktionary records ${ids.length + 1} entries spelled “${escapeHtml(entry.canonicalForm.value)}”. You're reading one of them; here are the others.</div>
      <div class="sibling-list">${rows}</div>`;
  }

  function section(title, innerHtml) {
    if (!innerHtml) return '';
    return `<div class="entry-section">
      <div class="entry-section-title">${escapeHtml(title)}</div>
      ${innerHtml}
    </div>`;
  }

  function renderEntry(entry) {
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
          </li>
        `).join('')}</ol>`
      : '';

    const altFormsHtml = entry.altForms && entry.altForms.length
      ? `<div class="alt-forms">${entry.altForms.map((f) => `${escapeHtml(f.form)}${f.tags.length ? ` <span class="form-tag">(${escapeHtml(f.tags.join(', '))})</span>` : ''}`).join(', ')}</div>`
      : '';

    const etymologyHtml = entry.etymologyText
      ? `<div class="etymology-text">${escapeHtml(entry.etymologyText)}</div>`
      : '';
    const morphemesHtmlStr = morphemesHtml(entry.etymologyMorphemes);

    const dialectHtml = dialectSynonymsHtml(entry);
    const dialectOfHtml = dialectOfHtmlFor(entry);
    const derivedHtml = relationPillsHtml(entry.derivedTerms, [], entry);
    const relatedHtml = relationPillsHtml(entry.relatedTerms, [], entry);
    const synonymsHtml = relationPillsHtml(entry.synonyms, [], entry);
    const antonymsHtml = relationPillsHtml(entry.antonyms, [], entry);
    const descendantsHtml = relationPillsHtml(entry.descendants, [], entry);
    const derivedFromHtml = relationPillsHtml(
      [],
      (entry.synthesizedRelations || []).filter((r) => r.type === 'derivedFrom'),
      entry
    );
    const usedInHtml = relationPillsHtml([], entry.usedInCompounds || [], entry);
    const siblingsHtmlStr = siblingsHtml(entry);

    els.entryContent.innerHTML = `
      <div class="entry-header">
        <span class="entry-headword">${escapeHtml(entry.canonicalForm.value)}</span>
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
      ${section('Derived terms', derivedHtml)}
      ${section('Derived from', derivedFromHtml)}
      ${section('Related terms', relatedHtml)}
      ${section('Synonyms', synonymsHtml)}
      ${section('Antonyms', antonymsHtml)}
      ${section('Descendants', descendantsHtml)}

      <div class="entry-provenance-note">
        Source: Wiktionary${entry.etymologyNumber ? ` · etymology ${escapeHtml(entry.etymologyNumber)}` : ''},
        where this word is spelled “${escapeHtml(entry.headword)}”.
        Reference: <code>${escapeHtml(entry.id)}</code>
      </div>
    `;

    document.title = `${entry.canonicalForm.value} — Sọ̀rọ̀ Sókè`;
  }

  function renderWelcome() {
    els.entryContent.innerHTML = `
      <div class="entry-welcome">
        <h1>Ẹ káàbọ̀.</h1>
        <p>Search for a Yorùbá word with or without tone marks and underdots. Or search by an English word that appears in a definition. Everything runs locally in your browser after the first load.</p>
        <p>Try: <em>fa</em>, <em>de</em>, <em>ile</em>, or <em>pull</em>.</p>
      </div>
    `;
    document.title = 'Sọ̀rọ̀ Sókè — The People’s Yorùbá Dictionary · Speak Nigeria';
  }

  function renderAbout() {
    els.entryContent.innerHTML = `
      <div class="about-content">
        <h1>About the Dictionary</h1>
        <p class="about-lede">Wiktionary's crowdsourced Yorùbá dictionary is one of the best resources online for learning Yorùbá. Not only does it have more defined words than most Yorùbá dictionaries, but it also includes details of how longer words are constructed from shorter words. Learning to recognize these compound words is a core part of learning the language. The Wiktionary website itself, though, is poorly matched to language learners, whether in terms of quick single-word lookups or language exploration. This project keeps the data and rebuilds the user experience.</p>

        <h2>Why care about etymology?</h2>
        <p>We can build a deep, comprehensive, and growing dictionary through the use of Wiktionary. We hope to not only make it easier to navigate, but encourage people to contribute — if you can't find a word in our dictionary, add it to Wiktionary! Beyond that, Yorùbá is fundamentally different from English in how it builds larger words out of smaller building-block words. People often think of etymology as an academic curiosity, but in languages like Yorùbá, being able to recognize compound words is part of fluency. It's also fun — one of the things students in our own classes love most about the language is learning how words combine to create new ones. Wiktionary is not comprehensive in these breakdowns, but it's a better source for them than anywhere else online. We make it easier to find and explore these links.</p>

        <h2>Where Wiktionary falls short</h2>
        <p>Wiktionary's own site is difficult to use. To reliably find a word in Yorùbá, you generally want to type it without tone marks, but with underdots. Other combinations generally don't work. Wiktionary will then search every one of its languages for words with that spelling, and present every single result, with definitions, etymology, informative tables, and other details for every matching word in every language. Yorùbá, starting at Y, will be down at the bottom of that page. Not very fun for language learners! Furthermore, because Wiktionary is crowdsourced, it can be messy. Key details like etymology links between words are incredibly valuable to language learners but inconsistent in their entry and presentation. Sometimes a parent word documents the words derived from it, sometimes only the derived word documents where it came from, sometimes both, sometimes neither, depending entirely on which page a contributor happened to edit. Tracing a family of related words means guessing which page has the link and searching for it by hand.</p>

        <h2>What we changed</h2>
        <ul>
          <li><strong>Cleaned and reorganized.</strong> We start from Kaikki's already-cleaned extraction of Wiktionary's raw wikitext, then apply a light additional layer of our own processing. With crowdsourced data, this will always be a work in progress, so let us know if you spot any quirks.</li>
          <li><strong>Searchable.</strong> With or without tone marks, with or without underdots, in English or Yorùbá.</li>
          <li><strong>Restructured relationships.</strong> Whichever side of a relationship Wiktionary happens to document — parent or derived word — we automatically synthesize the missing reverse link, turning its inconsistent, crowdsourced etymology links into a real, two-way, navigable path through the language.</li>
        </ul>

        <h2>Part of Speak Nigeria</h2>
        <p>This dictionary is a project of <a href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">Speak Nigeria</a>, a nonprofit building free games and resources so children can learn and keep Nigerian heritage languages. If you're learning Yorùbá, our structured courses might also be a good fit.</p>

        <div class="about-actions">
          <a class="about-btn primary" href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">See our Yorùbá courses</a>
          <a class="about-btn ghost" href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">Visit speaknigeria.org ↗</a>
        </div>

        <h2>Read next</h2>
        <ul>
          <li><a href="#/building-blocks">Key building block words</a> — the 25 roots that build the most other words in this dictionary.</li>
          <li><a href="#/learners">For learners</a> — how to learn roots and read the words built from them.</li>
          <li><a href="#/teachers">For teachers</a> — sequencing a curriculum around roots, and when to explain a compound.</li>
          <li><a href="#/speak-nigeria">About Speak Nigeria</a> — the nonprofit behind this.</li>
        </ul>
      </div>
    `;
    document.title = 'About the Dictionary — Sọ̀rọ̀ Sókè';
  }

  function renderSpeakNigeria() {
    els.entryContent.innerHTML = `
      <div class="about-content">
        <h1>About Speak Nigeria</h1>
        <p class="about-lede">Speak Nigeria is a nonprofit. We make free tools for learning Nigerian heritage languages.</p>

        <h2>Why we exist</h2>
        <p>Many children in Nigerian families grow up speaking only English. Parents who want to teach their own language often have nothing to teach from: no course at the right level, no games, and no dictionary a child can use.</p>
        <p>We build those and publish them free.</p>

        <h2>What we make</h2>
        <ul>
          <li><strong>Courses.</strong> Yorùbá from the beginning, in a set order.</li>
          <li><strong>Games.</strong> Practice for children learning on their own.</li>
          <li><strong>This dictionary.</strong> Every word, searchable with or without tone marks, and where each word came from.</li>
        </ul>

        <h2>How this dictionary fits</h2>
        <p>The courses teach words in a set order. The dictionary is for looking something up. It also shows where a word came from, because in Yorùbá the answer is usually another word.</p>
        <p><a href="#/entry/en-ile_aye-yo-noun-t8m1zNPj">ilé ayé</a> means Earth. It is <a href="#/entry/en-ile-yo-noun-VQM0lVeW">ilé</a> (home) and <a href="#/entry/en-aye-yo-noun-SG6kYiTR">ayé</a> (life). A learner who knows those two words can read the third without being taught it.</p>

        <div class="about-actions">
          <a class="about-btn primary" href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">See our Yorùbá courses</a>
          <a class="about-btn ghost" href="https://games.speaknigeria.org/" target="_blank" rel="noopener noreferrer">Play the games ↗</a>
        </div>
      </div>
    `;
    document.title = 'About Speak Nigeria — Sọ̀rọ̀ Sókè';
  }

  function renderLearners() {
    els.entryContent.innerHTML = `
      <div class="about-content">
        <h1>For learners</h1>
        <p class="about-lede">Yorùbá builds long words from short ones. If you know the short words, you can often work out a long word you have not been taught.</p>

        <h2>Look for the words inside a word</h2>
        <p><a href="#/entry/en-ile-yo-noun-VQM0lVeW">ilé</a> means home. Two words built from it:</p>
        <ul>
          <li><a href="#/entry/en-ile-iwe-yo-noun-1k3r2ULX">ilé-ìwé</a> — school. From <em>ilé</em> (home) and <em>ìwé</em> (book).</li>
          <li><a href="#/entry/en-ile_aye-yo-noun-t8m1zNPj">ilé ayé</a> — Earth. From <em>ilé</em> (home) and <em>ayé</em> (life).</li>
        </ul>
        <p>Both are made of words you can look up separately. Each entry in this dictionary lists its parts under "Component words", and lists the words built from it under "Used in".</p>

        <h2>Guess before you look it up</h2>
        <p>When you meet a long word, find a word inside it that you already know. Decide what you think the whole word means. Then check.</p>
        <p><a href="#/entry/en-ṣe-yo-verb-IXZV9I3e">ṣe</a> means to do. <a href="#/entry/en-ṣiṣẹ-yo-verb-5qTsaA0x">ṣiṣẹ́</a> means work. <a href="#/entry/en-ṣalaye-yo-verb-cgQ~Nwbp">ṣàlàyé</a> means to explain.</p>
        <p>Some of these are easy to predict and some are not. Either way you will remember the word better than if you had read it in a list.</p>

        <h2>Learn tone marks with the word</h2>
        <p><a href="#/entry/en-gba-yo-verb-DCZgzqX2">gbà</a> means to rescue. <a href="#/entry/en-gba-yo-verb-VAsl51P3">gbá</a> means to hit. The letters are the same and the tone marks are not, and they are two different words. A word learned without its tone marks is incomplete.</p>
        <p>You can still search without them. Type <em>gba</em> and you will get all eight words spelled that way, with their meanings, so you can find the one you want.</p>

        <h2>Where to go next</h2>
        <ul>
          <li><a href="#/building-blocks">Key building block words</a> lists the 25 roots that build the most words in this dictionary, with examples of what each one builds.</li>
          <li>Our <a href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">courses</a> teach Yorùbá in a set order.</li>
          <li>Our <a href="https://games.speaknigeria.org/" target="_blank" rel="noopener noreferrer">games</a> are for practice.</li>
        </ul>

        <div class="about-actions">
          <a class="about-btn primary" href="#/building-blocks">See the building block words</a>
        </div>
      </div>
    `;
    document.title = 'For Learners — Sọ̀rọ̀ Sókè';
  }

  function renderTeachers() {
    els.entryContent.innerHTML = `
      <div class="about-content">
        <h1>For teachers</h1>
        <p class="about-lede">Two decisions shape how much vocabulary a student can use: which words you choose to teach, and when you explain how those words are built.</p>

        <h2>Choose roots, not a flat word list</h2>
        <p>Teach <a href="#/entry/en-ile-yo-noun-VQM0lVeW">ilé</a> (home). Then <a href="#/entry/en-ile_aye-yo-noun-t8m1zNPj">ilé ayé</a> (Earth). Then <a href="#/entry/en-aye-yo-noun-SG6kYiTR">ayé</a> (life). The student now has three words and can see how the middle one is made.</p>
        <p>Teaching <em>ayé</em> without connecting it to <em>ilé ayé</em> leaves the student with two separate facts to memorise instead.</p>
        <p><a href="#/building-blocks">Key building block words</a> lists the 25 roots that build the most words in this dictionary, with examples of each. <em>ilé</em> alone appears in 56 of them.</p>

        <h2>Explain the parts the first time the word appears</h2>
        <p>Do not define <em>ilé ayé</em> as "Earth" and stop. It is two words, and a student can see it is two words. Say which two.</p>
        <p>The same applies to single words, where it is more often skipped. <a href="#/entry/en-sọrọ-yo-verb-SuqWjjbe">sọ̀rọ̀</a> means to speak. It is a contraction of <em>sọ</em> ("to say") and <em>ọ̀rọ̀</em> ("word"). <a href="#/entry/en-sọrọ_soke-yo-verb-zjLiM20R">sọ̀rọ̀ sókè</a> is a calque of English <em>speak up</em>: <em>sọ</em> ("to say") + <em>ọ̀rọ̀</em> ("word") + <em>sí</em> ("to") + <em>òkè</em> ("heights").</p>

        <h3>Ask the class first</h3>
        <p>Give them two words they already know and ask what the two together will mean. Take answers before you give yours.</p>
        <p>Some combinations are predictable and some are not. <em>ilé</em> and <em>ayé</em> giving Earth is not obvious in advance.</p>

        <h2>Leave the rules of combination until later</h2>
        <p>Yorùbá has rules for how words combine and for how combining changes pronunciation. Early students do not need them.</p>
        <p>What they need is to keep meeting combinations in words they already use. After enough examples, students begin to predict which words combine and how the sounds change, before anyone states a rule. Teach the rules after that, not before.</p>

        <h2>Check a breakdown before teaching it</h2>
        <p>Look the word up here first. This dictionary comes from Wiktionary, which is crowdsourced and uneven — many words have no breakdown at all. It is still more complete than any structured Yorùbá source we know of, so it is worth checking your own knowledge against.</p>
        <p>Where the source does not say which meaning a word was built from, the entry says so rather than picking one. If a word you know is missing its breakdown, you can add it to Wiktionary and it will appear here after the next refresh. The <a href="#/contribute">Contribute</a> page lists the cases where the missing piece is already identified.</p>

        <h2>Teach students to compare sources</h2>
        <p>There is no single authority for Yorùbá, and students should know that before they start looking things up.</p>
        <ul>
          <li><strong>This dictionary</strong> for lookups and for how words are built.</li>
          <li><strong><a href="https://glosbe.com/en/yo" target="_blank" rel="noopener noreferrer">Glosbe</a></strong> to compare several dictionaries side by side.</li>
          <li><strong>Google Translate</strong> is unreliable for Yorùbá. It is usable for a rough idea and not for anything you are teaching.</li>
        </ul>
        <p>Students who are confident online are often still poor at judging which source to trust. Show them how you decide.</p>

        <div class="about-actions">
          <a class="about-btn primary" href="#/building-blocks">See the building block words</a>
          <a class="about-btn ghost" href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">Our courses ↗</a>
        </div>
      </div>
    `;
    document.title = 'For Teachers — Sọ̀rọ̀ Sókè';
  }

  // The one generated page. Its list is computed at build time by
  // build/lib/building-blocks.mjs; see data/frequency/README.md for why
  // choosing the examples needs frequency data rather than signals from our
  // own corpus. Fetched on first visit rather than at boot - nothing on the
  // reading path needs it.
  function renderBuildingBlocks() {
    document.title = 'Key Building Block Words — Sọ̀rọ̀ Sókè';
    const listHtml = state.buildingBlocks
      ? buildingBlocksListHtml(state.buildingBlocks)
      : '<p>Loading the list…</p>';

    els.entryContent.innerHTML = `
      <div class="about-content">
        <h1>Key building block words</h1>
        <p class="about-lede">These 25 words build more other words than any others in this dictionary. Learn one and you can read several more.</p>
        <p>Each root below is a single meaning, not a spelling. <em>gbá</em> ("to hit") and <em>gbà</em> ("to accept") are different words, and they build different families, so they are counted separately.</p>
        <div id="blocks-list">${listHtml}</div>
        <p class="blocks-note">Chosen automatically from the etymologies in this dictionary, counting how many words each root builds. Example words are picked using Yorùbá word frequencies from the <a href="https://wortschatz.uni-leipzig.de/en/download" target="_blank" rel="noopener noreferrer">Leipzig Corpora Collection</a> (CC BY 4.0), so they favour words you are likely to meet.</p>
      </div>
    `;

    if (!state.buildingBlocks) {
      fetch('data/building-blocks.json')
        .then((r) => r.json())
        .then((data) => {
          state.buildingBlocks = data;
          // Only patch the list if the reader is still on this page.
          const host = document.getElementById('blocks-list');
          if (host) host.innerHTML = buildingBlocksListHtml(data);
        })
        .catch(() => {
          const host = document.getElementById('blocks-list');
          if (host) host.innerHTML = '<p>The list could not be loaded.</p>';
        });
    }
  }

  // The work queue, as edits rather than complaints. Generated by
  // build/lib/wiktionary-tasks.mjs; fetched on first visit like the quality
  // report, never on boot.
  function renderContribute() {
    document.title = 'Contribute — Sọ̀rọ̀ Sókè';
    const listHtml = state.tasks ? contributeListHtml(state.tasks) : '<p>Loading the list…</p>';

    els.entryContent.innerHTML = `
      <div class="about-content">
        <h1>Contribute</h1>
        <p class="about-lede">Some entries in this dictionary cannot say which word they came from. This page explains why, and lists the specific edits that would fix it.</p>

        <h2>Yorùbá words are built from other words</h2>
        <p><a href="#/entry/en-ile-yo-noun-VQM0lVeW">ilé</a> means home. <a href="#/entry/en-aye-yo-noun-SG6kYiTR">ayé</a> means life. Together they make <a href="#/entry/en-ile_aye-yo-noun-t8m1zNPj">ilé ayé</a>, which means Earth.</p>
        <p>Yorùbá does this constantly, and it is one of the most useful things a learner can see. So entries here show it in both directions. Open <a href="#/entry/en-ile_aye-yo-noun-t8m1zNPj">ilé ayé</a> and its two parts are listed under <em>Component words</em>. Open <a href="#/entry/en-ile-yo-noun-VQM0lVeW">ilé</a> and the 56 words built from it are listed under <em>Used in</em>.</p>

        <h2>Where that breaks down</h2>
        <p>To show it, we have to know which word a part came from. Usually that is clear. Sometimes it is not, because Yorùbá has many words spelled exactly alike.</p>
        <p>Seven different words are spelled <a href="#/entry/en-pa-yo-verb-Ps~5DR-I">pa</a>. They mean to kill, to tell, to rub, to gain, to be in a state, to be tight, and to be bald. Fifty-four words in this dictionary are built from one of those seven, and Wiktionary does not record which one.</p>
        <p>When that happens we show the first, and the first is often wrong. It is why <a href="#/entry/en-pade-yo-verb-no9flbpH">pàdé</a>, which means to meet, currently appears here as built from <em>pa</em> meaning to kill.</p>

        <h2>What would fix it</h2>
        <p>Two pieces of information are missing, and both have to be written down on Wiktionary.</p>
        <p><strong>First, each of the seven meanings of <em>pa</em> needs a name.</strong> At the moment they are only "the first section", "the second section", and so on, which is nothing a word can point at.</p>
        <p><strong>Second, each word built from <em>pa</em> needs to say which of those names it means.</strong></p>
        <p>Neither piece is difficult. Both are one short line of text. What makes them a pair is that neither works alone: a name nothing points at has no effect, and a pointer to a name that does not exist has no effect either. That is why each page below lists both.</p>

        <h2>How the two lines are written</h2>
        <p>A name goes at the top of an etymology section, using the <code>etymid</code> template:</p>
        <p><code>{{etymid|yo|kill}}</code></p>
        <p>A word built from that meaning then names it, using <code>id1</code>, <code>id2</code> and so on to say which of its parts it is talking about:</p>
        <p><code>{{compound|yo|pa|kó|t1=kill, clear|id1=kill}}</code></p>
        <p>The page for <a href="https://en.wiktionary.org/wiki/de#Yoruba" target="_blank" rel="noopener noreferrer">de</a> is already done, if you want to see a finished one. Its five meanings are named <em>tie down</em>, <em>deputize</em>, <em>wait</em>, <em>arrive</em> and <em>cover</em>.</p>

        <h2>Choosing a name for a meaning</h2>
        <p>The name is yours to pick. It identifies one etymology section, so it does not have to describe every meaning in that section, and it only has to be unique within its own page.</p>
        <ul>
          <li><strong>One or two plain words, lowercase.</strong> On <em>de</em>: <em>tie down</em>, <em>deputize</em>, <em>wait</em>, <em>arrive</em>, <em>cover</em>.</li>
          <li><strong>Enough to tell it from the other meanings on the same page.</strong> On <em>pa</em>, <em>kill</em> and <em>tell</em> are enough. <em>verb</em> would not be.</li>
          <li><strong>Broad enough for the whole section.</strong> The names suggested below come from each section's first definition, which is a starting point rather than a rule. Section 6 of <em>ta</em> covers "to shoot", "to sting", "to be spicy", "to kick" and "to pick" — <em>shoot</em> works, but a broader name would be better.</li>
          <li><strong>Hard to change later.</strong> Renaming breaks every pointer aimed at it, and nothing warns you. Pick something that will still fit if the meaning is written up more fully one day.</li>
          <li><strong>Read by other people.</strong> Wiktionary keeps lists of words that share a part — one such list is "Yoruba terms prefixed with a-". Naming a meaning splits that list by meaning, so words built from the <em>nominalizing prefix</em> sense are gathered separately from the others. Your name is what appears on the list, so read it back that way before you settle on it.</li>
        </ul>

        <h2>Checking the suggestions below</h2>
        <p>Where we can, we suggest which name a word should point at. Each suggestion says the same thing: <em>this word records its part as meaning X, and section N of the target page covers X.</em> Open both pages and confirm that.</p>
        <p>Two things can be wrong with it. The meaning recorded on the word may itself be vague or mistaken — it was written by someone else and we take it at face value. Or the section may contain those words incidentally rather than actually meaning them.</p>
        <p>There is a third case, which is not a mistake in the suggestion. Sometimes the recorded meaning matches no section at all. <a href="#/entry/en-pade-yo-verb-no9flbpH">pàdé</a> records its <em>pa</em> as "to do; action verb", and none of <em>pa</em>'s seven sections says that. No pointer is right there: either the meaning written on <em>pàdé</em> is wrong, or <em>pa</em> is missing a meaning that ought to be listed. Both are worth fixing, and neither is the edit we suggest.</p>
        <p>When you are not sure, leave it. A word with no pointer shows here as a gap. A word with the wrong pointer shows as a fact, and other tools will believe it.</p>

        <h2>Wiktionary's own documentation</h2>
        <p>These pages define what the templates do. Worth reading before a first edit.</p>
        <ul>
          <li><a href="https://en.wiktionary.org/wiki/Template:etymid" target="_blank" rel="noopener noreferrer">Template:etymid</a> — naming a meaning. This is the one used below.</li>
          <li><a href="https://en.wiktionary.org/wiki/Template:senseid" target="_blank" rel="noopener noreferrer">Template:senseid</a> — naming a single definition, for when one etymology section holds several meanings and a pointer needs to tell them apart.</li>
          <li><a href="https://en.wiktionary.org/wiki/Template:affix" target="_blank" rel="noopener noreferrer">Template:affix</a> — documents <code>id1</code>, <code>id2</code> and their effect on category names. <a href="https://en.wiktionary.org/wiki/Template:compound" target="_blank" rel="noopener noreferrer">Template:compound</a> takes the same parameters.</li>
          <li><a href="https://en.wiktionary.org/wiki/Wiktionary:Entry_layout" target="_blank" rel="noopener noreferrer">Wiktionary:Entry layout</a> — how numbered etymology sections are structured, if you have not edited an entry before.</li>
        </ul>
        <p class="task-note">This site has no Wiktionary account and makes no automated edits. Everything below is text for you to check and type.</p>

        <div id="tasks-list">${listHtml}</div>
      </div>
    `;

    if (!state.tasks) {
      fetch('data/wiktionary-tasks.json')
        .then((r) => r.json())
        .then((data) => {
          state.tasks = data;
          const host = document.getElementById('tasks-list');
          if (host) host.innerHTML = contributeListHtml(data);
        })
        .catch(() => {
          const host = document.getElementById('tasks-list');
          if (host) host.innerHTML = '<p>The list could not be loaded.</p>';
        });
    }
  }

  const TIER_LABEL = {
    A: 'suggested — check it',
    B1: 'you choose',
    B2: 'you choose',
    C: 'needs a Yorùbá speaker',
  };

  function contributeListHtml(data) {
    const t = data.totals || {};
    const byTier = t.byTier || {};
    const head = `<div class="tasks-summary">
      <p>${t.references} words across ${t.pagesNeedingAnchors} pages do not record which meaning they were built from. Pages are ordered by how many words each one affects.</p>
      <p>Of those words, ${byTier.A || 0} have a suggested answer to check, ${(byTier.B1 || 0) + (byTier.B2 || 0)} record a meaning that does not single out one section, and ${byTier.C || 0} record no meaning at all.</p>
    </div>`;

    return head + (data.pages || []).slice(0, 40).map((page) => `
      <details class="task-page">
        <summary>
          <span class="task-word">${escapeHtml(page.page)}</span>
          <span class="task-count">${page.referenceCount} words</span>
          <span class="task-anchors">${page.anchors.filter((a) => !a.alreadyPresent).length} names to add</span>
        </summary>

        <p class="task-step">1. On <a href="${escapeHtml(page.editUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(page.page)}</a>, add a name to the top of each etymology section:</p>
        <ul class="task-anchor-list">
          ${page.anchors.map((a) => `
            <li>
              <code>${escapeHtml(a.wikitext)}</code>
              <span class="task-note">Etymology ${escapeHtml(String(a.etymologyNumber))} — ${escapeHtml(a.definition)}${a.alreadyPresent ? ' <strong>(already there)</strong>' : ''}</span>
            </li>
          `).join('')}
        </ul>

        <p class="task-step">2. Then add the matching pointer to each word built from it:</p>
        <ul class="task-ref-list">
          ${page.references.map((r) => `
            <li class="task-ref tier-${escapeHtml(r.tier)}">
              <div class="task-ref-head">
                <a href="${escapeHtml(r.editUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.word)}</a>
                <span class="task-note">${escapeHtml(r.definition)}</span>
                <span class="tier-chip">${escapeHtml(TIER_LABEL[r.tier])}</span>
              </div>
              ${r.proposedValue
                ? `<code>add ${escapeHtml(r.argument)}=${escapeHtml(r.proposedValue)}</code>`
                : `<code>add ${escapeHtml(r.argument)}=?</code>`}
              <div class="task-why">${escapeHtml(r.why)}${r.sectionCovers && r.sectionCovers.length > 1
                ? `. That section also covers ${r.sectionCovers.slice(1).map((d) => `“${d}”`).join(', ')}`
                : ''}</div>
            </li>
          `).join('')}
          ${page.referencesOmitted ? `<li class="task-note">…and ${page.referencesOmitted} more on this page.</li>` : ''}
        </ul>
      </details>
    `).join('');
  }

  function buildingBlocksListHtml(data) {
    return (data.blocks || [])
      .map((block, i) => `
        <div class="block-card">
          <div class="block-head">
            <span class="block-rank">${i + 1}</span>
            <a class="block-word" href="#/entry/${encodeURIComponent(block.entryId)}">${escapeHtml(block.form)}</a>
            <span class="sibling-meta">${escapeHtml(block.pos || '')}</span>
            <span class="block-def">${escapeHtml(block.definition)}</span>
          </div>
          <div class="block-count">builds ${block.buildsCount} words in this dictionary, including:</div>
          <div class="sibling-list">
            ${block.examples.map((ex) => `
              <a class="sibling-row" href="#/entry/${encodeURIComponent(ex.entryId)}">
                <span class="sibling-word">${escapeHtml(ex.form)}</span>
                <span class="sibling-meta">${escapeHtml(ex.pos || '')}</span>
                <span class="sibling-gloss">${escapeHtml(ex.definition)}</span>
              </a>
            `).join('')}
          </div>
        </div>
      `)
      .join('');
  }

  // ---------------------------------------------------------------
  // Routing (hash-based: works on any static host with zero
  // server-side rewrite configuration, and every entry gets a
  // stable, bookmarkable, back-button-friendly URL).
  // ---------------------------------------------------------------

  function navigateTo(entryId) {
    location.hash = `#/entry/${encodeURIComponent(entryId)}`;
  }

  // Written pages, plus the one generated page. All render from markup that's
  // already in app.js, so they paint on first load without the dictionary -
  // boot() calls handleRoute() before fetching it for exactly this reason.
  const STATIC_ROUTES = {
    '#/about': renderAbout,
    '#/speak-nigeria': renderSpeakNigeria,
    '#/learners': renderLearners,
    '#/teachers': renderTeachers,
    '#/building-blocks': renderBuildingBlocks,
    '#/contribute': renderContribute,
  };

  function handleRoute() {
    const hash = location.hash || '';

    const staticPage = STATIC_ROUTES[hash];
    if (staticPage) {
      staticPage();
      onEntryRendered();
      return;
    }

    const match = hash.match(/^#\/entry\/(.+)$/);
    if (match) {
      // Someone arriving on a link to a word shouldn't be shown the welcome
      // page in the meantime and left to wonder whether the link was wrong;
      // handleRoute runs again once the dictionary lands.
      if (!state.ready) {
        els.entryContent.innerHTML =
          '<div class="entry-welcome"><p>Loading the dictionary…</p></div>';
        return;
      }
      const id = decodeURIComponent(match[1]);
      const entry = state.entries[id];
      if (entry) {
        renderEntry(entry);
        onEntryRendered();
        return;
      }
    }
    renderWelcome();
    if (mobileQuery.matches) window.scrollTo({ top: 0 });
  }

  // On mobile, opening an entry scrolls it up under the header so the
  // definition is what you're looking at; the results stay one scroll away.
  function onEntryRendered() {
    if (!mobileQuery.matches) return;
    els.entryPane.scrollTop = 0;
    requestAnimationFrame(scrollToEntry);
  }

  // ---------------------------------------------------------------
  // Search input wiring + keyboard accessibility (spec section 13)
  // ---------------------------------------------------------------

  let debounceTimer = null;
  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderResults(search(els.searchInput.value));
    }, 60);
  }

  function onSearchKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.activeResults.length === 0) return;
      state.activeIndex = Math.min(state.activeIndex + 1, state.activeResults.length - 1);
      highlightActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.activeResults.length === 0) return;
      state.activeIndex = Math.max(state.activeIndex - 1, 0);
      highlightActive();
    } else if (e.key === 'Enter') {
      if (state.activeIndex >= 0 && state.activeResults[state.activeIndex]) {
        navigateTo(state.activeResults[state.activeIndex].id);
      } else if (state.activeResults[0]) {
        navigateTo(state.activeResults[0].id);
      }
    } else if (e.key === 'Escape') {
      els.searchInput.value = '';
      renderResults([]);
      els.searchInput.blur();
    }
  }

  // ---------------------------------------------------------------
  // Data quality panel
  // ---------------------------------------------------------------

  // The report is a work queue, not a census. A single number like "2,363
  // links to words we don't have" tells nobody where to start; the same items
  // split by what fixing them actually takes — 189 where we already know the
  // intended word, 1,046 that need a new Wiktionary entry written — is the
  // difference between a wall and a morning's work.
  const EFFORT_UI = {
    easy: { label: 'Easy win', blurb: 'We already know the right answer — it just needs typing in.' },
    mechanical: { label: 'Mechanical', blurb: 'No judgment needed, but no shortcut either.' },
    expertise: { label: 'Needs Yorùbá', blurb: 'Someone who knows the word has to decide.' },
    info: { label: 'For context', blurb: 'Not a defect — counted so it doesn’t look like one.' },
  };

  function renderQualityPanel() {
    const v = state.validation;
    if (!v) return;

    const sourceNote = v.kaikkiSourceDate
      ? `<div class="quality-note">Data last refreshed from <a href="https://github.com/SpeakNigeriaOrg/kaikki-yoruba/releases/tag/${encodeURIComponent(v.kaikkiReleaseTag)}" target="_blank" rel="noopener noreferrer">kaikki-yoruba release ${escapeHtml(v.kaikkiReleaseTag)}</a>, sourced ${escapeHtml(v.kaikkiSourceDate)}.</div>`
      : '';

    const issues = v.issues || [];
    const groups = ['easy', 'mechanical', 'expertise', 'info']
      .map((effort) => {
        const rows = issues.filter((i) => i.effort === effort);
        if (!rows.length) return '';
        return `<div class="quality-group">
          <div class="quality-group-head">
            <span class="effort-chip ${effort}">${escapeHtml(EFFORT_UI[effort].label)}</span>
            <span class="quality-group-blurb">${escapeHtml(EFFORT_UI[effort].blurb)}</span>
          </div>
          ${rows.map(issueHtml).join('')}
        </div>`;
      })
      .join('');

    els.qualityContent.innerHTML = `
      ${sourceNote}
      <div class="quality-stat"><span>Words in the dictionary</span><strong>${v.totalEntries}</strong></div>
      <div class="quality-stat"><span>Things worth fixing</span><strong>${v.summary ? v.summary.actionable : '—'}</strong></div>
      <div class="quality-stat"><span>…of those, easy wins</span><strong>${v.summary ? v.summary.easyWins : '—'}</strong></div>
      <div class="quality-note">
        These describe the Wiktionary data this dictionary is built from, not bugs in this site. Almost everything here is fixed by editing the word on Wiktionary itself, and we pick that up automatically the next time we refresh — each item below links straight to the section to edit. A few are ours to fix, and say so.
      </div>
      ${groups}
      <a class="quality-download" href="data/validation-report.json" download="yorubadict-quality-report.json">
        Download the full report (JSON) — every word affected, not just the first ${escapeHtml(String(120))}
      </a>
    `;
  }

  function issueHtml(issue) {
    const pages = (issue.pages || [])
      .map(
        (p) => `<li class="quality-page">
          <a href="${escapeHtml(p.editUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.page)}</a>
          <span class="quality-page-detail">${escapeHtml(p.details[0] || '')}</span>
        </li>`
      )
      .join('');
    const omitted = issue.pagesOmitted
      ? `<li class="quality-page more">…and ${issue.pagesOmitted} more pages — see the downloadable report</li>`
      : '';
    return `<details class="quality-issue">
      <summary>
        <span class="quality-issue-title">${escapeHtml(issue.title)}</span>
        <span class="quality-issue-count">${issue.count}</span>
        ${issue.target === 'pipeline' ? '<span class="target-chip">ours to fix</span>' : ''}
      </summary>
      <p class="quality-why">${escapeHtml(issue.why)}</p>
      <p class="quality-fix"><strong>Fix:</strong> ${escapeHtml(issue.fix)}</p>
      ${pages ? `<ul class="quality-pages">${pages}${omitted}</ul>` : ''}
    </details>`;
  }

  // ---------------------------------------------------------------
  // Header height
  //
  // Both panes size themselves with calc(100dvh - var(--header-h)).
  // The header's real height varies: it wraps to two rows on narrow
  // viewports and shrinks again when the mobile sheet is pulled full up,
  // so it's measured rather than hardcoded.
  // ---------------------------------------------------------------

  function syncChromeHeights() {
    const root = document.documentElement.style;
    // Measured with the header in its full (uncollapsed) state only, and only
    // on load/resize. Deliberately NOT re-measured per sheet state: the
    // sheet's resting offsets are static so a state change can never move
    // the transform target out from under a running transition.
    if (els.header && !document.body.classList.contains('sheet-full')) {
      root.setProperty('--header-h', `${els.header.offsetHeight}px`);
    }
    const footer = document.querySelector('.site-footer');
    if (footer) root.setProperty('--footer-h', `${footer.offsetHeight}px`);
  }

  // ---------------------------------------------------------------
  // Mobile: scroll shortcut
  //
  // Below 800px the layout is one ordinary document scroll (see the
  // "one native scroll" block in style.css): the results list is capped at
  // 56dvh and the entry follows it, so scrolling carries the definition up
  // over the results and under the fixed header. There is deliberately no
  // gesture code here — the browser's own scrolling is the interaction, which
  // is the only way it feels smooth and stays interruptible.
  //
  // All this adds is a shortcut: the grip at the top of the entry jumps to
  // the definition, or back to the top if you're already there.
  // ---------------------------------------------------------------

  const mobileQuery = window.matchMedia('(max-width: 800px)');

  function entryScrollTop() {
    const headerH = els.header ? els.header.offsetHeight : 0;
    return Math.max(0, els.entryPane.getBoundingClientRect().top + window.scrollY - headerH);
  }

  function scrollToEntry() {
    window.scrollTo({ top: entryScrollTop(), behavior: 'smooth' });
  }

  function initSheet() {
    if (!els.sheetHandle || !els.entryPane) return;

    els.sheetHandle.addEventListener('click', () => {
      if (!mobileQuery.matches) return;
      const target = entryScrollTop();
      const atEntry = window.scrollY >= target - 8;
      window.scrollTo({ top: atEntry ? 0 : target, behavior: 'smooth' });
    });
  }


  // ---------------------------------------------------------------
  // Header menu (narrow viewports only — on desktop the two actions are
  // always visible and this dropdown is just their inline container)
  // ---------------------------------------------------------------

  function closeMenu() {
    if (!els.headerMenu) return;
    els.headerMenu.classList.remove('open');
    els.menuToggle.setAttribute('aria-expanded', 'false');
  }

  function initMenu() {
    if (!els.menuToggle || !els.headerMenu) return;

    els.menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = els.headerMenu.classList.toggle('open');
      els.menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Activating anything inside the menu dismisses it.
    els.headerMenu.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) closeMenu();
    });

    document.addEventListener('click', (e) => {
      if (!els.headerMenu.classList.contains('open')) return;
      if (e.target.closest('.header-actions')) return;
      closeMenu();
    });
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  async function boot() {
    // Paint everything that doesn't depend on the dictionary BEFORE asking for
    // it. The YO/EN badge, the "Start typing…" hint and the welcome text are
    // all written by JS, and they used to be written after this await - so on
    // a slow connection the page sat for twelve seconds showing a header, a
    // footer and two empty panes, while the parts that come from index.html
    // were up in a fifth of a second. Measured over a throttled load: static
    // HTML at 235ms, entries.json at 12,402ms, and all three of these at
    // 12,496ms. None of them needed a byte of it.
    applySearchMode();
    // handleRoute rather than renderWelcome, so a deep link says "Loading the
    // dictionary…" instead of showing the welcome page to someone who followed
    // a link to a word and would reasonably think the link was broken. About
    // is static and renders in full straight away.
    handleRoute();
    renderResults([]);
    initMenu();
    initSheet();
    syncChromeHeights();

    // Wired before the data lands too, so typing during the wait is answered
    // ("Loading the dictionary…") instead of silently doing nothing.
    els.searchInput.addEventListener('input', onSearchInput);
    els.searchInput.addEventListener('keydown', onSearchKeydown);
    function closeQualityPanel() {
      els.qualityPanel.classList.add('hidden');
    }

    els.qualityToggle.addEventListener('click', async () => {
      els.qualityPanel.classList.remove('hidden');
      if (!state.validation) {
        els.qualityContent.innerHTML = '<div class="quality-note">Loading the report…</div>';
        state.validation = await fetch('data/validation-report.json')
          .then((r) => r.json())
          .catch(() => null);
        if (!state.validation) {
          els.qualityContent.innerHTML = '<div class="quality-note">The report could not be loaded.</div>';
          return;
        }
      }
      renderQualityPanel();
    });
    els.qualityClose.addEventListener('click', closeQualityPanel);
    // Clicking the backdrop (anywhere in the fixed overlay outside the
    // panel itself) closes it too - checking e.target avoids closing on
    // clicks that bubble up from inside quality-panel-inner.
    els.qualityPanel.addEventListener('click', (e) => {
      if (e.target === els.qualityPanel) closeQualityPanel();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!els.qualityPanel.classList.contains('hidden')) {
        closeQualityPanel();
      } else if (els.headerMenu && els.headerMenu.classList.contains('open')) {
        closeMenu();
        els.menuToggle.focus();
      }
    });

    // Both escape hatches for a pill that had to pick one of several
    // identically-spelled entries. Delegated on entryContent since it's
    // rebuilt via innerHTML on every render.
    els.entryContent.addEventListener('click', (e) => {
      // The count badge: expand the pill to list every candidate with its own
      // gloss, so a wrong pick is visible rather than hidden behind a
      // confident link. A real button, so this works on touch and by keyboard
      // - the tooltip it replaces did neither.
      const more = e.target.closest('.pill-more');
      if (more) {
        const group = more.closest('.pill-group');
        const panel = document.getElementById(more.getAttribute('aria-controls'));
        const open = more.getAttribute('aria-expanded') === 'true';
        more.setAttribute('aria-expanded', String(!open));
        group.classList.toggle('open', !open);
        if (panel) panel.hidden = open;
        return;
      }

      // Component-word pills additionally populate and run the search pane for
      // that spelling, so every homograph is one click away too.
      const pill = e.target.closest('[data-search-form]');
      if (!pill) return;
      els.searchInput.value = pill.getAttribute('data-search-form');
      renderResults(search(els.searchInput.value));
    });

    window.addEventListener('resize', syncChromeHeights);
    // Web fonts land after first paint and change both bars' heights.
    if (document.fonts) document.fonts.ready.then(syncChromeHeights);
    window.addEventListener('hashchange', handleRoute);
    initSearchMode();

    // Wait for the paint above to actually commit before asking for 2.1 MB.
    //
    // Painting first in source order isn't enough, because the fetches were
    // still issued in the same task as the render. On a fast connection the
    // dictionary then arrived BEFORE the paint was recorded - measured on
    // production, entries.json finished at 852ms against a first paint at
    // 2,333ms - and anything that lands before the Largest Contentful Paint
    // is treated as something the paint waited for. Lighthouse re-times that
    // 1.4 MB at slow-4G speed and reports LCP 14.1s for a paragraph that was
    // on screen at 2.3s, which is why the LCP score was 0/25 while every
    // other metric was near-perfect.
    //
    // Waiting one frame wasn't enough: the filter is on when a request
    // STARTS, not when it finishes, so a fetch issued 16ms later is still
    // inside the window. This waits for the main thread to actually go idle,
    // which is after the paint has been committed and recorded. The timeout
    // bounds it so a busy thread can't stall the dictionary indefinitely.
    //
    // Worth doing on its own merits regardless of the metric: a 1.3 MB
    // download shouldn't compete with first render for the connection.
    // Waiting on the paint itself rather than on a proxy for it. Idle alone
    // put the request 8ms after the paint was recorded - the right side of
    // the line, but only just, and a slower machine would land on the wrong
    // side and take LCP back to 14s. The paint entry is the actual signal, so
    // it's the one to wait for; idle and a timeout are only fallbacks for
    // browsers without the observer, and bound the wait if it never fires.
    await new Promise((resolve) => {
      let started = false;
      const go = () => {
        if (started) return;
        started = true;
        resolve();
      };

      let watchingPaint = false;
      try {
        const observer = new PerformanceObserver(() => {
          observer.disconnect();
          go();
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        watchingPaint = true;
      } catch (err) {
        // Older Safari has no largest-contentful-paint entry type.
      }

      // Only a fallback, never a race. An earlier version let an idle callback
      // with a 1s timeout run against the observer, which meant that on a slow
      // load - paint at 2.3s in one measured run - the timer fired first and
      // started the download before the paint, which is the one case this is
      // meant to prevent. It scored 65 where the same code scored 99 on a fast
      // load. The long stop below exists only so a paint that never arrives
      // can't strand the dictionary.
      if (!watchingPaint) {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 1000 });
        else setTimeout(go, 200);
      }
      setTimeout(go, 5000);
    });

    // Only now the part that genuinely needs the dictionary. The quality
    // report is over half a megabyte and nothing on the reading path needs it,
    // so it waits until the panel is opened.
    const [entries, index] = await Promise.all([
      fetch('data/entries.json').then((r) => r.json()),
      fetch('data/search-index.json').then((r) => r.json()),
    ]);
    state.entries = entries;
    state.index = index;
    state.ready = true;

    // Re-route ONLY for a deep link, which was showing "Loading the
    // dictionary…" and couldn't resolve until now. Calling handleRoute()
    // unconditionally re-rendered the welcome text over itself, and since
    // that replaces #entry-content wholesale it destroyed and recreated the
    // paragraph the browser had picked as the Largest Contentful Paint -
    // so LCP was re-recorded at whenever the dictionary happened to land.
    // Lighthouse read 14.0s against a page whose text had genuinely been on
    // screen since 227ms, and every one of those seconds was this line.
    if (/^#\/entry\//.test(location.hash || '')) handleRoute();
    if (els.searchInput.value.trim()) renderResults(search(els.searchInput.value));
  }

  // ---------------------------------------------------------------
  // Search scope
  //
  // One button inside the search field, cycling YO/EN -> YO -> EN, in place of
  // the three radios that used to occupy a whole line of the header.
  //
  // Every piece of copy that describes what a search will match lives here, so
  // the badge, the placeholder, the empty-results hint and the no-matches
  // advice all change together. (Telling someone to drop their tone marks is
  // useless advice while the scope is English-only.)
  // ---------------------------------------------------------------

  const SEARCH_MODES = ['both', 'yoruba', 'english'];

  const MODE_UI = {
    both: {
      badge: 'YO/EN',
      label: 'Searching Yorùbá words and English definitions. Tap to search Yorùbá only.',
      placeholder: 'Search Yorùbá or English…  (ile, fa, pull…)',
      short: 'Search…',
      hint: 'Start typing a Yorùbá word (with or without tone marks) or an English word.',
      empty: 'No words found. Try a spelling without tone marks, or an English word from the definition.',
    },
    yoruba: {
      badge: 'YO',
      label: 'Searching Yorùbá words only. Tap to search English definitions only.',
      placeholder: 'Search Yorùbá words…  (ile, fa, bàbá…)',
      short: 'Yorùbá…',
      hint: 'Searching Yorùbá words only. Start typing, with or without tone marks and underdots.',
      empty: 'No Yorùbá word found. Try a spelling without tone marks, or tap YO/EN to search definitions too.',
    },
    english: {
      badge: 'EN',
      label: 'Searching English definitions only. Tap to search both.',
      placeholder: 'Search English definitions…  (house, pull, father…)',
      short: 'English…',
      hint: 'Searching English definitions only. Start typing an English word.',
      empty: 'No definition found containing that word. Try another word, or tap EN to search Yorùbá words too.',
    },
  };

  function applySearchMode() {
    const ui = MODE_UI[state.searchMode];
    if (els.modeCycle) {
      els.modeCycle.textContent = ui.badge;
      // The accessible name has to start with the visible text (WCAG 2.5.3,
      // "Label in Name"): someone using speech control says "tap YO slash EN"
      // and the name has to contain that, or the command doesn't match what
      // they can see. The description follows it rather than replacing it.
      els.modeCycle.setAttribute('aria-label', `${ui.badge} — ${ui.label}`);
      els.modeCycle.setAttribute('title', ui.label);
    }
    // The mobile field shares its row with the wordmark, so the long
    // placeholders would just be clipped mid-word.
    els.searchInput.placeholder = mobileQuery.matches ? ui.short : ui.placeholder;
  }

  function initSearchMode() {
    applySearchMode();
    mobileQuery.addEventListener('change', applySearchMode);
    if (!els.modeCycle) return;

    // The button sits inside the search field, and on mobile the wordmark
    // hides itself while that field has focus. Letting the button take focus
    // therefore shunted the wordmark in and out of the header on every tap,
    // and pulled the caret out of a query mid-edit. Suppressing the default
    // mousedown behaviour leaves focus exactly where the user put it.
    // (Keyboard activation is unaffected - it moves focus deliberately.)
    els.modeCycle.addEventListener('mousedown', (e) => e.preventDefault());

    els.modeCycle.addEventListener('click', () => {
      const next = (SEARCH_MODES.indexOf(state.searchMode) + 1) % SEARCH_MODES.length;
      state.searchMode = SEARCH_MODES[next];
      applySearchMode();
      renderResults(search(els.searchInput.value));
    });

    // The button overlays the right end of the field, which on a narrow screen
    // leaves the input a smallish target. Any tap in the field that isn't on
    // the button focuses it - and once focused it expands to the full row.
    const field = els.searchInput.closest('.search-field');
    if (field) {
      field.addEventListener('click', (e) => {
        if (e.target.closest('.mode-cycle')) return;
        els.searchInput.focus();
      });
    }
  }

  boot().catch((err) => {
    els.entryContent.innerHTML = `<div class="entry-welcome"><h1>Couldn't load the dictionary</h1><p>${escapeHtml(err.message)}</p><p>If you opened this file directly (file://), you'll need to serve it over HTTP — see the README.</p></div>`;
  });
})();
