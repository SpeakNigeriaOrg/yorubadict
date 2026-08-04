// tools/wiktionary/lib/wikitext.mjs
//
// Pure text functions. No network, no filesystem, no config - everything here
// is wikitext in, wikitext (or a verdict) out, so the parts that decide what
// we are about to change to somebody else's page are testable on their own.
//
// Everything below was written against the live wikitext of all 114 pages in
// the work queue (536 etymology sections), not against kọ alone. The comments
// record which real page forced which rule, because every one of them looks
// like an over-complication until you meet the page.

// ---------------------------------------------------------------------------
// Markup reduction
// ---------------------------------------------------------------------------

// Templates nest: sun's etymology 4 carries
//   # {{senseid|yo|to cry}} {{lb|yo|with {{l|yo|ẹkún|t=tears}}}} to [[cry]]
// A single non-greedy \{\{.*?\}\} pass eats "{{lb|yo|with {{l|yo|ẹkún|t=tears}}"
// and leaves a stray "}}". Repeatedly removing only the *innermost* templates -
// the ones containing no braces - unwinds the nesting correctly.
export function stripMarkup(text) {
  let out = text;
  let previous = null;
  while (previous !== out) {
    previous = out;
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  out = out.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1'); // [[target|shown]] -> shown
  out = out.replace(/\[\[([^\]]*)\]\]/g, '$1');
  out = out.replace(/'''/g, '').replace(/''/g, '');
  return out.replace(/\s+/g, ' ').trim().replace(/^[;,\s]+|[;,\s]+$/g, '');
}

function contentWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

// Does a definition line taken from wikitext describe the same thing as one of
// Kaikki's glosses for that section?
//
// Not string equality. Stripping templates removes text that Kaikki *keeps*,
// because Kaikki renders them rather than dropping them:
//
//   wikitext, stripped   "metal iron"
//   kaikki gloss         "metal (in particular) iron"       <- {{q|in particular}}
//   wikitext, stripped   "The tree and its seeds, ..."
//   kaikki gloss         "The tree Picralima nitida and ..." <- {{taxfmt|...}}
//
// Equality rejects 11 of the 502 verifiable sections in the queue, all of them
// correct. Subset-of-content-words in either direction rejects none of them,
// and still fires on 97% of sections when a page is deliberately misaligned by
// one etymology. Returns null when there is nothing left to compare, which is
// the honest answer for the 33 sections whose definition is entirely template.
export function definitionsAgree(fromWikitext, fromKaikki) {
  const a = contentWords(fromWikitext);
  if (!a.size) return null;
  const b = contentWords(fromKaikki);
  if (!b.size) return null;
  const subset = (x, y) => [...x].every((w) => y.has(w));
  return subset(a, b) || subset(b, a);
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

const ETYMOLOGY_HEADER = /^===\s*Etymology (\d+)\s*===[ \t]*$/gm;

// Split one language section into its numbered etymologies. Returns the text
// before the first etymology header (the L2 header itself, plus anything like
// ===Alternative forms=== that sits above them) so the section can be
// reassembled byte-for-byte.
export function splitEtymologies(sectionWikitext) {
  const headers = [...sectionWikitext.matchAll(ETYMOLOGY_HEADER)];
  if (!headers.length) return { preamble: sectionWikitext, blocks: [] };

  const blocks = headers.map((match, i) => {
    const start = match.index;
    const end = i + 1 < headers.length ? headers[i + 1].index : sectionWikitext.length;
    const raw = sectionWikitext.slice(start, end);
    return {
      number: match[1],
      headerLine: match[0],
      body: raw.slice(match[0].length),
      raw,
      start,
      end,
    };
  });
  return { preamble: sectionWikitext.slice(0, headers[0].index), blocks };
}

export function reassemble(preamble, blocks) {
  return preamble + blocks.map((b) => b.headerLine + b.body).join('');
}

// The definition lines of one etymology block. "# " only: "#:" is a usage
// example, "#*" a quotation, "##" a subsense - none of them is the definition
// we match against.
export function definitionLines(block) {
  return block.body
    .split('\n')
    .filter((line) => /^# [^#*:]/.test(line))
    .map((line) => stripMarkup(line.slice(1)));
}

const ETYMID = /\{\{\s*etymid\s*\|\s*([^|}]*?)\s*\|\s*([^}]*?)\s*\}\}/;

// The name this etymology already carries, or null. Read from live wikitext
// rather than trusted from the build output: the build data is up to a week
// old and anyone can add an anchor in the meantime.
export function existingEtymid(block, langCode = 'yo') {
  const match = block.body.match(ETYMID);
  if (!match || match[1] !== langCode) return null;
  return match[2];
}

// Insert on the line directly after the header. That is where all 19 of the
// etymids currently on queue pages sit, without exception - before the
// etymology prose, not after it.
export function insertEtymid(block, langCode, name) {
  const body = block.body.startsWith('\n') ? block.body.slice(1) : block.body;
  return { ...block, body: `\n{{etymid|${langCode}|${name}}}\n${body}` };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

// A name becomes the HTML anchor "Yoruba:_<name>" and the value of an idN=
// argument, so it cannot carry the characters that would end the template or
// the argument. Length is not a rule anyone enforces; a name long enough to be
// a sentence is a sign the definition was pasted in whole, so it is worth
// saying rather than blocking.
export function validateName(name) {
  const problems = [];
  if (!name.trim()) problems.push('is empty');
  if (name !== name.trim()) problems.push('has leading or trailing space');
  if (/[|}{=\n\[\]]/.test(name)) problems.push('contains one of | } { = [ ] or a newline');
  if (/^\s*[Ee]tymology\s*\d*\s*$/.test(name)) {
    problems.push('just repeats the section number, which names nothing');
  }
  return problems;
}
