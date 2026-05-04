// Promo-set detection for the PTCGIO adapter.
//
// PTCGIO uses TCGdex-compatible set IDs. Promo sets follow the same
// suffix-`p` convention: `swshp` (SWSH Black Star Promos), `xyp` (XY
// Black Star Promos), `basep` (Wizards Black Star Promos), `dpp` (DP
// Black Star Promos), etc. We do NOT import the TCGdex helper to keep
// each adapter self-contained — the regex is a one-liner and the rule
// might diverge between sources later.

const PROMO_SET_OVERRIDES = new Set<string>([
  // Explicit promo sets that don't match the suffix rule. Empty for
  // now — every PTCGIO promo set we've observed matches the rule.
]);

/**
 * Return true if the PTCGIO set id (e.g. `swshp`, `basep`, `swsh9`)
 * names a Black Star / per-era promo set. The adapter uses this to
 * decorate every printing in a promo set with `isPromo: true`, which
 * the variant classifier picks up as the `PROMO` variant_class.
 */
export function isPtcgioPromoSet(setId: string): boolean {
  const id = setId.trim().toLowerCase();
  if (!id) return false;
  if (PROMO_SET_OVERRIDES.has(id)) return true;
  // Matches `basep`, `swshp`, `xyp`, `dpp`, `swp`, `wp`, …
  // Excludes regular sets like `sv1`, `swsh9`, `base1`.
  return /^(?:[a-z]+\d*)p$/.test(id);
}
