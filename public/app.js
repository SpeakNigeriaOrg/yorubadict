// public/app.js
//
// Runtime responsibilities (per spec section 3.2): load the prebuilt
// browser-ready assets, perform all searches locally, render entries,
// navigate between entries. No network requests after initial load.
//
// The markup for an entry is not here any more - it is in entry-render.mjs,
// which the build also imports so it can write a real HTML file per word. This
// file is what turns those strings into a page you can click around.

import { createEntryRenderer } from './entry-render.js';
import { createPageRenderer } from './page-render.js';

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
  // The entry renderer
  //
  // Built once, used for every page. The entry map is handed over as a getter
  // rather than a value because it is null right now: boot() paints the page
  // before the dictionary arrives, deliberately, so a link to a word does not
  // show a blank while 12 MB downloads.
  // ---------------------------------------------------------------

  const renderer = createEntryRenderer({
    get entries() {
      return state.entries || {};
    },
    get mentionedByKey() {
      return (state.index && state.index.mentioned && state.index.mentioned.byKey) || {};
    },
    pathFor: (entryId) => pathForEntry(entryId),
    mentionedPath: (spelling) => `/mentioned/${encodeURIComponent(spelling)}`,
    pagePath: (name) => (name === 'welcome' ? '/' : `/${name}`),
    orthographyInsensitive,
  });


  const {
    entryHtml,
    titleFor,
    section,
    escapeHtml,
    firstGloss,
    relationPillsHtml,
    mentionedPathFor,
  } = renderer;

  // After the destructure above, because it is handed escapeHtml by value.
  const pages = createPageRenderer({
    pathFor: (entryId) => pathForEntry(entryId),
    pagePath: (name) => (name === 'welcome' ? '/' : `/${name}`),
    escapeHtml,
  });

  // A prerendered page already holds its entry. handleRoute leaves the first
  // route alone so the markup that arrived is the markup that stays; see there.
  let hydrated = false;

  /** Put an entry on the page. The markup itself comes from entry-render.js. */
  function renderEntry(entry) {
    els.entryContent.innerHTML = entryHtml(entry);
    document.title = titleFor(entry);
  }

  // ---------------------------------------------------------------
  // Sorted-array search helpers
  // ---------------------------------------------------------------
  //
  // lowerBound / exactMatch / prefixMatches moved into english-relevance.js alongside the ranking
  // itself, so a Node checker can exercise the real search rather than a copy of it - see that
  // file's note. The dialect tier stays here because its matching has a side effect.

  const lowerBound = EnglishRelevance.lowerBound;

  // ---------------------------------------------------------------
  // Combined ranking
  //
  // HARD, in order - each is an identification, and nothing outranks one:
  //   1. exact Yorùbá match
  //   2. tone-insensitive match
  //   3. orthography-insensitive match
  //   4. dialect tier (a variety's word for a standard entry)
  //
  // SOFT, merged and sorted by score - both are guesses of a different kind:
  //   5. prefix matches, scored by how much of the word the query covers
  //   6. English gloss matches, scored by relevance
  //
  // Spec section 7 described 5 and 6 as separate ranked tiers, prefix always first. That is what
  // buried ojú for "eye" - see the note at the soft block below. Deterministic either way: dedupes
  // by id, and the soft block sorts on score with no dependence on corpus order.
  // ---------------------------------------------------------------

  // Handed to rankQuery to switch a half off, so the scope toggle needs no branching inside it.
  const EMPTY_TIER = { spellings: [], postings: {} };
  const EMPTY_ENGLISH = { postings: {}, df: {}, tokens: [], docEntryIds: [], docLengths: [], docSenseIdx: [], avgDocLength: 1, totalDocs: 0, glossDocCount: 0, inheritedDocStart: 0, slugDocStart: 0, docSource: {}, exactClauses: {} };

  function search(query, limit = 40) {
    const trimmed = query.trim();
    if (!trimmed || !state.ready) return [];

    const mode = state.searchMode;
    const y = state.index.yoruba;

    // Why the dialect tier sits with the hard tiers: it matches a word a *variety* uses and returns
    // the standard entry it belongs to, so it is an identification rather than a partial spelling.
    // It is Yorùbá, so it belongs to the YO scope and is skipped when only EN is lit. Computed here
    // rather than inside rankQuery because it records which varieties produced each hit.
    state.dialectMatches = new Map();
    const dialectIds =
      mode === 'both' || mode === 'yoruba'
        ? dialectMatches(y.dialect, orthographyInsensitive(trimmed), limit)
        : [];

    // A synonym-tier hit is not a spelling of the entry it returns - it is a word some OTHER entry
    // calls another way of saying what it means. Recorded here for the same reason the dialect tier
    // is: a row that cannot say why it appeared looks like a bug in the search.
    state.synonymMatches = new Map();
    if (mode !== 'english') recordSynonymMatches(y.synonym, orthographyInsensitive(trimmed));

    // Filled by bm25Search: which document won for each entry. Lets a row show the meaning that
    // actually matched, and say when it was reached through another word's definition.
    const out = {};
    const helpers = {
      orthographyInsensitive: orthographyInsensitive,
      toneInsensitive: toneInsensitive,
      dialectIds: dialectIds,
      out: out,
      formOfEntry: function (entryId) {
        const entry = state.entries[entryId];
        if (!entry) return '';
        return entry.canonicalForm ? entry.canonicalForm.value : entry.headword;
      },
    };

    // Scope toggles are applied by handing rankQuery an empty half rather than by branching inside
    // it: an EN-only search gets no Yoruba tiers, a YO-only search no gloss index.
    const scoped = {
      yoruba: mode === 'english'
        ? { exact: EMPTY_TIER, tone: EMPTY_TIER, ortho: EMPTY_TIER, synonym: EMPTY_TIER }
        : y,
      english: mode === 'yoruba' ? EMPTY_ENGLISH : state.index.english,
    };

    const ids = EnglishRelevance.rankQuery(scoped, state.index.components || {}, trimmed, limit, helpers);
    state.winningDoc = out.winningDoc || new Map();
    return ids.map((id) => state.entries[id]);
  }

  // Which entries some other entry's definition names this spelling for, and which of that entry's
  // meanings did the naming. Exact match only - see synonymTierMatches.
  function recordSynonymMatches(tier, key) {
    if (!tier || !tier.spellings || !key) return;
    const i = lowerBound(tier.spellings, key);
    if (i >= tier.spellings.length || tier.spellings[i] !== key) return;
    for (const posting of tier.postings[key] || []) {
      if (!state.synonymMatches.has(posting.id)) state.synonymMatches.set(posting.id, posting.sense);
    }
  }

  // What a row should show as its definition, and why it is in the list at all.
  //
  // firstGloss alone is wrong often enough to read as a bug: searching "money" returns pa and shows
  // "to gain, to make", and "sell" returns ọ̀bù showing "market". matchProvenance says which meaning
  // actually won, so use that when the match was about meaning, and fall back to the first when the
  // query was a spelling - there the word IS the answer and its main meaning is the useful thing.
  function rowMeaningAndNote(entry) {
    const glossesOf = (i) => {
      const sense = i === null || i === undefined ? null : entry.senses[i];
      return sense ? (sense.glosses || []).join('; ') : firstGloss(entry);
    };

    // Reached because THIS entry's definition names the query as another word for it.
    if (state.synonymMatches && state.synonymMatches.has(entry.id)) {
      return {
        meaning: glossesOf(state.synonymMatches.get(entry.id)),
        note: 'Listed here as a similar word',
      };
    }

    const docIdx = state.winningDoc ? state.winningDoc.get(entry.id) : undefined;
    const where = EnglishRelevance.matchProvenance(state.index.english, docIdx);
    if (!where) return { meaning: firstGloss(entry), note: '' };

    // Reached because some OTHER entry named this word as another way to say what it means.
    if (where.kind === 'inherited') {
      const namer = where.namedBy && state.entries[where.namedBy[0]];
      const namerForm = namer ? (namer.canonicalForm ? namer.canonicalForm.value : namer.headword) : '';
      return {
        meaning: firstGloss(entry),
        note: namerForm ? `Another way to say ${namerForm}` : '',
      };
    }

    return { meaning: glossesOf(where.senseIndex), note: '' };
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
      // An <a>, not a <button>. These were buttons with click handlers, which
      // meant the search pane produced no links at all - so on top of every word
      // living at one URL, there was no link graph for a crawler to follow even
      // if there had been. It also cost readers the ordinary things a link does:
      // middle-click, copy link address, open in a new tab.
      //
      // role="option" is kept, and so is the keyboard handling in
      // onSearchKeydown: this is a listbox to a screen reader, and being a link
      // does not change that. Navigation itself is handled by the delegated
      // click listener in interceptLinks, like every other internal link.
      const btn = document.createElement('a');
      btn.className = 'result-item';
      btn.setAttribute('role', 'option');
      btn.href = pathForEntry(entry.id);
      btn.dataset.index = String(i);
      // A dialect-tier hit isn't a spelling of this headword - it's a word a
      // variety uses for it - so the row says which varieties matched instead
      // of leaving an apparently unrelated result unexplained.
      const varieties = state.dialectMatches?.get(entry.id);
      const dialectNote = varieties
        ? `<div class="result-dialect">${escapeHtml([...varieties].slice(0, 3).join(' · '))}${varieties.size > 3 ? ` +${varieties.size - 3}` : ''}</div>`
        : '';
      // Same problem, same treatment: a row reached through a synonym declaration shows the meaning
      // that matched and says how it got here. A dialect note wins if somehow both apply - it is the
      // more direct statement about the spelling the reader typed.
      const { meaning, note } = rowMeaningAndNote(entry);
      const relationNote = note && !varieties
        ? `<div class="result-relation">${escapeHtml(note)}</div>`
        : '';

      btn.innerHTML = `
        <div class="result-headword">${escapeHtml(entry.canonicalForm.value)}</div>
        <div class="result-meta">${escapeHtml(entry.pos || '')}${entry.etymologyNumber ? ' · etym. ' + escapeHtml(entry.etymologyNumber) : ''}</div>
        <div class="result-gloss">${escapeHtml(meaning)}</div>
        ${dialectNote}
        ${relationNote}
      `;
      els.resultsList.appendChild(btn);
    });

    appendMentionedRow();
  }

  // A word several entries name but the dictionary has no page for, offered at the
  // END of the list and never inside it.
  //
  // Kept out of rankQuery entirely rather than scored low: it is not an entry, and
  // no ranking constant should be able to promote it above one by accident. That
  // also means it appears whether or not the search found anything, which is the
  // case that matters - most of these words returned nothing at all before.
  function appendMentionedRow() {
    const query = els.searchInput.value.trim();
    if (!query || state.searchMode === 'english') return;
    const href = mentionedPathFor(query);
    if (!href) return;
    const byKey = state.index.mentioned.byKey;
    const spelling = byKey[orthographyInsensitive(query)];
    // Already answered by a real entry of that spelling - no need to say the
    // dictionary lacks one.
    if (state.activeResults.some((e) => orthographyInsensitive(e.forms.exact) === orthographyInsensitive(spelling))) return;

    const row = document.createElement('a');
    row.className = 'result-item result-mentioned';
    row.href = href;
    row.innerHTML = `
      <div class="result-headword">${escapeHtml(spelling)}</div>
      <div class="result-meta">no entry yet</div>
      <div class="result-relation">Other entries name this word — see which</div>`;
    els.resultsList.appendChild(row);
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




  // A pill stands for one word, not one database row. Where several entries
  // share a spelling we have to pick one to link to, and that pick is
  // frequently a guess: 20 of the 24 ambiguous "Derived from" groups can't be
  // resolved from anything Wiktionary records, and every "Component words"
  // pill over a shared spelling is showing you the first candidate. Rendering
  // one pill per entry instead just repeated identical text (ìdá showed ten
  // identical "dá verb" pills); rendering one pill and saying nothing hides a
  // wrong guess behind a confident link. So: one pill, with every alternative
  // reachable from it and the reason we're unsure stated in words.






  // ---------------------------------------------------------------
  // Words other entries name, and this dictionary has no page for
  // ---------------------------------------------------------------


  // Deliberately not an entry, and it has to keep saying so. Nothing here invents
  // a part of speech, a pronunciation, an etymology or a definition - it reports
  // that several entries use this word in their own definitions and that the
  // dictionary has no page for it, which is a fact about the data rather than a
  // claim about Yoruba. A guessed entry would be worse than the dead end it
  // replaces.
  function renderMentionedWord(text) {
    const known = state.index && state.index.mentioned && state.index.mentioned.byKey;
    const spelling = known ? known[orthographyInsensitive(text)] || text : text;
    document.title = `${spelling} — Sọ̀rọ̀ Sókè`;

    const shell = (inner) => {
      els.entryContent.innerHTML = `
        <div class="entry-header">
          <span class="entry-headword">${escapeHtml(spelling)}</span>
          <span class="entry-inferred-badge" title="No entry has been written for this word yet.">no entry yet</span>
        </div>
        <div class="tone-rule divider" aria-hidden="true"><span></span><span></span><span></span></div>
        <div id="mentioned-body">${inner}</div>
        <div class="entry-provenance-note">
          Source: Wiktionary. This page is not a dictionary entry — it lists what other
          entries say, and nothing else.
        </div>`;
    };

    const body = (data) => {
      const word = (data.words || []).find(
        (w) => orthographyInsensitive(w.text) === orthographyInsensitive(spelling)
      );
      if (!word) return '<p>Nothing in this dictionary names this word.</p>';
      const rows = word.namedBy
        .map((n) => {
          const entry = state.entries && state.entries[n.entryId];
          if (!entry) return '';
          const form = entry.canonicalForm ? entry.canonicalForm.value : entry.headword;
          return `<a class="mentioned-row" href="#/entry/${encodeURIComponent(n.entryId)}">
            <span class="mentioned-word">${escapeHtml(form)}</span>
            <span class="mentioned-meta">${escapeHtml(entry.pos || '')}</span>
            <span class="mentioned-meaning">${escapeHtml(n.meaning)}</span>
          </a>`;
        })
        .filter(Boolean)
        .join('');
      return `
        <p class="mentioned-lede">${word.namedBy.length} entries name <em>${escapeHtml(spelling)}</em> as another way to say what they mean. It has no entry of its own here, because Wiktionary has no page for it.</p>
        <div class="entry-section-title">Named by</div>
        <div class="mentioned-list">${rows}</div>
        <p class="blocks-note">Each meaning above is the one that named this word. Writing the entry on Wiktionary is what brings it into this dictionary. <a href="#/contribute">How to help</a>.</p>`;
    };

    if (state.mentionedWords) {
      shell(body(state.mentionedWords));
      return;
    }
    shell('<p>Loading…</p>');
    fetch('/data/mentioned-words.json')
      .then((r) => r.json())
      .then((data) => {
        state.mentionedWords = data;
        // Only patch if the reader is still on this page.
        if (document.getElementById('mentioned-body')) shell(body(data));
      })
      .catch(() => {
        const host = document.getElementById('mentioned-body');
        if (host) host.innerHTML = '<p>That list could not be loaded.</p>';
      });
  }





















  // ---------------------------------------------------------------
  // Routing
  //
  // Real paths - /gba/receive - not the #/entry/<id> fragments this used to
  // use. A fragment is never sent to a server, so every word in the dictionary
  // answered at one URL and a search engine could only ever see the front page.
  // The build now writes a real HTML file per word, and this navigates between
  // them without reloading.
  //
  // The addresses come from data/url-slugs.json by way of build/lib/address.mjs,
  // and each entry carries its own in `entry.path`. Old hash links still work:
  // redirectLegacyHash below turns them into paths, in the page, because
  // nothing else can.
  // ---------------------------------------------------------------

  function pathForEntry(entryId) {
    const entry = state.entries && state.entries[entryId];
    // Before the dictionary lands there is nothing to look the address up in,
    // and a link has to exist anyway. Resolved the moment the entry map arrives -
    // see handleRoute.
    //
    // The underscore is load-bearing. This was /go/<id> until go, gò, gọ̀ and gọ -
    // four real Yorùbá verbs - all landed at /go/<word> and shadowed it. A folded
    // spelling can only ever be [a-z0-9-], so a segment containing an underscore
    // is impossible to collide with, by construction rather than by remembering.
    return (entry && entry.path) || `/_entry/${encodeURIComponent(entryId)}`;
  }

  function navigateTo(entryId) {
    go(pathForEntry(entryId));
  }

  /** Move to a path without reloading, and render what lives there. */
  function go(path, { replace = false } = {}) {
    if (path === location.pathname) return;
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
    handleRoute();
  }

  // Any click on an internal link is navigation, not a page load. Delegated
  // from the document so it covers markup that is rewritten on every render -
  // every relation pill, every sibling row, every link inside a written page.
  function interceptLinks(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    // Leave alone: anything off-site, anything with a target, downloads, and
    // plain fragment links, which the browser scrolls to on its own.
    if (!href || !href.startsWith('/') || link.target || link.hasAttribute('download')) return;
    if (link.origin && link.origin !== location.origin) return;
    event.preventDefault();
    go(href);
  }

  // Hash links from before every word had its own address. They cannot be
  // redirected by a server - a fragment is never sent to one - so the only
  // place this can happen is here, and it has to keep happening: those links
  // are in other people's pages and messages, and they are the only kind of
  // link this dictionary had for its first year.
  //
  // Split in two by what each needs. A link to /about can be answered before
  // anything has downloaded; a link to a word cannot, because working out where
  // that word lives means having the dictionary. Running both late meant an old
  // link to About showed the welcome page for as long as the dictionary took to
  // arrive, which on a slow connection was twelve seconds.
  function redirectLegacyPageHash() {
    const hash = location.hash || '';
    const pageMatch = hash.match(/^#\/([a-z-]*)$/);
    if (pageMatch) {
      const page = pages.byName.get(pageMatch[1] || 'welcome');
      history.replaceState({}, '', page ? page.path : '/');
      return true;
    }
    const mentionedMatch = hash.match(/^#\/mentioned\/(.+)$/);
    if (mentionedMatch) {
      history.replaceState({}, '', `/mentioned/${encodeURIComponent(decodeURIComponent(mentionedMatch[1]))}`);
      return true;
    }
    return false;
  }

  function redirectLegacyEntryHash() {
    const entryMatch = (location.hash || '').match(/^#\/entry\/(.+)$/);
    if (!entryMatch) return false;
    const entry = state.entries && state.entries[decodeURIComponent(entryMatch[1])];
    if (!entry) return false;
    history.replaceState({}, '', entry.path);
    handleRoute();
    return true;
  }

  /** Show a written page, and fetch its list if it has one. */
  function renderPage(page) {
    const data = page.name === 'building-blocks' ? state.buildingBlocks
      : page.name === 'contribute' ? state.tasks
      : null;
    els.entryContent.innerHTML = page.html(data);
    document.title = page.title;
    setDescription(page.description);

    loadPageList(page);
  }

  /**
   * Fill in the generated list on the two pages that have one.
   *
   * Split out of renderPage because it is needed on a path that never calls
   * renderPage. A prerendered page keeps the markup it arrived with, and that
   * markup carries "Loading the list…" where the list goes - the prose is
   * written to the file at build time and the list deliberately is not. So the
   * fetch has to happen whether the page was just rendered or merely landed on.
   */
  function loadPageList(page) {
    const needs = page.name === 'building-blocks'
      ? { file: '/data/building-blocks.json', key: 'buildingBlocks', host: 'blocks-list', list: pages.buildingBlocksListHtml }
      : page.name === 'contribute'
        ? { file: '/data/wiktionary-tasks.json', key: 'tasks', host: 'tasks-list', list: pages.contributeListHtml }
        : null;
    if (!needs) return;
    const patch = (html) => {
      // Only if the reader is still on this page.
      const host = document.getElementById(needs.host);
      if (host) host.innerHTML = html;
    };
    // Already fetched once this session. renderPage passed it to page.html
    // and needs nothing more, but a prerendered arrival still shows the
    // placeholder, so patch either way rather than returning early.
    if (state[needs.key]) return patch(needs.list(state[needs.key]));
    fetch(needs.file)
      .then((r) => r.json())
      .then((loaded) => {
        state[needs.key] = loaded;
        patch(needs.list(loaded));
      })
      .catch(() => patch('<p>The list could not be loaded.</p>'));
  }

  /** The one <meta name="description"> tag, kept in step with the page. */
  function setDescription(text) {
    const tag = document.querySelector('meta[name="description"]');
    if (tag) tag.setAttribute('content', text || '');
  }

  function handleRoute() {
    const path = decodeURIComponent(location.pathname);

    // A prerendered page arrives with its content already in the markup. Leaving
    // it alone on the first pass is the difference between a page that is simply
    // there and one that blanks and redraws after 12 MB has downloaded.
    //
    // Only when the markup says it is THIS page. Offline, the service worker
    // answers a word it has no file for with the cached shell, which is the
    // welcome page - honouring the flag then would leave a reader looking at
    // "Ẹ káàbọ̀." with the address of the word they asked for.
    if (hydrated === false) {
      hydrated = true;
      const arrived = els.entryContent.getAttribute('data-prerendered');
      els.entryContent.removeAttribute('data-prerendered');
      if (arrived && arrived.replace(/\/$/, '') === path.replace(/\/$/, '')) {
        // Keep the markup that arrived - but Contribute and Key Building
        // Blocks arrive holding a placeholder where their generated list goes,
        // and nothing else on this path would ever fetch it.
        const landed = pages.byPath.get(path);
        if (landed) loadPageList(landed);
        return;
      }
    }

    const page = pages.byPath.get(path);
    if (page) {
      renderPage(page);
      onEntryRendered();
      return;
    }

    const mentioned = path.match(/^\/mentioned\/(.+)$/);
    if (mentioned) {
      if (!state.ready) return showLoading();
      renderMentionedWord(mentioned[1]);
      onEntryRendered();
      return;
    }

    // The placeholder a link gets when it is built before the dictionary
    // arrives. Never a real address, so it is swapped for one the moment there
    // is something to look it up in.
    const pending = path.match(/^\/_entry\/(.+)$/);
    if (pending) {
      if (!state.ready) return showLoading();
      const entry = state.entries[pending[1]];
      if (entry) return go(entry.path, { replace: true });
    }

    // Someone arriving on a link to a word shouldn't be shown the welcome page
    // in the meantime and left to wonder whether the link was wrong;
    // handleRoute runs again once the dictionary lands.
    //
    // Every word lives under /yo/ so the root stays free for pages the site may
    // want later - see build/lib/address.mjs.
    if (/^\/yo\/[^/]+\/[^/]+\/?$/.test(path)) {
      if (!state.ready) return showLoading();
      const entry = state.byPath[path.replace(/\/$/, '')];
      if (entry) {
        renderEntry(entry);
        onEntryRendered();
        return;
      }
    }

    // /yo/<spelling> lists the words written that way. Prerendered, and left to
    // the file on disk: the app has no renderer for it, so a click arriving here
    // falls through to the welcome page while a direct visit gets the real page.
    if (/^\/yo\/[^/]+\/?$/.test(path)) {
      if (els.entryContent.innerHTML.includes('sibling-list')) return;
    }

    renderPage(pages.byName.get('welcome'));
    if (mobileQuery.matches) window.scrollTo({ top: 0 });
  }

  function showLoading() {
    els.entryContent.innerHTML =
      '<div class="entry-welcome"><p>Loading the dictionary…</p></div>';
  }

  /** Would this path have shown "Loading the dictionary…" before the data arrived? */
  function needsDictionary(path) {
    if (pages.byPath.has(path)) return false;
    return /^\/(mentioned|_entry)\//.test(path) || /^\/yo\/[^/]+\/[^/]+\/?$/.test(path);
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

  // On a narrow viewport the entry pane is a sheet that sits over the results,
  // and onEntryRendered scrolls it up there on purpose every time an entry or a
  // static page renders. Typing then puts results into a pane that is off the
  // top of the screen, so the search looks broken - most visibly on the pages
  // that are all text, like #/contribute.
  //
  // Fixed here rather than in each page's render function, so that adding a
  // page cannot forget it. Only when there is something typed, and only when
  // the results are actually out of view.
  function revealResults() {
    if (!mobileQuery.matches) return;
    if (!els.searchInput.value.trim()) return;
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  let debounceTimer = null;
  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderResults(search(els.searchInput.value));
      revealResults();
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
      <a class="quality-download" href="/data/validation-report.json" download="yorubadict-quality-report.json">
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
    // Old #/about-style links first, so the first route below answers the page
    // that was asked for rather than the welcome screen.
    redirectLegacyPageHash();
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
        state.validation = await fetch('/data/validation-report.json')
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

      // Same idea one level up: the "Possibly used in" heading has to say why
      // it's hedged, and that explanation is too long to sit permanently above
      // the list.
      const info = e.target.closest('.info-toggle');
      if (info) {
        const note = document.getElementById(info.getAttribute('aria-controls'));
        const open = info.getAttribute('aria-expanded') === 'true';
        info.setAttribute('aria-expanded', String(!open));
        if (note) note.hidden = open;
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
    // popstate, not hashchange: the address is a path now. Link clicks are
    // caught on the document so navigation covers markup rewritten on every
    // render, which is nearly all of it.
    window.addEventListener('popstate', handleRoute);
    document.addEventListener('click', interceptLinks);
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
      fetch('/data/entries.json').then((r) => r.json()),
      fetch('/data/search-index.json').then((r) => r.json()),
    ]);
    state.entries = entries;
    state.index = index;
    // Address -> entry, so a path can be resolved without walking 6,273 entries
    // on every click. Built here rather than shipped as a second file: it is
    // one pass over data already in memory.
    state.byPath = {};
    for (const entry of Object.values(entries)) {
      if (entry.path) state.byPath[entry.path] = entry;
    }
    state.ready = true;

    // Offline, and deliberately the last thing that happens.
    //
    // This used to sit up in the wiring, about forty lines above the paint
    // gate, on the reasoning that it is never awaited so it cannot hold a
    // reader up. Not awaiting a promise stops your code waiting for it; it
    // does not stop the work competing. Installing precaches the shell - which
    // is these same two files, entries.json and search-index.json - so the
    // browser was asked for the dictionary a second time while it was still
    // trying to produce the first frame.
    //
    // It got away with it only because the paint happened to win the race, and
    // then it stopped: taking the web fonts off fonts.googleapis.com removed
    // two origin handshakes from the front of the load, boot() finished
    // earlier against an unchanged paint, and the margin went from a reliable
    // +54ms to -2ms, +15ms, -1ms on three consecutive runs. A coin flip, on
    // the one thing a 25-point metric depends on.
    //
    // Here it can neither delay the paint nor compete with the fetch above,
    // and the revalidation it does is answered from the HTTP cache: Cloudflare
    // sends an ETag for these files, so each one is a 0-byte 304. See
    // public/sw.js for why its version check is not optional.
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support is the only thing lost, and the page works without it.
      });
    }

    // An old #/entry/<id> link, from before every word had its own address. It
    // can only be resolved now, because working out where that word lives means
    // having the dictionary, and only here, because a fragment never reaches a
    // server. Returns true if it moved us, and then the re-route below is its.
    const moved = redirectLegacyEntryHash();

    // Re-route ONLY for a deep link, which was showing "Loading the
    // dictionary…" and couldn't resolve until now. Calling handleRoute()
    // unconditionally re-rendered the welcome text over itself, and since
    // that replaces #entry-content wholesale it destroyed and recreated the
    // paragraph the browser had picked as the Largest Contentful Paint -
    // so LCP was re-recorded at whenever the dictionary happened to land.
    // Lighthouse read 14.0s against a page whose text had genuinely been on
    // screen since 227ms, and every one of those seconds was this line.
    //
    // Which routes need it: an entry page that arrived without its markup
    // prerendered, /mentioned/, and the /go/<id> placeholder. A prerendered
    // entry page needs nothing - its content has been on screen all along.
    if (!moved && needsDictionary(location.pathname)) handleRoute();
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
    // Both panels, not just this one. state.ready stays false when the load
    // fails, and the results panel renders its not-ready message off that -
    // "Loading the dictionary… your search will run as soon as it's here."
    // So a failed load told you it had failed in one half of the screen and
    // promised a search that was never coming in the other, indefinitely.
    els.entryContent.innerHTML =
      `<div class="entry-welcome"><h1>Couldn't load the dictionary</h1>` +
      `<p>${escapeHtml(err.message)}</p>` +
      (location.protocol === 'file:'
        ? `<p>This page was opened as a file. It has to be served over HTTP — see the README.</p>`
        : `<p>Reloading may fix it. If it does not, the dictionary file is not being served.</p>`) +
      `</div>`;
    if (els.resultsList) {
      els.resultsList.innerHTML =
        '<div class="results-empty">Search is unavailable — the dictionary did not load.</div>';
      els.resultsList.removeAttribute('role');
    }
  });
})();
