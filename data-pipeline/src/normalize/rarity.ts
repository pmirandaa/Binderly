// Per-source rarity → canonical rarity normalization.
//
// Rarity vocabularies vary wildly across sources. We normalize to the
// canonical enum from `context/tcg-domain.md` § 6. Each adapter owns
// its mapping table; this module provides the registry and a single
// `normalizeRarity(source, rawRarity)` entry point.
//
// Contract:
//
//   - `normalizeRarity('tcgdex-en', 'Rare Holo V')` → `'ULTRA_RARE'`
//   - Unknown source → throws (catches "did you forget to register
//     your adapter's mapping?").
//   - Known source + unknown raw rarity → throws (caller decides
//     whether to surface as a `DataConflict` or fail-fast).
//
// Adapters extend the registry by importing `registerRarityMapping`
// or by passing a `RarityMappingTable` to `normalizeRarityWithTable`
// for one-off / test usage.

import type { Rarity } from '../types.js';

export type SourceName =
  | 'tcgdex-en'
  | 'tcgdex-jp'
  | 'pokemoncard-jp'
  | 'ptcgio'
  | 'bulbapedia-en'
  | 'pokellector'
  | 'serebii'
  // Test-only sentinel — keeps unit tests from polluting the real
  // registry while still letting them exercise lookup behaviour.
  | 'test';

export type RarityMappingTable = Readonly<Record<string, Rarity>>;

const tcgdexEn: RarityMappingTable = {
  // TCGdex EN — based on the published rarity strings in the
  // /sets/{id} response and /cards/{id}.rarity.
  Common: 'COMMON',
  Uncommon: 'UNCOMMON',
  Rare: 'RARE',
  'Rare Holo': 'HOLO_RARE',
  'Holo Rare': 'HOLO_RARE',
  'Rare Holo V': 'ULTRA_RARE',
  'Rare Holo VMAX': 'ULTRA_RARE',
  'Rare Holo VSTAR': 'ULTRA_RARE',
  'Rare Holo EX': 'ULTRA_RARE',
  'Rare Holo GX': 'ULTRA_RARE',
  'Rare Holo LV.X': 'ULTRA_RARE',
  // TCGdex word order varies for the same mechanics; the SWSH-era
  // /v2/en/cards endpoint returns "Holo Rare V" / "Holo Rare VSTAR"
  // (e.g. swsh9-018 Charizard VSTAR). Mirror the "Rare Holo …" set
  // above so we don't have to fall through to the case-insensitive
  // path on every lookup.
  'Holo Rare V': 'ULTRA_RARE',
  'Holo Rare VMAX': 'ULTRA_RARE',
  'Holo Rare VSTAR': 'ULTRA_RARE',
  'Holo Rare EX': 'ULTRA_RARE',
  'Holo Rare GX': 'ULTRA_RARE',
  'Holo Rare LV.X': 'ULTRA_RARE',
  'Rare Ultra': 'ULTRA_RARE',
  'Ultra Rare': 'ULTRA_RARE',
  // SV-era "Double Rare" is the lowercase `ex` cards.
  'Double Rare': 'DOUBLE_RARE',
  // SV-era illustration tier is split: Illustration Rare (artwork only,
  // shared art with secret/full art counterpart) and Special
  // Illustration Rare (alt-art). TCGdex SV-era emits the lowercase
  // 'rare' form ("Illustration rare", "Special illustration rare",
  // "Hyper rare"); we add both so case-insensitive fallback isn't on
  // the hot path.
  'Illustration Rare': 'ILLUSTRATION_RARE',
  'Illustration rare': 'ILLUSTRATION_RARE',
  'Special Illustration Rare': 'SPECIAL_ILLUSTRATION_RARE',
  'Special illustration rare': 'SPECIAL_ILLUSTRATION_RARE',
  // Numbered above printed_total. The classifier may already have
  // assigned variant_class=SECRET_RARE; the rarity slot still records
  // the source's reading of the rarity tier.
  'Rare Secret': 'SECRET_RARE',
  'Secret Rare': 'SECRET_RARE',
  // Hyper Rare = gold cards in modern sets.
  'Hyper Rare': 'HYPER_RARE',
  'Hyper rare': 'HYPER_RARE',
  'Rare Rainbow': 'RAINBOW_RARE',
  'Rainbow Rare': 'RAINBOW_RARE',
  'Radiant Rare': 'RADIANT_RARE',
  'Amazing Rare': 'AMAZING_RARE',
  Promo: 'PROMO',
  'Rare Promo': 'PROMO',
};

const ptcgio: RarityMappingTable = {
  // pokemontcg.io rarity strings — observed values from their public
  // dataset.
  Common: 'COMMON',
  Uncommon: 'UNCOMMON',
  Rare: 'RARE',
  'Rare Holo': 'HOLO_RARE',
  'Rare Holo EX': 'ULTRA_RARE',
  'Rare Holo GX': 'ULTRA_RARE',
  'Rare Holo LV.X': 'ULTRA_RARE',
  'Rare Holo Star': 'ULTRA_RARE',
  'Rare Holo V': 'ULTRA_RARE',
  'Rare Holo VMAX': 'ULTRA_RARE',
  'Rare Holo VSTAR': 'ULTRA_RARE',
  'Rare Ultra': 'ULTRA_RARE',
  'Rare Secret': 'SECRET_RARE',
  'Rare Rainbow': 'RAINBOW_RARE',
  'Rare Shiny': 'ULTRA_RARE',
  'Rare Shining': 'ULTRA_RARE',
  'Rare Prime': 'ULTRA_RARE',
  'Rare ACE': 'ULTRA_RARE',
  'Rare BREAK': 'ULTRA_RARE',
  'Rare Prism Star': 'ULTRA_RARE',
  'Amazing Rare': 'AMAZING_RARE',
  'Radiant Rare': 'RADIANT_RARE',
  'Double Rare': 'DOUBLE_RARE',
  'Illustration Rare': 'ILLUSTRATION_RARE',
  'Special Illustration Rare': 'SPECIAL_ILLUSTRATION_RARE',
  'Hyper Rare': 'HYPER_RARE',
  'Trainer Gallery Rare Holo': 'HOLO_RARE',
  Promo: 'PROMO',
};

const bulbapediaEn: RarityMappingTable = {
  // Bulbapedia uses its own English-prose vocabulary. Used only for
  // *cross-validation*; not a primary content source per the legal
  // notes (`context/legal-and-brand.md`). Stripped to factual rarity
  // tier.
  Common: 'COMMON',
  Uncommon: 'UNCOMMON',
  Rare: 'RARE',
  'Rare Holo': 'HOLO_RARE',
  'Holo Rare': 'HOLO_RARE',
  'Ultra Rare': 'ULTRA_RARE',
  'Secret Rare': 'SECRET_RARE',
  'Hyper Rare': 'HYPER_RARE',
  'Rainbow Rare': 'RAINBOW_RARE',
  'Illustration Rare': 'ILLUSTRATION_RARE',
  'Special Illustration Rare': 'SPECIAL_ILLUSTRATION_RARE',
  'Double Rare': 'DOUBLE_RARE',
  'Amazing Rare': 'AMAZING_RARE',
  'Radiant Rare': 'RADIANT_RARE',
  Promo: 'PROMO',
};

const tcgdexJp: RarityMappingTable = {
  // TCGdex JP rarity strings (mostly English-tier names with a few
  // JP-specific tiers like "Character Rare"). Mapped conservatively.
  Common: 'COMMON',
  Uncommon: 'UNCOMMON',
  Rare: 'RARE',
  'Rare Holo': 'HOLO_RARE',
  'Holo Rare': 'HOLO_RARE',
  'Holo Rare V': 'ULTRA_RARE',
  'Holo Rare VMAX': 'ULTRA_RARE',
  'Holo Rare VSTAR': 'ULTRA_RARE',
  'Double Rare': 'DOUBLE_RARE',
  'Ultra Rare': 'ULTRA_RARE',
  'Special Art Rare': 'SPECIAL_ILLUSTRATION_RARE',
  'Special Illustration Rare': 'SPECIAL_ILLUSTRATION_RARE',
  // Lowercase-`rare` SV-era variants observed on some TCGdex JP fixtures
  // (mirrors EN's word-order pattern). Keep both off the
  // case-insensitive fallback path.
  'Special illustration rare': 'SPECIAL_ILLUSTRATION_RARE',
  'Illustration Rare': 'ILLUSTRATION_RARE',
  'Illustration rare': 'ILLUSTRATION_RARE',
  'Art Rare': 'ILLUSTRATION_RARE',
  'Hyper Rare': 'HYPER_RARE',
  'Hyper rare': 'HYPER_RARE',
  // JP-side prints occasionally surface a Rainbow Rare label.
  'Rainbow Rare': 'RAINBOW_RARE',
  'Rare Rainbow': 'RAINBOW_RARE',
  'Shiny Rare': 'ULTRA_RARE',
  'Shiny Super Rare': 'ULTRA_RARE',
  'Character Rare': 'ULTRA_RARE',
  'Character Super Rare': 'ULTRA_RARE',
  'Super Rare': 'ULTRA_RARE',
  Promo: 'PROMO',
};

const pokemoncardJp: RarityMappingTable = {
  // Pokemon-Card.com glyph → label mapping (the parser emits the
  // labels below; raw glyphs like `AR` / `SAR` / `HR` / `RR` /
  // `RRR` / `CHR` / `CSR` / `S` / `SSR` are mapped to these labels
  // in `pokemoncard-jp/parsers.ts`). All glyphs map through
  // canonical rarities per § "Rarity normalization registry" in the
  // T-DL-SOURCE-TCGDEX-JP elaborated spec.
  Common: 'COMMON',
  Uncommon: 'UNCOMMON',
  Rare: 'RARE',
  'Double Rare': 'DOUBLE_RARE',
  'Super Rare': 'ULTRA_RARE',
  'Ultra Rare': 'ULTRA_RARE',
  'Hyper Rare': 'HYPER_RARE',
  'Illustration Rare': 'ILLUSTRATION_RARE',
  'Art Rare': 'ILLUSTRATION_RARE',
  'Special Illustration Rare': 'SPECIAL_ILLUSTRATION_RARE',
  'Special Art Rare': 'SPECIAL_ILLUSTRATION_RARE',
  'Shiny Rare': 'ULTRA_RARE',
  'Shiny Super Rare': 'ULTRA_RARE',
  'Character Rare': 'ULTRA_RARE',
  'Character Super Rare': 'ULTRA_RARE',
  Promo: 'PROMO',
};

const REGISTRY = new Map<SourceName, Map<string, Rarity>>();
REGISTRY.set('tcgdex-en', new Map(Object.entries(tcgdexEn)));
REGISTRY.set('tcgdex-jp', new Map(Object.entries(tcgdexJp)));
REGISTRY.set('pokemoncard-jp', new Map(Object.entries(pokemoncardJp)));
REGISTRY.set('ptcgio', new Map(Object.entries(ptcgio)));
REGISTRY.set('bulbapedia-en', new Map(Object.entries(bulbapediaEn)));
REGISTRY.set('pokellector', new Map());
REGISTRY.set('serebii', new Map());
REGISTRY.set('test', new Map());

/**
 * Register an additional rarity mapping for a known source. Adapters
 * can call this once at module load to extend (not replace) their
 * source's table; useful for set-specific vocabulary that isn't worth
 * a registry-level merge.
 */
export function registerRarityMapping(source: SourceName, mapping: RarityMappingTable): void {
  let table = REGISTRY.get(source);
  if (!table) {
    table = new Map();
    REGISTRY.set(source, table);
  }
  for (const [k, v] of Object.entries(mapping)) {
    table.set(k, v);
  }
}

/**
 * Map a source's raw rarity string to the canonical `Rarity` enum.
 *
 * Throws on unknown source (registry never seeded — almost certainly a
 * bug) and on known source + unknown rarity (caller decides whether to
 * surface as a `DataConflict`, retry the adapter, or fail-fast).
 *
 * Lookups are case-insensitive *after* an initial exact match to keep
 * common cases fast.
 */
export function normalizeRarity(source: SourceName, rawRarity: string): Rarity {
  const table = REGISTRY.get(source);
  if (!table) {
    throw new Error(
      `normalize/rarity: unknown source ${JSON.stringify(source)} — register a mapping first`,
    );
  }
  const trimmed = rawRarity.trim();
  const exact = table.get(trimmed);
  if (exact) return exact;
  // Case-insensitive fallback. We don't lowercase the table at build
  // time because a small number of sources distinguish "Holo Rare"
  // from "holo rare" by case (rare, but observed).
  const lc = trimmed.toLowerCase();
  for (const [key, value] of table) {
    if (key.toLowerCase() === lc) return value;
  }
  throw new Error(
    `normalize/rarity: source ${JSON.stringify(source)} has no mapping for rarity ${JSON.stringify(rawRarity)}`,
  );
}

/**
 * Variant of `normalizeRarity` that takes an explicit table — used by
 * tests and by ad-hoc adapter lookups during development. Prefer the
 * registry version in production code.
 */
export function normalizeRarityWithTable(table: RarityMappingTable, rawRarity: string): Rarity {
  const trimmed = rawRarity.trim();
  const exact = table[trimmed];
  if (exact) return exact;
  const lc = trimmed.toLowerCase();
  for (const [key, value] of Object.entries(table)) {
    if (key.toLowerCase() === lc) return value;
  }
  throw new Error(`normalize/rarity: no mapping for rarity ${JSON.stringify(rawRarity)}`);
}

/**
 * Reset the registry to its built-in defaults. Test-only — the
 * registry is module-singleton, so tests that mutate it must reset
 * between cases.
 *
 * @internal
 */
export function _resetRarityRegistryForTests(): void {
  REGISTRY.clear();
  REGISTRY.set('tcgdex-en', new Map(Object.entries(tcgdexEn)));
  REGISTRY.set('tcgdex-jp', new Map(Object.entries(tcgdexJp)));
  REGISTRY.set('pokemoncard-jp', new Map(Object.entries(pokemoncardJp)));
  REGISTRY.set('ptcgio', new Map(Object.entries(ptcgio)));
  REGISTRY.set('bulbapedia-en', new Map(Object.entries(bulbapediaEn)));
  REGISTRY.set('pokellector', new Map());
  REGISTRY.set('serebii', new Map());
  REGISTRY.set('test', new Map());
}
