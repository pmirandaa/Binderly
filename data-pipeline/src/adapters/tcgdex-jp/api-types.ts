// TypeScript shapes for the slice of the TCGdex v2 REST API the
// `tcgdex-jp` adapter consumes. Lenient on purpose — TCGdex evolves
// the schema (adding `pricing`, `boosters`, `dexId`, etc. over time)
// and the adapter ignores fields it doesn't recognize. Unknown fields
// are preserved on the raw card's `extra` only when listed in the
// elaborated mapping table (see
// `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-JP.md`).
//
// Shape parity with the EN adapter is intentional. The JP adapter
// keeps its own copy (rather than importing from `../tcgdex-en/`) so a
// future EN-only field addition cannot accidentally widen the JP
// surface.
//
// References:
//   - https://www.tcgdex.dev/reference/set
//   - https://www.tcgdex.dev/reference/card
//   - https://www.tcgdex.dev/rest

/**
 * Brief shape returned by the `/v2/{lang}/sets` listing endpoint. It
 * lacks `releaseDate` and `serie`, so the adapter always re-fetches
 * each set via `/v2/{lang}/sets/{id}` for the full shape.
 */
export interface TCGdexJpSetBrief {
  id: string;
  name: string;
  logo?: string | null;
  symbol?: string | null;
  cardCount?: TCGdexJpSetCardCount;
}

export interface TCGdexJpSetCardCount {
  /** Numbered cards the set advertises on-card (the "printed total"). */
  official: number;
  /** All cards including secret rares / hidden ("printed_total + secrets"). */
  total: number;
  reverse?: number;
  holo?: number;
  normal?: number;
  firstEd?: number;
}

export interface TCGdexJpSerieBrief {
  id: string;
  name: string;
  logo?: string | null;
}

/**
 * Full shape returned by `/v2/jp/sets/{id}`.
 */
export interface TCGdexJpSet {
  id: string;
  name: string;
  logo?: string | null;
  symbol?: string | null;
  cardCount: TCGdexJpSetCardCount;
  releaseDate: string;
  serie?: TCGdexJpSerieBrief;
  tcgOnline?: string | null;
  abbreviation?: { official?: string; localized?: string };
  legal?: { standard?: boolean; expanded?: boolean };
  cards: TCGdexJpCardBrief[];
  boosters?: ReadonlyArray<Record<string, unknown>>;
}

export interface TCGdexJpCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string | null;
}

/**
 * Variants summary surfaced by TCGdex on every card. Same boolean
 * flag set as EN; flag semantics are language-agnostic.
 */
export interface TCGdexJpCardVariants {
  firstEdition: boolean;
  holo: boolean;
  normal: boolean;
  reverse: boolean;
  /** TCGdex W Promo flag — used on a handful of vintage Japanese promo runs. */
  wPromo: boolean;
}

/**
 * Detailed per-print-run metadata. Vintage Japanese cards expose
 * up to a few entries (the JP catalogue's vintage entries lean
 * lighter than the WotC-era EN ones — TCGdex's coverage of pre-XY
 * Japanese runs is patchier).
 */
export interface TCGdexJpVariantDetailed {
  type: 'normal' | 'reverse' | 'holo' | string;
  subtype?: string;
  size?: string;
  stamp?: string[];
  variantId?: string;
}

/**
 * Embedded set snapshot on `/v2/jp/cards/{id}`. Lacks `releaseDate` /
 * `serie` — those live on the standalone Set response.
 */
export interface TCGdexJpCardSetRef {
  id: string;
  name: string;
  logo?: string | null;
  symbol?: string | null;
  cardCount: TCGdexJpSetCardCount;
}

/**
 * Full Card shape. The `category` discriminates further fields:
 *   - "Pokemon" → hp / types / stage / evolveFrom / attacks / weaknesses / resistances / retreat
 *   - "Trainer" → effect + trainerType
 *   - "Energy"  → effect + energyType ("Basic" | "Special" | "Normal")
 *
 * Strings on Japanese responses are Japanese (UTF-8). The `rarity`
 * vocabulary uses TCGdex's English-tier labels with two JP-specific
 * additions (`Art Rare` / `Special Art Rare`).
 */
export interface TCGdexJpCard {
  id: string;
  localId: string;
  name: string;
  image?: string | null;
  category: 'Pokemon' | 'Trainer' | 'Energy' | string;
  illustrator?: string | null;
  rarity?: string | null;
  set: TCGdexJpCardSetRef;
  variants: TCGdexJpCardVariants;
  variants_detailed?: ReadonlyArray<TCGdexJpVariantDetailed>;
  boosters?: ReadonlyArray<Record<string, unknown>>;
  pricing?: Record<string, unknown>;
  updated?: string;

  // Pokémon-only
  dexId?: number[];
  hp?: number;
  types?: string[];
  evolveFrom?: string;
  description?: string;
  level?: string;
  stage?: string;
  suffix?: string;
  abilities?: ReadonlyArray<Record<string, unknown>>;
  attacks?: ReadonlyArray<Record<string, unknown>>;
  weaknesses?: ReadonlyArray<Record<string, unknown>>;
  resistances?: ReadonlyArray<Record<string, unknown>>;
  retreat?: number;
  regulationMark?: string;
  legal?: { standard?: boolean; expanded?: boolean };

  // Trainer
  trainerType?: string;
  // Trainer + Energy
  effect?: string;
  // Energy
  energyType?: string;
}
