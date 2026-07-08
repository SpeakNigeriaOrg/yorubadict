// build/lib/orthography.mjs
//
// Yoruba orthography has three independent dimensions:
//   - base letters
//   - underdots (ẹ ọ ṣ — vowel/consonant quality)
//   - tone marks (grave à, acute á, macron/mid ā)
//
// We generate three normalized forms for every headword:
//   exact                  - untouched, as written
//   toneInsensitive         - tone marks stripped, underdots preserved
//   orthographyInsensitive  - tone marks AND underdots stripped, lowercased
//
// Implementation strategy: decompose to NFD so diacritics become separate
// combining codepoints, strip the ones we don't want for a given tier, then
// recompose to NFC so the result is normal, comparable Unicode text.

const TONE_MARKS = /[\u0300\u0301\u0302\u0304]/g; // grave, acute, circumflex, macron
const UNDERDOT_MARKS = /[\u0323\u0307]/g; // dot below (ẹ ọ), dot above (ṣ)

export function exactForm(s) {
  return s;
}

export function toneInsensitiveForm(s) {
  return s.normalize('NFD').replace(TONE_MARKS, '').normalize('NFC').toLowerCase();
}

export function orthographyInsensitiveForm(s) {
  return s
    .normalize('NFD')
    .replace(TONE_MARKS, '')
    .replace(UNDERDOT_MARKS, '')
    .normalize('NFC')
    .toLowerCase();
}

export function allForms(s) {
  return {
    exact: exactForm(s),
    toneInsensitive: toneInsensitiveForm(s),
    orthographyInsensitive: orthographyInsensitiveForm(s),
  };
}
