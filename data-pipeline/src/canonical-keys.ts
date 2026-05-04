// Canonical key generators per `context/tcg-domain.md` § 5.
//
// These are PURE functions. Same input → same output, every run, every
// machine. They're the idempotency anchor for catalog ingestion: the
// drizzle schema declares `unique` on `set.canonical_key`,
// `card.canonical_key`, and `printing.variant_key`, so re-running the
// seed-ingest with the same source data lands an `ON CONFLICT DO
// UPDATE` instead of a duplicate row.
//
// Format reference (tcg-domain.md § 5):
//
//   set.canonical_key      = "{language}-{set_code}"           // en-swsh9
//   card.canonical_key     = "{language}-{set_code}-{number}"  // en-swsh9-018
//   printing.variant_key   = "{card.canonical_key}-{variant_code}"
//
// Number padding: zero-pad to 3 for purely-numeric numbers ("4" → "004",
// "018" → "018"). Lettered numbers stay as-is ("TG01" stays "TG01") —
// this is critical, "TG01" is NOT "TG1". See `rules/01-data-layer.md`
// "common pitfalls".
//
// `variant_code` is built by the variant classifier (`variant-classify.ts`)
// and shipped here as `printingVariantKey(printing, card)`; it expects
// the printing already carries its `variantCode`.

import type {
  CanonicalCard,
  CanonicalSet,
  Language,
  RawCard,
  RawPrinting,
  RawSet,
} from './types.js';

/**
 * Lowercase, strip whitespace and `/`, reject empty. Set codes vary
 * wildly across sources (`SWSH9`, `swsh9`, `Brilliant Stars`, etc.);
 * we standardize to the lowercased compacted form. Adapters should
 * have already done the source→canonical-code mapping in
 * `normalize/set-code.ts`.
 */
export function normalizeSetCodeForKey(rawCode: string): string {
  const cleaned = rawCode
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '');
  if (!cleaned) {
    throw new Error(
      `canonical-keys: set code is empty after normalization (input: ${JSON.stringify(rawCode)})`,
    );
  }
  return cleaned;
}

/**
 * Pad a numeric card number to 3 digits. Lettered or alphanumeric
 * numbers (TG01, GG12, SWSH001, SV001a, H1) are returned unchanged so
 * the source's intended formatting is preserved.
 *
 * Edge cases observed in the wild:
 *   - `"4"`        → `"004"`        (Base Set Charizard #4)
 *   - `"018"`      → `"018"`        (already padded; idempotent)
 *   - `"TG01"`     → `"TG01"`       (Trainer Gallery; preserved)
 *   - `"GG12"`     → `"GG12"`       (Galarian Gallery; preserved)
 *   - `"SWSH284"`  → `"SWSH284"`    (promo numbering; preserved)
 *   - `"H1"`       → `"H1"`         (vintage subset numbering; preserved)
 *   - `"4a"`       → `"4a"`         (alpha suffix triggers no padding —
 *                                    we cannot meaningfully pad past
 *                                    the alpha; preserved)
 *   - `"  04 "`    → `"004"`        (trim then pad)
 */
export function normalizeCardNumberForKey(rawNumber: string): string {
  const trimmed = rawNumber.trim();
  if (!trimmed) {
    throw new Error('canonical-keys: card number is empty');
  }
  // Pure numeric → zero-pad to 3.
  if (/^\d+$/.test(trimmed)) {
    return trimmed.padStart(3, '0');
  }
  // Anything with letters: preserve verbatim. Collectors and source
  // metadata both use the formatted form; `TG01` and `TG1` are
  // distinguishable in some sources (we treat them as identical only
  // when we explicitly normalize per-source upstream of this fn).
  return trimmed;
}

/**
 * `set.canonical_key` — `{language}-{set_code}`, e.g. `en-swsh9`,
 * `jp-s9`. Sets are identified across sources by this key; never by
 * their UUID `id`.
 *
 * Accepts either a `RawSet` or a `CanonicalSet` (the language and code
 * fields are present on both).
 */
export function canonicalSetKey(set: Pick<RawSet | CanonicalSet, 'language' | 'code'>): string {
  const lang = normalizeLanguage(set.language);
  const code = normalizeSetCodeForKey(set.code);
  return `${lang}-${code}`;
}

/**
 * `card.canonical_key` — `{language}-{set_code}-{number}`. The set
 * argument must carry an already-computed `canonical_key` (the typical
 * call site is the resolver after it has materialized the set), so we
 * don't re-normalize the set side here. Equivalent overload accepts a
 * raw set and normalizes — both produce the same key for the same
 * inputs.
 */
export function canonicalCardKey(
  card: Pick<RawCard | CanonicalCard, 'number'>,
  set: { canonicalKey: string },
): string;
export function canonicalCardKey(
  card: Pick<RawCard, 'number'>,
  set: Pick<RawSet, 'language' | 'code'>,
): string;
export function canonicalCardKey(
  card: Pick<RawCard | CanonicalCard, 'number'>,
  set: { canonicalKey: string } | Pick<RawSet, 'language' | 'code'>,
): string {
  const setKey = 'canonicalKey' in set ? set.canonicalKey : canonicalSetKey(set);
  const number = normalizeCardNumberForKey(card.number);
  return `${setKey}-${number}`;
}

/**
 * `printing.variant_key` — `{card.canonical_key}-{variant_code}`.
 * Expects the printing already carries its `variantCode` (assembled by
 * the variant classifier). The printing's `cardKey` is treated as the
 * card's canonical key when no separate card argument is provided.
 */
export function printingVariantKey(
  printing: { variantCode: string } & Pick<RawPrinting, 'cardKey'>,
  card?: { canonicalKey: string },
): string {
  const cardKey = card?.canonicalKey ?? printing.cardKey;
  if (!cardKey) {
    throw new Error('canonical-keys: cannot build variant_key without a card canonical_key');
  }
  if (!printing.variantCode) {
    throw new Error(
      'canonical-keys: printing.variantCode is required (run the variant classifier before keying)',
    );
  }
  return `${cardKey}-${printing.variantCode}`;
}

/**
 * Internal: language strings from sources are sometimes `en-US`,
 * `English`, `EN`, `JP`, `ja-JP`. We standardize to the two-letter
 * lowercase shorthand `en` / `jp`. Adapters should already have done
 * this; the helper is defensive.
 */
function normalizeLanguage(input: string): Language {
  const v = input.trim().toLowerCase();
  if (v === 'en' || v === 'eng' || v === 'english' || v.startsWith('en-')) return 'en';
  if (
    v === 'jp' ||
    v === 'ja' ||
    v === 'jpn' ||
    v === 'japanese' ||
    v.startsWith('ja-') ||
    v.startsWith('jp-')
  ) {
    return 'jp';
  }
  throw new Error(
    `canonical-keys: unsupported language ${JSON.stringify(input)} (expected en or jp)`,
  );
}
