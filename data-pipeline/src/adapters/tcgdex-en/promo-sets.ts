// Promo-set detection for the TCGdex EN adapter.
//
// TCGdex promo sets follow a consistent naming convention: the set id
// ends in a literal `p` (`basep` Wizards Black Star, `swshp` SWSH
// Black Star, `xyp` XY Black Star, `swp` Sword & Shield Promo, `wp` W
// Promotional, etc.). The exception is the `wp` "W Promotional"
// micro-set whose id matches but whose contents are also promos.
//
// We expose a single helper so the JP adapter can reuse the rule when
// it lands.

const PROMO_SET_OVERRIDES = new Set<string>([
  // Explicit promo sets that don't match the suffix rule (rare, but
  // observed). Keep this list small; the suffix rule is the primary
  // signal.
]);

/**
 * Return true if the TCGdex set id (e.g. `swshp`, `basep`, `swsh9`)
 * names a Black Star / Wizards Black Star / per-era promo set. The
 * adapter uses this to decorate every printing in a promo set with
 * `isPromo: true`, which the variant classifier picks up as the
 * `PROMO` variant_class.
 */
export function isTcgdexPromoSet(setId: string): boolean {
  const id = setId.trim().toLowerCase();
  if (!id) return false;
  if (PROMO_SET_OVERRIDES.has(id)) return true;
  // Matches `basep`, `base2p`, `swshp`, `xyp`, `swp`, `wp`, …
  // Excludes regular sets like `sv01`, `swsh9`, `base1`.
  return /^(?:[a-z]+\d*)p$/.test(id);
}
