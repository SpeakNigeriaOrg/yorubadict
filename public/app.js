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

    // 1. Yorùbá Search Path
    if (mode === 'both' || mode === 'yoruba') {
      push(exactMatch(y.exact, trimmed));
      push(exactMatch(y.tone, toneInsensitive(trimmed)));
      push(exactMatch(y.ortho, orthographyInsensitive(trimmed)));
      push(prefixMatches(y.ortho, orthographyInsensitive(trimmed), limit));
    }

    // 2. English Search Path
    if (mode === 'both' || mode === 'english') {
      push(bm25Search(trimmed, limit));
    }

    return ordered.slice(0, limit).map((id) => state.entries[id]);
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
      const msg = els.searchInput.value.trim()
        ? '<div class="results-empty">No entries found. Try a spelling without tone marks.</div>'
        : '<div class="results-hint">Start typing a Yorùbá word (with or without tone marks) or an English gloss.</div>';
      els.resultsList.innerHTML = msg;
      return;
    }

    results.forEach((entry, i) => {
      const btn = document.createElement('button');
      btn.className = 'result-item';
      btn.setAttribute('role', 'option');
      btn.dataset.index = String(i);
      btn.innerHTML = `
        <div class="result-headword">${escapeHtml(entry.canonicalForm.value)}</div>
        <div class="result-meta">${escapeHtml(entry.pos || '')}${entry.etymologyNumber ? ' · etym. ' + escapeHtml(entry.etymologyNumber) : ''}</div>
        <div class="result-gloss">${escapeHtml(firstGloss(entry))}</div>
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

  function relationPillsHtml(list, extraSynthesized) {
    const elements = [];
    
    for (const rel of list || []) {
      // 1. The Graceful Escape Hatch
      if (rel.type === 'external_link') {
        elements.push(`<div style="display: block; width: 100%; margin-top: 12px; padding: 12px 16px; background: var(--bg-surface, #f8fafc); border: 1px dashed #cbd5e1; border-radius: 6px; font-size: 0.9em;">
          <span style="color: #64748b; margin-right: 8px;" aria-hidden="true">⚠️</span>
          <span style="color: #475569; margin-right: 8px;">Some complex dialect tables couldn't be rendered here.</span>
          <a href="${escapeHtml(rel.url)}" target="_blank" rel="noopener noreferrer" style="color: #0284c7; text-decoration: none; font-weight: 500;">
            ${escapeHtml(rel.message)} ↗
          </a>
        </div>`);
        continue;
      }

      // 2. Standard Linked Terms
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
        elements.push(`<span class="relation-pill unresolved" title="Not yet resolvable">
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
        return `<span class="relation-pill unresolved" title="Bound morpheme - not an independent word">${escapeHtml(m.form)}${glossHtml}</span>`;
      }
      if (m.resolved && m.entryIds && m.entryIds.length > 0) {
        const target = state.entries[m.entryIds[0]];
        if (target) {
          const title = m.entryIds.length > 1
            ? ` title="${m.entryIds.length} entries share this spelling - linking to the first"`
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
      ? `<span class="entry-inferred-badge" title="No explicit canonical-form tag in the source data - showing Wiktionary's own headword as-is (“${escapeHtml(entry.canonicalForm.originalValue)}”).">no canonical tag</span>`
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
      ${section('Etymology', etymologyHtml)}
      ${section('Component words', morphemesHtmlStr)}
      ${section('Used in', usedInHtml)}
      ${section('Derived terms', derivedHtml)}
      ${section('Derived from', derivedFromHtml)}
      ${section('Related terms', relatedHtml)}
      ${section('Synonyms', synonymsHtml)}
      ${section('Antonyms', antonymsHtml)}
      ${section('Descendants', descendantsHtml)}

      <div class="entry-provenance-note">
        Source: Kaikki Wiktionary extract${entry.etymologyNumber ? ` · etymology ${escapeHtml(entry.etymologyNumber)}` : ''}.
        Original headword spelling: “${escapeHtml(entry.headword)}”.
        Entry id: <code>${escapeHtml(entry.id)}</code>
      </div>
    `;

    document.title = `${entry.canonicalForm.value} — Ọ̀rọ̀ | The Yoruba Dictionary`;
  }

  function renderWelcome() {
    els.entryContent.innerHTML = `
      <div class="entry-welcome">
        <h1>Ẹ káàbọ̀.</h1>
        <p>Search for a Yorùbá headword — with or without tone marks and underdots — or search by an English word that appears in a definition. Everything runs locally in your browser after the first load.</p>
        <p>Try: <em>fa</em>, <em>de</em>, <em>ile</em>, or <em>pull</em>.</p>
      </div>
    `;
    document.title = 'Ọ̀rọ̀ | The Yoruba Dictionary · Speak Nigeria';
  }

  function renderAbout() {
    els.entryContent.innerHTML = `
      <div class="about-content">
        <h1>About this dictionary</h1>
        <p class="about-lede">Wiktionary's raw data is one of the best resources online for learning Yorùbá, with extensive crowdsourced definitions and etymologies. The Wiktionary website itself, though, is poorly matched to language learners, whether in terms of quick single-word lookups or language exploration. This project keeps the data and rebuilds the experience around learning.</p>

        <h2>Why start from Wiktionary?</h2>
        <p>Yorùbá is fundamentally different from English in how it builds larger words out of smaller building-block words. People often think of etymology as an academic curiosity, but in languages like Yorùbá it is part of fluency. Understanding those building blocks is fundamental to using it as one. It's also fun. One of the things students in our own classes love most about the language. Wiktionary is not comprehensive in these breakdowns, but it's a better source for them than anywhere else online. We make it easier to find and explore these links.</p>

        <h2>Where Wiktionary falls short</h2>
        <p>Wiktionary's own site is difficult to use. To reliably find a word in Yorùbá, you generally want to type it without tone marks, but with underdots. Other combinations generally don't work. Wiktionary will then search every one of its languages for words with that spelling, and present every single result, with definitions, etymology, informative tables, etc., for every matching word in every language. Yorùbá will be down at the bottom of that page. Furthermore, because Wiktionary is crowdsourced, key details like etymology links between words are incredibly valuable to language learners but inconsistent in their entry and presentation. Sometimes a parent word documents the words derived from it, sometimes only the derived word documents where it came from, sometimes both, sometimes neither, depending entirely on which page a contributor happened to edit. Tracing a family of related words means guessing which page has the link and searching for it by hand.</p>

        <h2>What we changed</h2>
        <ul>
          <li><strong>Cleaned data, twice over.</strong> We start from Kaikki's already-cleaned extraction of Wiktionary's raw wikitext, then apply a light additional layer of our own processing.</li>
          <li><strong>Search it the way you'd write it.</strong> With or without tone marks, with or without underdots — every spelling of a Yorùbá word finds the same entry.</li>
          <li><strong>Search both directions at once.</strong> Most dictionaries make you choose Yorùbá-to-English or English-to-Yorùbá. Here you can search both together, or lock to either direction.</li>
          <li><strong>Links that go both ways.</strong> Whichever side of a relationship Wiktionary happens to document — parent or derived word — we automatically synthesize the missing reverse link, turning its inconsistent, crowdsourced etymology links into a real, two-way, navigable path through the language.</li>
        </ul>

        <h2>Part of Speak Nigeria</h2>
        <p>This dictionary is a project of <a href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">Speak Nigeria</a>, a nonprofit building free games and resources so children can learn and keep Nigerian heritage languages. If you're learning Yorùbá, our structured courses might also be a good fit.</p>

        <div class="about-actions">
          <a class="about-btn primary" href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">See our Yorùbá courses</a>
          <a class="about-btn ghost" href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">Visit speaknigeria.org ↗</a>
        </div>
      </div>
    `;
    document.title = 'About — Ọ̀rọ̀ | The Yoruba Dictionary';
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
      return;
    }

    const match = hash.match(/^#\/entry\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const entry = state.entries[id];
      if (entry) {
        renderEntry(entry);
        return;
      }
    }
    renderWelcome();
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
      <div class="quality-stat"><span>Total entries</span><strong>${v.totalEntries}</strong></div>
      <div class="quality-stat"><span>No explicit canonical tag</span><strong>${v.inferredCanonicalForms.length}</strong></div>
      <div class="quality-stat"><span>Entries missing IPA</span><strong>${v.missingIpa.length}</strong></div>
      <div class="quality-stat"><span>Unresolved relationship references</span><strong>${v.unknownReferencedWords.length}</strong></div>
      <div class="quality-stat"><span>Homograph spellings</span><strong>${Object.keys(v.duplicateNormalizedSpellings).length}</strong></div>
      <div class="quality-stat"><span>Circular derivation chains</span><strong>${v.circularDerivations.length}</strong></div>
      <div class="quality-note">
        These describe the underlying Wiktionary data, not bugs in this site — missing pronunciations, cross-references that don't resolve to an entry in this extract, homographs, and so on. "No explicit canonical tag" entries aren't necessarily wrong — most simply have no alternative spelling for Wiktionary to disambiguate from, so we show its headword as-is. Fixing a genuine data gap means editing the source entry on Wiktionary itself; we'll pick up the fix automatically next time we rebuild from a fresh extract.
      </div>
      <a class="quality-download" href="data/validation-report.json" download="yorubadict-quality-report.json">
        Download the full report (JSON) — every affected entry ID, for fixing on Wiktionary
      </a>
    `;
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
      if (e.key === 'Escape' && !els.qualityPanel.classList.contains('hidden')) {
        closeQualityPanel();
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

    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    // Hook up the search mode toggles (inside boot function)
    const modeRadios = document.querySelectorAll('input[name="search_mode"]');
    
    // Map modes to context-specific placeholders
    const placeholders = {
      both: 'Search Yorùbá or English… (ile, fa, pull…)',
      yoruba: 'Search Yorùbá headwords… (ile, fa, bàbá…)',
      english: 'Search English gloss… (house, pull, father…)'
    };

    modeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        // 1. Update the state
        state.searchMode = e.target.value;
        
        // 2. Update the visual placeholder
        els.searchInput.placeholder = placeholders[state.searchMode];
        
        // 3. Re-run search with the current input (if the user has already typed something)
        if (els.searchInput.value.trim()) {
          renderResults(search(els.searchInput.value));
        } else {
          // If the input is empty, reset the results view to update the "hint" text
          renderResults([]); 
        }
      });
    });
  }

  boot().catch((err) => {
    els.entryContent.innerHTML = `<div class="entry-welcome"><h1>Couldn't load the dictionary</h1><p>${escapeHtml(err.message)}</p><p>If you opened this file directly (file://), you'll need to serve it over HTTP — see the README.</p></div>`;
  });
})();
