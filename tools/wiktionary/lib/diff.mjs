// tools/wiktionary/lib/diff.mjs
//
// A local unified diff, so `preview` shows something before it asks the server
// anything. The server's own diff is fetched too and printed beside it - if the
// two disagree, our idea of what we are about to change is wrong, and that is
// worth finding out before the edit rather than after it.

function commonSubsequence(a, b) {
  // Standard LCS table. The inputs here are one section of one wikitext page -
  // a few hundred lines at most - so the quadratic table is not worth avoiding.
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) ops.push(['=', a[i++], j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  while (i < a.length) ops.push(['-', a[i++]]);
  while (j < b.length) ops.push(['+', b[j++]]);
  return ops;
}

export function unifiedDiff(before, after, context = 3) {
  const ops = commonSubsequence(before.split('\n'), after.split('\n'));
  if (!ops.some(([kind]) => kind !== '=')) return '';

  const keep = new Set();
  ops.forEach(([kind], index) => {
    if (kind === '=') return;
    for (let k = index - context; k <= index + context; k++) if (k >= 0 && k < ops.length) keep.add(k);
  });

  const out = [];
  let oldLine = 1;
  let newLine = 1;
  let hunk = null;
  ops.forEach(([kind, text], index) => {
    if (keep.has(index)) {
      if (!hunk) {
        hunk = { oldStart: oldLine, newStart: newLine, lines: [], oldCount: 0, newCount: 0 };
        out.push(hunk);
      }
      hunk.lines.push((kind === '=' ? ' ' : kind) + text);
      if (kind !== '+') hunk.oldCount++;
      if (kind !== '-') hunk.newCount++;
    } else {
      hunk = null;
    }
    if (kind !== '+') oldLine++;
    if (kind !== '-') newLine++;
  });

  return out
    .map(
      (h) =>
        `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n${h.lines.join('\n')}`
    )
    .join('\n');
}

// The two diffs are produced by different code from the same inputs, so they
// are compared on content rather than formatting: same set of added and removed
// lines, in the same order.
export function changedLines(unified) {
  return unified
    .split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.replace(/\s+$/, ''));
}
