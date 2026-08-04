// tools/wiktionary/lib/worksheet.mjs
//
// The worksheet is one Markdown file that is both the briefing and the input.
//
// Markdown rather than JSON or YAML: it has to be read by a person deciding
// what to call a meaning, and JSON cannot carry the explanation while YAML
// would be the repo's first dependency. The parser reads only the lines
// matching `id:` inside an `## Etymology N` heading and ignores everything
// else, so the prose around them can be as long as it needs to be without any
// risk to the machine-readable part.
//
// The reference material is not decoration. You cannot judge what to call a
// meaning without seeing which words will point at it, so those are listed
// under the meaning they would attach to.

const HEADER_FIELDS = ['page', 'host', 'section', 'revision', 'summary'];

export function render({ page, hostPage, sectionIndex, revid, timestamp, collected, summary }) {
  const lines = [];
  const writable = collected.items.filter((i) => i.status === 'proposed');

  lines.push(`# ${page} — etymology names`, '');
  lines.push('```');
  lines.push(`page:     ${page}`);
  lines.push(`host:     ${hostPage}`);
  lines.push(`section:  ${sectionIndex}`);
  lines.push(`revision: ${revid}`);
  lines.push(`summary:  ${summary}`);
  lines.push('```', '');
  lines.push(`Read from en.wiktionary.org at revision ${revid} (${timestamp}).`, '');

  if (!writable.length) {
    lines.push(
      'There is nothing to write on this page. Every etymology already has a name.',
      'It is still in the work queue because the words built from it do not point at those',
      'names yet — that is the next job, not this one.',
      ''
    );
  } else {
    lines.push(
      'Edit the `id:` lines below, then run `check`. A blank `id:` skips that etymology.',
      'Everything that is not an `id:` line is reference material and is ignored by the tool.',
      ''
    );
  }

  for (const item of collected.items) {
    lines.push(...renderItem(item));
  }

  if (collected.unattributable.length) {
    lines.push('## Words that naming cannot fix', '');
    lines.push('These are built from this page, but no name would help them yet:', '');
    for (const r of collected.unattributable) {
      lines.push(`- **${r.word}** — ${r.why}`);
    }
    lines.push('');
  }

  if (collected.missingFromWikitext.length) {
    lines.push('## Warning', '');
    lines.push(
      `Our data has Etymology ${collected.missingFromWikitext.join(', ')}, which the page does ` +
        `not. The page has changed since the last data refresh; regenerate before trusting this.`,
      ''
    );
  }

  return lines.join('\n');
}

function renderItem(item) {
  const out = [];
  const identity = [item.spelling, item.pos, item.ipa].filter(Boolean).join(' · ');

  if (item.status === 'existing') {
    out.push(`## Etymology ${item.number} — already named: "${item.existingName}"`, '');
    out.push('    (no id: line — this name exists on Wiktionary and will not be touched)', '');
  } else if (item.status === 'unknown') {
    out.push(`## Etymology ${item.number} — we have no data for this one`, '');
    out.push(
      '    (no id: line — this etymology is on the page but nothing was extracted from it,',
      '     so we have no definition to name it by. It stays unnamed.)',
      ''
    );
  } else {
    out.push(`## Etymology ${item.number}`, '');
    out.push(`    id: ${item.name}`, '');
  }

  if (identity) out.push(`    ${identity}`);
  for (const [i, d] of item.definitions.entries()) out.push(`    ${i + 1}. ${d}`);
  if (!item.definitions.length && item.liveDefinitions.length) {
    out.push(`    on the page: ${item.liveDefinitions.join(' / ') || '(all template)'}`);
  }

  if (item.pointedAtBy.length) {
    out.push('', `    would be pointed at by:`);
    for (const r of item.pointedAtBy) {
      out.push(`      ${r.word}  "${r.definition}"  (${r.argument})`);
    }
  } else if (item.status !== 'unknown') {
    out.push('', '    nothing points here yet');
  }
  out.push('');
  return out;
}

// ---------------------------------------------------------------------------

export function parse(markdown) {
  const header = {};
  const fenced = markdown.match(/```\n([\s\S]*?)```/);
  for (const line of (fenced ? fenced[1] : '').split('\n')) {
    const match = line.match(/^\s*([a-z]+):\s*(.*)$/);
    if (match && HEADER_FIELDS.includes(match[1])) header[match[1]] = match[2].trim();
  }

  const names = new Map();
  let current = null;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+Etymology\s+(\d+)/);
    if (heading) {
      // Only the plain "## Etymology N" heading takes an id. The already-named
      // and no-data variants carry a dash and an explanation, and an id: line
      // typed under one of them is a mistake worth reporting rather than
      // silently obeying.
      current = /^##\s+Etymology\s+\d+\s*$/.test(line.trimEnd()) ? heading[1] : `!${heading[1]}`;
      continue;
    }
    if (/^##\s/.test(line)) current = null;
    const id = line.match(/^\s*id:\s*(.*)$/);
    if (id && current) names.set(current, id[1].trim());
  }

  return { header, names };
}

// Regenerating has to keep the decisions already made in the file, or the
// reference material would only ever be refreshable by throwing away the work.
export function mergeDecisions(collected, previous) {
  if (!previous) return collected;
  const items = collected.items.map((item) => {
    if (item.status !== 'proposed') return item;
    const kept = previous.names.get(item.number);
    return kept === undefined ? item : { ...item, name: kept };
  });
  return { ...collected, items };
}
