// build/lib/normalizer.mjs
//
// Stage 2: Normalizer. Converts one raw Kaikki record into one canonical
// lexical entry. Every inferred value records its inference method,
// confidence, and the original source value — original data is never
// discarded, only supplemented.

import { allForms } from './orthography.mjs';

// Templates whose numeric args decompose a word into its constituent
// morphemes. "af"/"affix"/"prefix" were previously excluded entirely on
// the assumption they only ever mark a single bound prefix - real data
// disproves that: of 1,043 real af/affix templates in the corpus, 100%
// have 2+ numeric args, and 388 (37%) have 3-6, mixing bound prefixes
// with several free-standing real words (e.g. àmọ̀tẹ́kùn = à- + mọ̀ + tó +
// tó + ẹkùn). Cross-language templates (cog/bor/inh/der/doublet/calque)
// are excluded by design - their numeric arg is a language code, not a
// Yoruba word - and non-decomposition relations (clipping, etymid, etc.)
// are simply not in this set.
const MORPHEME_TEMPLATE_NAMES = new Set([
  'compound', 'com', 'compound+', 'reduplication', 'blend',
  'af', 'affix', 'prefix',
]);

/** Extracts every morpheme a word's etymology_templates decompose it
 * into, tagging each as bound (a grammatical prefix/suffix like à-, ẹ- -
 * never an independent word) or free (a real word, potentially already in
 * this dictionary). This is a PER-MORPHEME filter, not per-template: a
 * template mixing one bound prefix with several free words (the common
 * real shape for af/affix) keeps all its free morphemes rather than
 * discarding the whole template because of the one bound one. */
function extractEtymologyMorphemes(record) {
  const templates = Array.isArray(record.etymology_templates) ? record.etymology_templates : [];
  const morphemes = [];
  for (const t of templates) {
    if (!MORPHEME_TEMPLATE_NAMES.has(t.name)) continue;
    const args = t.args || {};
    if (args['1'] !== 'yo') continue;
    const numericKeys = Object.keys(args)
      .filter((k) => /^\d+$/.test(k) && k !== '1')
      .sort((a, b) => Number(a) - Number(b));
    numericKeys.forEach((key, i) => {
      const form = args[key];
      if (!form) return;
      // Glosses are keyed by POSITION in the content-morpheme sequence
      // (t1, t2, ...), not by the raw arg number - confirmed against real
      // data: àmọ̀tẹ́kùn's 5 morphemes are args 2-6, but their glosses are
      // t1-t5 (one per morpheme, in order), not t2-t6.
      const gloss = args[`t${i + 1}`] || null;
      morphemes.push({ form, gloss, bound: form.startsWith('-') || form.endsWith('-') });
    });
  }
  return morphemes;
}

function pickCanonicalForm(record) {
  const forms = Array.isArray(record.forms) ? record.forms : [];
  const tagged = forms.find((f) => Array.isArray(f.tags) && f.tags.includes('canonical'));

  if (tagged) {
    return {
      value: tagged.form,
      inferenceMethod: 'explicit_canonical_tag',
      confidence: 1.0,
      originalValue: record.word,
    };
  }

  // Fallback: no explicit canonical tag (common for "character"/letter
  // entries and some function words). Use the raw headword itself.
  return {
    value: record.word,
    inferenceMethod: 'fallback_headword',
    confidence: 0.5,
    originalValue: record.word,
  };
}

function extractAltForms(record, canonicalValue) {
  const forms = Array.isArray(record.forms) ? record.forms : [];
  return forms
    .filter((f) => f.form && f.form !== canonicalValue)
    .map((f) => ({ form: f.form, tags: f.tags || [] }));
}

function extractIpa(record) {
  const sounds = Array.isArray(record.sounds) ? record.sounds : [];
  return sounds
    .filter((s) => s.ipa)
    .map((s) => ({ ipa: s.ipa, tags: s.tags || [], note: s.note || null }));
}

function extractSenses(record) {
  const senses = Array.isArray(record.senses) ? record.senses : [];
  return senses.map((sense) => ({
    id: sense.id || null,
    glosses: sense.glosses || [],
    rawGlosses: sense.raw_glosses || sense.glosses || [],
    tags: sense.tags || [],
    examples: (sense.examples || []).map((ex) => ({
      text: ex.text || null,
      translation: ex.translation || ex.english || null,
    })),
    // Some senses carry their own nested relation lists (e.g. a
    // sense-specific "derived" list distinct from the entry-level one).
    // We fold these into the sense so nothing from the source is lost.
    links: (sense.links || []).map((l) => (Array.isArray(l) ? l[0] : l)),
  }));
}

// We now pass the raw page title (e.g., "ile") to build the correct URL
function extractRelationList(list, pageTitle) {
  if (!Array.isArray(list)) return [];
  const results = [];
  let addedFallback = false;

  for (const item of list) {
    if (!item || typeof item.word !== 'string' || !item.word.trim()) continue;

    const raw = item.word.trim();

    // STRICTER FILTER: Catch mangled tables (庽), long notes (> 50 chars), or sentences (contains ". ")
    if (raw.includes('庽') || raw.length > 50 || raw.includes('. ')) {
      if (!addedFallback) {
        // pageTitle matches the exact Wiktionary URL path (e.g., "ile")
        const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(pageTitle)}#Yoruba`;
        
        results.push({ 
          type: 'external_link', 
          url: url,
          message: "View complex dialect data on Wiktionary",
          text: "Dialect link" // Safety fallback so relationships.mjs doesn't crash on undefined
        });
        addedFallback = true;
      }
      continue; // Drop the academic garbage
    }

    // Standard, clean term
    results.push({
      type: 'term',
      text: raw,
      english: item.english || item.translation || null
    });
  }
  
  return results;
}

let idCounter = 0;

function deriveEntryId(record, senses) {
  // Prefer the first sense's Kaikki-assigned id: it's already a stable,
  // source-derived identifier that doesn't depend on our own spelling
  // normalization decisions.
  const firstSenseId = senses.find((s) => s.id)?.id;
  if (firstSenseId) return firstSenseId;

  // Fallback for records with no sense id at all (shouldn't normally
  // happen with Kaikki data, but the pipeline must not crash on it).
  idCounter += 1;
  const slug = (record.word || 'unknown')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return `generated-${slug}-${record.pos || 'x'}-${idCounter}`;
}

export function normalizeRecord(record, index) {
  const senses = extractSenses(record);
  const canonicalForm = pickCanonicalForm(record);
  const id = deriveEntryId(record, senses);

  // Use the raw Kaikki word (page title) for accurate Wiktionary linking
  const pageTitle = record.word;

  const entry = {
    id,
    headword: record.word,
    lang: record.lang || null,
    langCode: record.lang_code || null,
    pos: record.pos || null,
    etymologyNumber: record.etymology_number || null,
    etymologyText: record.etymology_text || null,
    etymologyMorphemes: extractEtymologyMorphemes(record),
    canonicalForm,
    altForms: extractAltForms(record, canonicalForm.value),
    ipa: extractIpa(record),
    senses,
    // Pass the pageTitle into our lists
    derivedTerms: extractRelationList(record.derived, pageTitle),
    relatedTerms: extractRelationList(record.related, pageTitle),
    synonyms: extractRelationList(record.synonyms, pageTitle),
    antonyms: extractRelationList(record.antonyms, pageTitle),
    descendants: extractRelationList(record.descendants, pageTitle),
    forms: allForms(canonicalForm.value),
    provenance: {
      source: 'kaikki',
      sourceLineIndex: index,
    },
  };

  return entry;
}


export function normalizeRecords(records) {
  return records.map((record, i) => normalizeRecord(record, i));
}
