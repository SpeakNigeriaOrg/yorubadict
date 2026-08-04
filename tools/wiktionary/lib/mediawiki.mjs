// tools/wiktionary/lib/mediawiki.mjs
//
// The only file that talks to en.wiktionary.org.
//
// Reading is anonymous. Nothing here logs in unless `submit` asks it to, and
// nothing writes unless `edit()` is called, which happens in exactly one place
// behind a typed confirmation.
//
// The etiquette rules are properties of this client rather than arguments to
// its callers, so no call site can forget them:
//
//   - a User-Agent naming the tool and a contact address, per Wikimedia's
//     User-Agent policy
//   - maxlag=5 on every request, and Retry-After honoured
//   - assert=user on every write, so a dropped session fails loudly instead of
//     quietly editing as an IP address
//   - never bot=1. These are human-confirmed edits from a human account, and
//     en.wiktionary requires approval for the bot flag. Claiming it would be a
//     lie about how the edit was made.

const API = 'https://en.wiktionary.org/w/api.php';
const USER_AGENT =
  'yorubadict-etymid/0.1 (https://github.com/SpeakNigeriaOrg/yorubadict; admin@speaknigeria.org) Node.js';

export class Wiki {
  constructor({ api = API, dryRun = false } = {}) {
    this.api = api;
    this.dryRun = dryRun;
    this.cookies = new Map();
    this.csrfToken = null;
    this.username = null;
  }

  // Node's fetch has no cookie jar. MediaWiki's login flow needs one, and it
  // is small enough that pulling in a dependency for it would cost more than
  // it saves - the rest of this repo has none either.
  #cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  #storeCookies(response) {
    for (const line of response.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  async request(params, { method = 'GET', retries = 3 } = {}) {
    const body = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
    const url = method === 'GET' ? `${this.api}?${body}` : this.api;
    const headers = { 'User-Agent': USER_AGENT };
    if (this.cookies.size) headers.Cookie = this.#cookieHeader();
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const response = await fetch(url, { method, headers, body: method === 'POST' ? body : undefined });
    this.#storeCookies(response);
    const json = await response.json();

    // maxlag is a request to come back later, not a failure. Honouring it is
    // the whole point of sending it.
    if (json.error?.code === 'maxlag' && retries > 0) {
      const wait = Number(response.headers.get('retry-after') || 5);
      process.stderr.write(`  replication lag on the server; waiting ${wait}s\n`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.request(params, { method, retries: retries - 1 });
    }
    if (json.error) {
      throw new Error(`MediaWiki API error ${json.error.code}: ${json.error.info}`);
    }
    return json;
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  // Find the section holding a language, and the page it actually lives on.
  //
  // Not a search of the page's own wikitext, because that is wrong for `a`:
  // en.wiktionary splits oversized entries into "<page>/languages A to L" and
  // "<page>/languages M to Z", transcluded under an ==More languages== header.
  // Page `a` therefore contains no Yoruba section at all, and editing it by
  // section index would change something else. The sections API reports a
  // `fromtitle` per section, which is the page that must actually be edited.
  async resolveLanguageSection(page, language) {
    const found = await this.#findSection(page, language);
    if (found) return found;

    const parse = await this.request({ action: 'parse', page, prop: 'sections' });
    const split = parse.parse.sections.some((s) => /^More languages$/i.test(s.line));
    if (!split) {
      throw new Error(
        `No ${language} section on "${page}". The page exists but has no ${language} entry, ` +
          `or it is spelled differently there.`
      );
    }

    const subpages = await this.request({
      action: 'query',
      generator: 'allpages',
      gapprefix: `${page}/languages`,
      gapnamespace: '0',
      gaplimit: '20',
    });
    for (const sub of subpages.query?.pages || []) {
      const hit = await this.#findSection(sub.title, language);
      if (hit) return hit;
    }
    throw new Error(
      `"${page}" is split across subpages and none of them holds a ${language} section.`
    );
  }

  async #findSection(page, language) {
    const parse = await this.request({ action: 'parse', page, prop: 'sections' });
    const section = parse.parse.sections.find(
      (s) => s.level === '2' && s.line === language && s.index
    );
    if (!section) return null;
    return {
      hostPage: section.fromtitle || page,
      index: String(section.index),
      requestedPage: page,
    };
  }

  async fetchSection({ hostPage, index }) {
    const query = await this.request({
      action: 'query',
      prop: 'revisions',
      titles: hostPage,
      rvprop: 'content|ids|timestamp',
      rvslots: 'main',
      rvsection: index,
    });
    const page = query.query.pages[0];
    if (page.missing) throw new Error(`Page "${hostPage}" does not exist.`);
    const revision = page.revisions[0];
    return {
      wikitext: revision.slots.main.content,
      revid: revision.revid,
      timestamp: revision.timestamp,
    };
  }

  // The authoritative diff, rendered by the same code that will render it in
  // the page history. Slot parameters rather than the older flat fromtext/
  // totext, and no fromsection - that parameter is deprecated and warns.
  async unifiedDiff({ title, from, to }) {
    const result = await this.request(
      {
        action: 'compare',
        fromtitle: title,
        totitle: title,
        fromslots: 'main',
        toslots: 'main',
        'fromtext-main': from,
        'totext-main': to,
        'fromcontentmodel-main': 'wikitext',
        'tocontentmodel-main': 'wikitext',
        difftype: 'unified',
        prop: 'diff',
      },
      { method: 'POST' }
    );
    return stripHtml(result.compare?.body || '');
  }

  // The diff of what actually happened, fetched after the edit lands, so the
  // record holds the server's account of the change rather than ours.
  async revisionDiff({ fromrev, torev }) {
    const result = await this.request({
      action: 'compare',
      fromrev: String(fromrev),
      torev: String(torev),
      difftype: 'unified',
      prop: 'diff|size|title',
    });
    return stripHtml(result.compare?.body || '');
  }

  // -------------------------------------------------------------------------
  // Writing - reached only from `submit`, after a typed confirmation
  // -------------------------------------------------------------------------

  async login({ username, password }) {
    const tokenResponse = await this.request({ action: 'query', meta: 'tokens', type: 'login' });
    await this.request(
      {
        action: 'login',
        lgname: username,
        lgpassword: password,
        lgtoken: tokenResponse.query.tokens.logintoken,
      },
      { method: 'POST' }
    ).then((r) => {
      if (r.login?.result !== 'Success') {
        throw new Error(`Login failed: ${r.login?.result} ${r.login?.reason || ''}`);
      }
      this.username = r.login.lgusername;
    });

    const csrf = await this.request({ action: 'query', meta: 'tokens', type: 'csrf' });
    this.csrfToken = csrf.query.tokens.csrftoken;
    if (this.csrfToken === '+\\') throw new Error('Got an anonymous edit token - login did not stick.');
    return this.username;
  }

  async edit({ title, section, text, summary, baserevid, starttimestamp }) {
    if (!this.csrfToken) throw new Error('edit() called before login().');
    const result = await this.request(
      {
        action: 'edit',
        title,
        section: String(section),
        text,
        summary,
        baserevid: String(baserevid),
        starttimestamp,
        nocreate: '1',
        watchlist: 'watch',
        assert: 'user',
        token: this.csrfToken,
      },
      { method: 'POST' }
    );
    if (result.edit?.result !== 'Success') {
      throw new Error(`Edit did not succeed: ${JSON.stringify(result.edit)}`);
    }
    return result.edit; // { oldrevid, newrevid, newtimestamp, ... }
  }
}

// The compare API returns diff rows as an HTML table even for difftype=unified;
// the unified text is the cell contents.
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .filter((line) => line.trim())
    .join('\n');
}
