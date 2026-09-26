// build/lib/continuity.mjs
//
// Which entry in this week's data is which entry from last week.
//
// An entry's Kaikki id is the id of its first sense: the page, the part of
// speech, and a hash of that sense's text. So the id changes when a page moves,
// when a part of speech is corrected, when a sense is added above the first or
// the senses are reordered, when a {{senseid}} is added - and when a single word
// of the first definition is edited: deleting "Èkìtì" from ẹrẹja's gave it a new
// id. Any one id is fragile to some ordinary edit, and no better id fixes that:
// one built from the etymology number instead breaks on every renumbering.
//
// So continuity is decided on everything the data carries at once:
//
//   id evidence     the old id survives as one of the new entry's sense ids, or
//                   the other way round (the first sense was deleted), or the
//                   hash tail survives (a move, a part of speech corrected)
//   the meaning     how much of one entry's definitions the other's cover
//   the rest        spelling, written form, part of speech, headword, etymology
//
// and sorted into three tiers:
//
//   automatic   id evidence, or the same spelling and part of speech with
//               definitions that cover each other - one-to-one only
//   probable    partial evidence. A person decides, on the weekly sheet; until
//               then the old address points at the new entry temporarily
//   none        the old entry is gone as far as anything can tell
//
// A pair a person has already said is NOT the same word (`notSameAs` on the
// record) is never offered again.

export const idTail = (id) => id.slice(-8);

const writtenOf = (entry) =>
  ((entry.canonicalForm || {}).value || entry.headword || '').normalize('NFC');
const definitionsOf = (entry) =>
  (entry.senses || []).map((s) => (s.glosses || [])[0]).filter(Boolean);

/** What is kept about an entry once it has gone, to match it and to show it. */
export function snapshot(entry, spelling) {
  return {
    headword: entry.headword || '',
    pos: entry.pos || '',
    etymologyNumber: entry.etymologyNumber ?? null,
    written: writtenOf(entry),
    spelling,
    senseIds: (entry.senses || []).map((s) => s.id).filter(Boolean),
    definitions: definitionsOf(entry).slice(0, 5),
  };
}

const words = (definitions) =>
  new Set(
    definitions
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
  );

/**
 * How much the smaller set of definition words is covered by the larger, 0-1.
 * Overlap rather than Jaccard, because the commonest edit adds to a definition
 * ("musket, rifle" became "musket, rifle, Dane gun") and that is the same word.
 */
export function meaningOverlap(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return null;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.min(x.size, y.size);
}

/**
 * Does the English word in the address still describe the entry? Only asked of
 * the parts of the word the old definitions actually contained - "him-high"
 * came from "him" and a tone, and a word nobody took from the text cannot be
 * judged by it. False when every such part has left the definitions.
 */
export function wordStillFits(word, oldDefinitions, newDefinitions) {
  if (!word || !oldDefinitions.length || !newDefinitions.length) return true;
  const before = words(oldDefinitions);
  const after = words(newDefinitions);
  const fromText = word.split('-').filter((part) => before.has(part));
  if (!fromText.length) return true;
  return fromText.some((part) => after.has(part));
}

function evidenceFor(old, arrival) {
  const e = [];
  if (arrival.senseIds.includes(old.id)) e.push('its old id is one of the new entry\'s senses');
  if (old.senseIds.includes(arrival.id)) e.push('the new id was one of its senses');
  if (idTail(old.id) === idTail(arrival.id)) e.push('same id hash');
  const strong = e.length > 0;
  if (old.spelling === arrival.spelling) e.push('same spelling');
  if (old.written && old.written === arrival.written) e.push('same written form');
  if (old.pos === arrival.pos) e.push('same part of speech');
  if (old.headword === arrival.headword && old.etymologyNumber === arrival.etymologyNumber)
    e.push('same page section');
  const overlap = meaningOverlap(old.definitions, arrival.definitions);
  return { strong, overlap, evidence: e };
}

/**
 * @param {object} p
 * @param {object[]} p.entries           this week's entries
 * @param {object}   p.records           ledger records by id
 * @param {Map}      p.spellingOf        entry id -> address spelling
 * @param {object}   p.snapshots         old id -> snapshot, for records whose entry is gone
 * @returns {{automatic: object[], probable: Map<string, object[]>, unmatched: string[]}}
 */
export function matchArrivals({ entries, records, spellingOf, snapshots }) {
  const live = new Set(entries.map((e) => e.id));
  const orphans = Object.entries(records)
    .filter(([id, r]) => !live.has(id) && !r.gone)
    .map(([id, r]) => ({
      id,
      record: r,
      ...(snapshots[id] || {
        headword: '',
        pos: r.pos,
        etymologyNumber: r.etymologyNumber ?? null,
        written: (r.written || '').normalize('NFC'),
        spelling: r.spelling,
        senseIds: [],
        definitions: [],
      }),
    }));
  const arrivals = entries
    .filter((e) => !records[e.id])
    .map((e) => ({ id: e.id, ...snapshot(e, spellingOf.get(e.id)) }));

  // Every plausible pairing, scored once.
  const pairs = [];
  for (const arrival of arrivals) {
    for (const old of orphans) {
      if ((old.record.notSameAs || []).includes(arrival.id)) continue;
      const { strong, overlap, evidence } = evidenceFor(old, arrival);
      const sameSpelling = old.spelling === arrival.spelling;
      let tier = null;
      if (strong) tier = 'automatic';
      else if (sameSpelling && old.pos === arrival.pos && overlap !== null && overlap >= 0.7)
        tier = 'automatic';
      else if (
        (sameSpelling && (old.pos === arrival.pos || evidence.includes('same written form') || (overlap ?? 0) >= 0.3)) ||
        (overlap ?? 0) >= 0.8
      )
        tier = 'probable';
      if (tier) pairs.push({ from: old.id, to: arrival.id, tier, strong, overlap, evidence });
    }
  }

  // Automatic only when one-to-one: an old entry with two automatic claimants,
  // or an arrival claiming two old entries, is a question, not an answer.
  //
  // Id evidence is settled first, and meaning only among what it leaves. The
  // two pronouns on `i` have near-identical definitions, so on meaning alone
  // each looked like either - which hid that each had its own id hash intact.
  const automatic = [];
  const taken = new Set();
  const settle = (candidates) => {
    const open = candidates.filter((p) => !taken.has(p.from) && !taken.has(p.to));
    const countBy = (key) => open.reduce((m, p) => m.set(p[key], (m.get(p[key]) || 0) + 1), new Map());
    const fromCount = countBy('from');
    const toCount = countBy('to');
    for (const p of open) {
      if (fromCount.get(p.from) !== 1 || toCount.get(p.to) !== 1) continue;
      const old = orphans.find((o) => o.id === p.from);
      const arrival = arrivals.find((a) => a.id === p.to);
      automatic.push({
        from: p.from,
        to: p.to,
        overlap: p.overlap,
        evidence: p.evidence,
        // Kept its address, but the address may no longer describe it: someone
        // chose that word for what the entry used to say. Okù's address is
        // /oku/contextually, from a first sense that has since been deleted.
        meaningChanged:
          (p.overlap !== null && p.overlap < 0.3) ||
          !wordStillFits(old.record.word, old.definitions, arrival.definitions),
      });
      taken.add(p.from).add(p.to);
    }
  };
  settle(pairs.filter((p) => p.tier === 'automatic' && p.strong));
  settle(pairs.filter((p) => p.tier === 'automatic' && !p.strong));

  const probable = new Map();
  for (const p of pairs) {
    if (taken.has(p.from) || taken.has(p.to)) continue;
    if (!probable.has(p.to)) probable.set(p.to, []);
    probable.get(p.to).push({ from: p.from, overlap: p.overlap, evidence: p.evidence });
  }
  for (const list of probable.values()) {
    list.sort((a, b) => (b.overlap ?? -1) - (a.overlap ?? -1));
  }

  const claimed = new Set([...probable.values()].flat().map((c) => c.from));
  const unmatched = orphans.map((o) => o.id).filter((id) => !taken.has(id) && !claimed.has(id));
  return { automatic, probable, unmatched };
}
