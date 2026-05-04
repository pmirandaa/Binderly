// Internal TS types describing what the Pokemon-Card.com HTML
// parser yields. These are NOT the source's wire shape (HTML has no
// schema); they're the parser's structured output, fed straight into
// the transform layer.
//
// Lenient on purpose — Pokemon-Card.com pages occasionally drop
// fields between rotations (e.g. a card without an illustrator
// credit, an expansion page without a series label). Transform
// tolerates absent fields and emits `null` to the `Raw*` zod
// schemas.

/**
 * Canonical-ish rarity labels the parser emits, mapped from the
 * raw glyphs/badges Pokemon-Card.com renders. The transform feeds
 * these strings through the rarity registry's `pokemoncard-jp`
 * table.
 *
 * The string values mirror TCGdex JP labels where possible to keep
 * downstream `normalizeRarity` lookups consistent across siblings.
 */
export type PokemonCardJpRarityLabel =
  | 'Common'
  | 'Uncommon'
  | 'Rare'
  | 'Double Rare'
  | 'Super Rare'
  | 'Ultra Rare'
  | 'Hyper Rare'
  | 'Illustration Rare'
  | 'Art Rare'
  | 'Special Illustration Rare'
  | 'Special Art Rare'
  | 'Shiny Rare'
  | 'Shiny Super Rare'
  | 'Character Rare'
  | 'Character Super Rare'
  | 'Promo';

export interface PokemonCardJpSet {
  /** Pokemon-Card.com integer set ID, as a string. */
  pcjpSetId: string;
  /** On-page short code (e.g. `SV1S`, `S9`). Used by the matcher. */
  shortCode: string;
  /** Set name in Japanese. */
  name: string;
  /** Series name (Japanese) when surfaced; many older sets omit it. */
  series: string | null;
  /** ISO `yyyy-mm-dd` release date. */
  releaseDate: string;
  /** Absolute URL to the expansion logo image, when surfaced. */
  logoUrl: string | null;
  /** Absolute URL to the expansion symbol image, when surfaced. */
  symbolUrl: string | null;
}

export interface PokemonCardJpCard {
  /** Pokemon-Card.com integer card ID, as a string. */
  pcjpCardId: string;
  /** On-page set short code (e.g. `SV1S`). Used by the matcher. */
  shortCode: string;
  /** On-card number (e.g. `001`, `108`, `SV001`). */
  number: string;
  /** Card name in Japanese. */
  name: string;
  /** First Pokémon type when present; trainer / energy → null. */
  type: string | null;
  /** Coarse subtype: `'Pokemon'`, `'Item'`, `'Supporter'`, `'Stadium'`, `'Tool'`, `'Basic Energy'`, `'Special Energy'`. */
  subtype: string | null;
  /** Hit points; absent on Trainer / Energy. */
  hp: number | null;
  /** Illustrator credit, when surfaced. */
  illustrator: string | null;
  /** Pokédex flavor text, when surfaced. */
  flavorText: string | null;
  /** Weakness array `[{ type, value }]`. */
  weakness: ReadonlyArray<{ type: string; value: string }> | null;
  /** Resistance array `[{ type, value }]`. */
  resistance: ReadonlyArray<{ type: string; value: string }> | null;
  /** Retreat cost (count of energy icons). */
  retreatCost: number | null;
  /**
   * Rarity glyph label as parsed from the page (`'Art Rare'`,
   * `'Special Art Rare'`, `'Hyper Rare'`, `'Common'`, …) or `null`
   * if no glyph block was present (very old vintage pages).
   */
  rarityLabel: PokemonCardJpRarityLabel | null;
  /** Raw rarity glyph as captured on the page (`'AR'`, `'SAR'`, `'HR'`, …). */
  rarityGlyph: string | null;
  /** Absolute URL to the card image when surfaced. */
  imageUrl: string | null;
}
