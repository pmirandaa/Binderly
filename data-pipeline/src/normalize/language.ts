// Language code normalization. Sources spell language codes
// inconsistently — `EN`, `en`, `en-US`, `English`, `Eng`, `JA`, `ja`,
// `ja-JP`, `Japanese`, `JP`, `JPN`. We standardize to the two-letter
// lowercase shorthand from `context/tcg-domain.md` § 5.

import type { Language } from '../types.js';

const ALIAS_TO_LANGUAGE: Readonly<Record<string, Language>> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  ja: 'jp',
  jp: 'jp',
  jpn: 'jp',
  japanese: 'jp',
  'ja-jp': 'jp',
  'jp-jp': 'jp',
};

/**
 * Map a free-form language string to our canonical two-letter code.
 * Throws for unsupported languages — we deliberately fail fast rather
 * than coerce to a default, so an adapter that starts emitting `de` /
 * `fr` / `it` / `pt` causes a loud test failure.
 */
export function normalizeLanguage(input: string): Language {
  if (!input) {
    throw new Error('normalize/language: input is empty');
  }
  const lc = input.trim().toLowerCase();
  const hit = ALIAS_TO_LANGUAGE[lc];
  if (hit) return hit;
  // Some adapters emit the IETF subtag with an uppercase region (e.g.
  // `en-US` after JSON parsing): try the head segment.
  const head = lc.split(/[-_]/)[0];
  if (head) {
    const fallback = ALIAS_TO_LANGUAGE[head];
    if (fallback) return fallback;
  }
  throw new Error(
    `normalize/language: unsupported language ${JSON.stringify(input)} (expected en or jp)`,
  );
}
