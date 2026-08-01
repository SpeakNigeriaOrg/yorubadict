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
    activeResults: [],
    activeIndex: -1,
    searchMode: 'both', // 'both', 'yoruba', or 'english'
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
    if (!trimmed) return [];

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
      els.resultsList.innerHTML = els.searchInput.value.trim()
        ? `<div class="results-empty">${escapeHtml(ui.empty)}</div>`
        : `<div class="results-hint">${escapeHtml(ui.hint)}</div>`;
      return;
    }

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

  function relationPillsHtml(list, extraSynthesized) {
    const elements = [];
    
    for (const rel of list || []) {
      // Flattened dialect tables used to arrive here as debris, with a
      // synthetic "external_link" item standing in for whatever had been
      // dropped. They're now imported from Wiktionary's own source modules
      // and rendered by renderDialectSynonyms instead, so both are gone.
      if (rel.type === 'external_link') continue;

      if (rel.resolved && rel.entryIds && rel.entryIds.length > 0) {
        for (const id of rel.entryIds) {
          const target = state.entries[id];
          if (!target) continue;
          elements.push(`<a class="relation-pill" href="#/entry/${encodeURIComponent(id)}">
            ${escapeHtml(target.canonicalForm.value)}
            <span class="pos-hint">${escapeHtml(target.pos || '')}</span>
          </a>`);
        }
      } else {
        elements.push(`<span class="relation-pill unresolved" title="Not in this dictionary yet">
          ${escapeHtml(rel.text)}
        </span>`);
      }
    }

    // 3. Synthesized Back-links
    for (const rel of extraSynthesized || []) {
      // ... existing synthesized link logic ...
      const target = state.entries[rel.entryId];
      if (!target) continue;
      elements.push(`<a class="relation-pill synthesized" href="#/entry/${encodeURIComponent(rel.entryId)}" title="Synthesized reciprocal link">
        ${escapeHtml(target.canonicalForm.value)}
        <span class="pos-hint">${escapeHtml(target.pos || '')}</span>
      </a>`);
    }
    
    return elements.join('');
  }

  function morphemesHtml(morphemes) {
    if (!morphemes || !morphemes.length) return '';
    // Exactly one element per morpheme in the etymology, regardless of how
    // many dictionary entries share that spelling - unlike relationPillsHtml
    // (where each entryId is a genuinely different target word worth its
    // own pill, labeled with THAT target's own canonical form/pos), every
    // entryId here refers to the SAME morpheme text from the SAME etymology
    // template, so rendering one pill per entryId would just repeat
    // identical text (confirmed bug: "tó"/"ẹkùn" - common spellings shared
    // by several homographs - rendered 2-3x each with no distinguishing
    // information). When more than one entry shares the spelling, this
    // links to the first and notes the ambiguity in the tooltip, since
    // Kaikki's etymology template doesn't say which specific sense is meant.
    return morphemes.map((m) => {
      const glossHtml = m.gloss ? ` <span class="pos-hint">${escapeHtml(m.gloss)}</span>` : '';
      if (m.bound) {
        return `<span class="relation-pill unresolved" title="Word part — not used on its own">${escapeHtml(m.form)}${glossHtml}</span>`;
      }
      if (m.resolved && m.entryIds && m.entryIds.length > 0) {
        const target = state.entries[m.entryIds[0]];
        if (target) {
          const title = m.entryIds.length > 1
            ? ` title="${m.entryIds.length} words share this spelling — linking to the first"`
            : '';
          return `<a class="relation-pill" href="#/entry/${encodeURIComponent(m.entryIds[0])}"${title} data-search-form="${escapeHtml(m.form)}">${escapeHtml(m.form)}${glossHtml}</a>`;
        }
      }
      return `<span class="relation-pill unresolved" title="Not yet in this dictionary">${escapeHtml(m.form)}${glossHtml}</span>`;
    }).join('');
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
    const derivedHtml = relationPillsHtml(entry.derivedTerms);
    const relatedHtml = relationPillsHtml(entry.relatedTerms);
    const synonymsHtml = relationPillsHtml(entry.synonyms);
    const antonymsHtml = relationPillsHtml(entry.antonyms);
    const descendantsHtml = relationPillsHtml(entry.descendants);
    const derivedFromHtml = relationPillsHtml(
      [],
      (entry.synthesizedRelations || []).filter((r) => r.type === 'derivedFrom')
    );
    const usedInHtml = relationPillsHtml([], entry.usedInCompounds || []);

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
        <h1>About this dictionary</h1>
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
      </div>
    `;
    document.title = 'About — Sọ̀rọ̀ Sókè';
  }

  // ---------------------------------------------------------------
  // Routing (hash-based: works on any static host with zero
  // server-side rewrite configuration, and every entry gets a
  // stable, bookmarkable, back-button-friendly URL).
  // ---------------------------------------------------------------

  function navigateTo(entryId) {
    location.hash = `#/entry/${encodeURIComponent(entryId)}`;
  }

  function handleRoute() {
    const hash = location.hash || '';

    if (hash === '#/about') {
      renderAbout();
      onEntryRendered();
      return;
    }

    const match = hash.match(/^#\/entry\/(.+)$/);
    if (match) {
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

  function renderQualityPanel() {
    const v = state.validation;
    if (!v) return;
    const sourceNote = v.kaikkiSourceDate
      ? `<div class="quality-note">Data last refreshed from <a href="https://github.com/SpeakNigeriaOrg/kaikki-yoruba/releases/tag/${encodeURIComponent(v.kaikkiReleaseTag)}" target="_blank" rel="noopener noreferrer">kaikki-yoruba release ${escapeHtml(v.kaikkiReleaseTag)}</a>, sourced ${escapeHtml(v.kaikkiSourceDate)}.</div>`
      : '';
    els.qualityContent.innerHTML = `
      ${sourceNote}
      <div class="quality-stat"><span>Words in the dictionary</span><strong>${v.totalEntries}</strong></div>
      <div class="quality-stat"><span>Main spelling not confirmed</span><strong>${v.inferredCanonicalForms.length}</strong></div>
      <div class="quality-stat"><span>Words with no pronunciation</span><strong>${v.missingIpa.length}</strong></div>
      <div class="quality-stat"><span>Links to words we don’t have</span><strong>${v.unknownReferencedWords.length}</strong></div>
      <div class="quality-stat"><span>Spellings shared by several words</span><strong>${Object.keys(v.duplicateNormalizedSpellings).length}</strong></div>
      <div class="quality-stat"><span>Words that circularly derive from each other</span><strong>${v.circularDerivations.length}</strong></div>
      <div class="quality-note">
        These describe the Wiktionary data this dictionary is built from, not bugs in this site — missing pronunciations, links pointing at words we don't have yet, spellings shared by several different words, and so on. "Main spelling not confirmed" doesn't mean a word is wrong: usually there's simply no alternative spelling for Wiktionary to choose between, so we show the spelling it used. Fixing a real gap means editing the word on Wiktionary itself; we'll pick that up automatically the next time we refresh.
      </div>
      <a class="quality-download" href="data/validation-report.json" download="yorubadict-quality-report.json">
        Download the full report (JSON) — every word affected, for fixing on Wiktionary
      </a>
    `;
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
    const [entries, index, validation] = await Promise.all([
      fetch('data/entries.json').then((r) => r.json()),
      fetch('data/search-index.json').then((r) => r.json()),
      fetch('data/validation-report.json').then((r) => r.json()).catch(() => null),
    ]);

    state.entries = entries;
    state.index = index;
    state.validation = validation;

    els.searchInput.addEventListener('input', onSearchInput);
    els.searchInput.addEventListener('keydown', onSearchKeydown);
    function closeQualityPanel() {
      els.qualityPanel.classList.add('hidden');
    }

    els.qualityToggle.addEventListener('click', () => {
      renderQualityPanel();
      els.qualityPanel.classList.remove('hidden');
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

    // Component-word pills link to one ranked-best homograph, but several
    // real entries can share the exact same spelling - clicking a pill also
    // populates and runs the search pane for that spelling, so every
    // homograph is one click away if the default pick is wrong. Delegated
    // on entryContent since it's rebuilt via innerHTML on every render.
    els.entryContent.addEventListener('click', (e) => {
      const pill = e.target.closest('[data-search-form]');
      if (!pill) return;
      els.searchInput.value = pill.getAttribute('data-search-form');
      renderResults(search(els.searchInput.value));
    });

    initMenu();
    initSheet();
    syncChromeHeights();
    window.addEventListener('resize', syncChromeHeights);
    // Web fonts land after first paint and change both bars' heights.
    if (document.fonts) document.fonts.ready.then(syncChromeHeights);

    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    initSearchMode();
    // Paint the scope-specific hint on first load: without this the results
    // pane started out blank and only picked up its hint once a query had been
    // typed and cleared.
    renderResults([]);
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
      els.modeCycle.setAttribute('aria-label', ui.label);
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
