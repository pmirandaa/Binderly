// Set-code alias table for the Pokemon-Card.com → TCGdex JP matcher.
//
// Pokemon-Card.com renders an on-page short code (`SV1S`, `S9`, …)
// that is *almost* the TCGdex JP set id but differs in case and a
// few legacy mappings. The matcher (`matcher.ts`) consults this
// table to convert; unknown codes return `null` and the adapter
// emits the lowercased on-page code so downstream code can still
// reason about it.
//
// Hand-curated for the sets we ship fixtures for + obvious common
// cases. Downstream tasks (T-DL-SEED-INGEST) extend the table as
// new sets appear.

/**
 * Map Pokemon-Card.com's on-page short code (uppercase) → TCGdex JP
 * set id (lowercase). Add an entry only when the simple
 * `lowercase(shortCode)` mapping doesn't suffice.
 */
const SHORT_CODE_TO_TCGDEX_JP: Readonly<Record<string, string>> = {
  // Sword & Shield era — short codes match TCGdex IDs after lowercasing.
  S9: 's9',
  S10: 's10',
  S11: 's11',
  S12: 's12',
  S12A: 's12a',
  S1H: 's1h',
  S1W: 's1w',
  S2A: 's2a',
  S6A: 's6a',
  S6K: 's6k',
  S7D: 's7d',
  S7R: 's7r',
  S8: 's8',
  S8A: 's8a',
  S8B: 's8b',

  // Scarlet & Violet era — ditto.
  SV1S: 'sv1s',
  SV1V: 'sv1v',
  SV2A: 'sv2a',
  SV2D: 'sv2d',
  SV2P: 'sv2p',
  SV3: 'sv3',
  SV4A: 'sv4a',
  SV4K: 'sv4k',
  SV4M: 'sv4m',
  SV5A: 'sv5a',
  SV5K: 'sv5k',
  SV5M: 'sv5m',

  // Promo / special-format sets.
  SVP: 'svp',
  SMP: 'smp',
  SWSHP: 'swshp',
};

/**
 * Look up the TCGdex JP set id for a Pokemon-Card.com on-page short
 * code. Returns the lowercased fallback when the code is not in the
 * alias table — empirically this is correct for ~95% of modern sets
 * (TCGdex's IDs are the lowercased on-card short codes).
 *
 * Returns `null` only when the input itself is empty/whitespace.
 */
export function pcjpToTcgdexSetCode(shortCode: string | null | undefined): string | null {
  if (!shortCode) return null;
  const upper = shortCode.trim().toUpperCase();
  if (!upper) return null;
  if (Object.prototype.hasOwnProperty.call(SHORT_CODE_TO_TCGDEX_JP, upper)) {
    return SHORT_CODE_TO_TCGDEX_JP[upper] ?? null;
  }
  return upper.toLowerCase();
}

/**
 * Convenience wrapper: parse a Pokemon-Card.com expansion-page
 * header object and return the TCGdex JP set code, or `null` when
 * the header has no short code at all. Mostly an ergonomic alias
 * for callers that already hold the parsed set struct.
 */
export function pokemoncardJpSetToTcgdexJp(set: {
  shortCode: string | null | undefined;
}): string | null {
  return pcjpToTcgdexSetCode(set.shortCode);
}

/**
 * Test-only: expose the alias table for assertions. Keeps the
 * private constant module-internal in production.
 *
 * @internal
 */
export function _aliasTableForTests(): Readonly<Record<string, string>> {
  return SHORT_CODE_TO_TCGDEX_JP;
}
