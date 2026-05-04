// Language detection — JP vs EN vs unknown.
//
// We never assume English without a positive signal: most listings
// are EN, but sellers don't say "english" in titles. The default
// stays `'unknown'` so downstream code can be honest about it.
//
// JP signals:
//   - `japanese` / `japan` / `jpn` / `jp` (the latter two require
//     stricter context to avoid set-code false positives like `JP`
//     appearing inside a number string)
//   - `1st edition japanese` / `japanese 1st edition`
//   - Hiragana / katakana / common kanji ranges in the *raw* title —
//     these survive preclean's NFKC normalization
//
// EN positive signals are sparse — `english`, `usa`, `wotc`. We emit
// `'en'` only when explicit to keep the field meaningful.

import type { ListingLanguage } from '../types.js';

export interface LanguageMatch {
  readonly language: ListingLanguage;
  readonly remaining: string;
  readonly signals: readonly string[];
}

const JP_TEXT_RE = /\b(?:japanese|japan|jpn)\b/;
// "JP" alone — must be followed/preceded by a strong context anchor
// (1st edition, edition, language indicator). Bare "jp" inside a
// number string is excluded by the word-boundary plus the
// non-numeric look-around.
const JP_BARE_RE = /\bjp\b(?!\s*\d)/;

// Hiragana + katakana + CJK Unified Ideographs (excluding extension
// blocks for engine portability).
const JP_SCRIPT_RE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

const EN_RE = /\b(?:english|wotc|wizards\s+of\s+the\s+coast)\b/;

function redactRange(s: string, start: number, end: number): string {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}

/**
 * Detect listing language. The raw (pre-preclean) title is used for
 * script detection because NFKC may convert full-width characters but
 * does not delete CJK content.
 */
export function detectLanguage(working: string, rawTitle: string): LanguageMatch {
  const signals: string[] = [];
  let remaining = working;
  let language: ListingLanguage = 'unknown';

  if (JP_SCRIPT_RE.test(rawTitle)) {
    language = 'jp';
    signals.push('language:jp-script');
  }

  // "japanese" / "japan" / "jpn" — a strong positive signal. We
  // deliberately do NOT match "1st edition japanese" as a single
  // unit so the variants pass still picks up "1st edition" in
  // titles like "1st Edition Japanese Charizard".
  const text = JP_TEXT_RE.exec(remaining);
  if (text && text.index !== undefined) {
    language = 'jp';
    signals.push('language:jp-text');
    remaining = redactRange(remaining, text.index, text.index + text[0].length);
  }

  const bare = JP_BARE_RE.exec(remaining);
  if (bare && bare.index !== undefined) {
    language = 'jp';
    signals.push('language:jp-bare');
    remaining = redactRange(remaining, bare.index, bare.index + bare[0].length);
  }

  if (language === 'unknown') {
    const en = EN_RE.exec(remaining);
    if (en && en.index !== undefined) {
      language = 'en';
      signals.push('language:en');
      remaining = redactRange(remaining, en.index, en.index + en[0].length);
    }
  }

  return { language, remaining, signals };
}
