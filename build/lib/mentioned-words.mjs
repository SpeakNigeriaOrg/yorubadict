// build/lib/mentioned-words.mjs
//
// Words this dictionary has no entry for, but which two or more entries name as
// another way to say what they mean.
//
// 4,575 sense-level synonym items survive kaikki-yoruba's debris filter, and only
// about half resolve to an entry. The rest are not noise - they are real Yoruba
// words Wiktionary's own definitions rely on and has no page for. Until now they
// rendered as dashed dead-end pills and were findable by nothing.
//
// The bar is TWO independent entries, and the reason is evidence rather than
// tidiness. Measured over the corpus, most single-word gaps are named exactly
// once, and one passing mention is as likely to be a typo or a variety-specific
// term as a word the dictionary is missing. Convergence is a different claim:
//
//   eginrin   7 entries, every one of them meaning corn or maize
//   àkòdì     5 entries, all courtyard or room
//   ìhà       5 entries, all rib or side
//   aginjù    4 entries: wilderness, jungle, desert
//   erùpẹ̀     4 entries: land/earth/soil, sand
//
// What this is NOT is a stub entry. Nothing here invents a part of speech, a
// pronunciation, an etymology, or a definition. The page says the dictionary has
// no entry, lists who names the word and with which meaning, and points at
// Wiktionary. A guessed lexicographic fact presented as an entry would be worse
// than the dead end it replaces - see wiktionary-tasks.mjs on why this repo
// never writes what it has not checked.
//
// Multi-word phrases are excluded. 679 of the gaps are phrases, and a phrase
// missing from a dictionary of words is usually not a gap at all.

/** Words named as a synonym by at least this many distinct entries. */
const MIN_DISTINCT_NAMERS = 2;

export function buildMentionedWords(entries) {
  const byText = new Map(); // text -> { text, namers: Map(entryId -> {senseIndex, meaning}) }

  for (const entry of entries) {
    (entry.senses || []).forEach((sense, senseIndex) => {
      for (const rel of sense.synonyms || []) {
        // Already in the dictionary, including through the tone/underdot
        // fallback - there is nothing missing to land on.
        if (rel.resolved || rel.foreign) continue;
        const text = (rel.text || '').trim();
        if (!text || text.includes(' ')) continue;

        if (!byText.has(text)) byText.set(text, { text, namers: new Map() });
        const record = byText.get(text);
        // One namer per entry however many of its meanings agree, so "two
        // independent entries" counts entries and not mentions.
        if (record.namers.has(entry.id)) continue;
        record.namers.set(entry.id, {
          entryId: entry.id,
          senseIndex,
          meaning: (sense.glosses || []).join('; '),
        });
      }
    });
  }

  const words = [];
  let namedOnce = 0;
  for (const record of byText.values()) {
    if (record.namers.size < MIN_DISTINCT_NAMERS) {
      namedOnce += 1;
      continue;
    }
    words.push({
      text: record.text,
      // Most-naming first, so the page opens with its strongest evidence.
      namedBy: [...record.namers.values()].sort((a, b) => a.entryId.localeCompare(b.entryId)),
    });
  }
  words.sort((a, b) => b.namedBy.length - a.namedBy.length || a.text.localeCompare(b.text));

  return {
    words,
    totals: {
      words: words.length,
      /** Distinct single words named by exactly one entry - deliberately left out. */
      namedOnce,
      mentions: words.reduce((n, w) => n + w.namedBy.length, 0),
    },
  };
}
