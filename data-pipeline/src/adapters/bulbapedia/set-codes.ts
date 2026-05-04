// Bulbapedia set name → TCGdex set code mapping.
//
// Bulbapedia's primary set identifier is the human-readable English
// name (`Brilliant Stars`, `Base Set`, `SWSH Black Star Promos`).
// TCGdex (our primary tier per PROJECT.md § 7) uses lowercase short
// codes (`swsh9`, `base1`, `swshp`). The resolver joins records by
// canonical key (`{language}-{set_code}-{number_padded}`); for
// Bulbapedia (filler) to contribute, its emitted `code` MUST match
// TCGdex EN's set code.
//
// This module:
//   1. Maintains a known-good mapping table for the sets the test
//      fixtures reference and the most common modern English sets.
//      The table is intentionally small — it grows as ops audits
//      seed-ingest output and expands coverage. Sets without an
//      entry land in the slug fallback (`bulbapedia-<slug>`) and
//      surface as a presence conflict to ops.
//   2. Provides `isBulbapediaPromoSet(setName)` for the variant
//      classifier (Bulbapedia promo sets all have "Promo" in their
//      name; the helper centralizes the rule).

const BULBAPEDIA_TO_TCGDEX_SET_CODES: Readonly<Record<string, string>> = {
  // Vintage / Wizards era
  'Base Set': 'base1',
  Jungle: 'base2',
  Fossil: 'base3',
  'Base Set 2': 'base4',
  'Team Rocket': 'base5',
  'Gym Heroes': 'gym1',
  'Gym Challenge': 'gym2',
  'Wizards Black Star Promos': 'basep',
  // Neo era
  'Neo Genesis': 'neo1',
  'Neo Discovery': 'neo2',
  'Neo Revelation': 'neo3',
  'Neo Destiny': 'neo4',
  // EX era (representative)
  'EX Holon Phantoms': 'ex11',
  // SWSH era (Sword & Shield)
  'Sword & Shield': 'swsh1',
  'Sword & Shield—Sword & Shield': 'swsh1',
  'Brilliant Stars': 'swsh9',
  'Astral Radiance': 'swsh10',
  'Lost Origin': 'swsh11',
  'Silver Tempest': 'swsh12',
  'Crown Zenith': 'swsh12pt5',
  'SWSH Black Star Promos': 'swshp',
  // Sun & Moon era promos
  'SM Black Star Promos': 'smp',
  // XY era promos
  'XY Black Star Promos': 'xyp',
  // Scarlet & Violet era
  'Scarlet & Violet': 'sv01',
  Paldea: 'sv01',
  'Paldea Evolved': 'sv02',
  'Obsidian Flames': 'sv03',
  'Paradox Rift': 'sv04',
};

/** Public, frozen view of the mapping table. Exposed so ops scripts
 *  / sibling adapter tasks can introspect / extend without recompiling. */
export const BULBAPEDIA_SET_CODE_TABLE = Object.freeze({ ...BULBAPEDIA_TO_TCGDEX_SET_CODES });

/**
 * Map a Bulbapedia set name to the matching TCGdex EN set code.
 * Returns `undefined` when the name is not in the table — callers
 * fall back to a slugified form via `slugifyBulbapediaSetName`.
 */
export function tcgdexCodeForBulbapediaSet(setName: string): string | undefined {
  if (!setName) return undefined;
  const trimmed = setName.trim();
  if (!trimmed) return undefined;
  const direct = BULBAPEDIA_TO_TCGDEX_SET_CODES[trimmed];
  if (direct) return direct;
  // Case-insensitive fallback. Mappings are case-sensitive in the
  // table so the hot path is exact-match; the loop only fires on
  // misses.
  const lc = trimmed.toLowerCase();
  for (const [key, value] of Object.entries(BULBAPEDIA_TO_TCGDEX_SET_CODES)) {
    if (key.toLowerCase() === lc) return value;
  }
  return undefined;
}

/**
 * Slug fallback for sets without a known TCGdex mapping. We prefix
 * with `bulbapedia-` so the join key never collides with a real
 * TCGdex code; the resolver surfaces these as presence conflicts so
 * ops can extend the table.
 */
export function slugifyBulbapediaSetName(setName: string): string {
  const trimmed = setName.trim().toLowerCase();
  if (!trimmed) return 'bulbapedia-unknown';
  const slug = trimmed
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `bulbapedia-${slug || 'unknown'}`;
}

/**
 * Resolve the join code for a Bulbapedia set name: known mapping if
 * present, otherwise the slug fallback. Always returns a non-empty
 * string suitable for `RawSet.code`.
 */
export function resolveBulbapediaSetCode(setName: string): string {
  return tcgdexCodeForBulbapediaSet(setName) ?? slugifyBulbapediaSetName(setName);
}

/**
 * Detect whether a Bulbapedia set name refers to a promo / Black
 * Star "set". Bulbapedia consistently uses the substring "Black
 * Star Promos" or "Promos" in promo set titles, so the check is
 * a stable substring match.
 */
export function isBulbapediaPromoSet(setName: string): boolean {
  if (!setName) return false;
  const lc = setName.toLowerCase();
  if (lc.includes('black star promos')) return true;
  if (lc.endsWith(' promos')) return true;
  if (lc === 'promo' || lc.endsWith(' promo')) return true;
  return false;
}
