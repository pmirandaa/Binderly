// TypeScript shapes for the slice of the TCGdex v2 REST API the
// `tcgdex-en` adapter consumes. Lenient on purpose — TCGdex evolves
// the schema (adding `pricing`, `boosters`, `dexId`, etc. over time)
// and the adapter ignores fields it doesn't recognize. Unknown fields
// are preserved on the raw card's `extra` only when listed in the
// elaborated mapping table (see
// `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-EN.md`).
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
export interface TCGdexSetBrief {
  id: string;
  name: string;
  logo?: string | null;
  symbol?: string | null;
  cardCount?: TCGdexSetCardCount;
}

export interface TCGdexSetCardCount {
  /** Numbered cards the set advertises on-card (the "printed total"). */
  official: number;
  /** All cards including secret rares / hidden ("printed_total + secrets"). */
  total: number;
  /** Optional — TCGdex does not always populate. */
  reverse?: number;
  holo?: number;
  normal?: number;
  firstEd?: number;
}

export interface TCGdexSerieBrief {
  id: string;
  name: string;
  logo?: string | null;
}

/**
 * Full shape returned by `/v2/{lang}/sets/{id}`.
 */
export interface TCGdexSet {
  id: string;
  name: string;
  logo?: string | null;
  symbol?: string | null;
  cardCount: TCGdexSetCardCount;
  releaseDate: string;
  serie?: TCGdexSerieBrief;
  tcgOnline?: string | null;
  abbreviation?: { official?: string; localized?: string };
  legal?: { standard?: boolean; expanded?: boolean };
  cards: TCGdexCardBrief[];
  /** Boosters that contained the set; optional, not used by the adapter. */
  boosters?: ReadonlyArray<Record<string, unknown>>;
}

export interface TCGdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string | null;
}

/**
 * Variants summary surfaced by TCGdex on every card. For numbered
 * cards within `printed_total` these flags drive which print runs
 * exist. For SV-era special rares (Illustration / Special
 * Illustration / Hyper / Ultra) all four booleans are typically
 * `false` and the rarity string is the source of truth.
 */
export interface TCGdexCardVariants {
  firstEdition: boolean;
  holo: boolean;
  normal: boolean;
  reverse: boolean;
  /** Wizards-era promo flag; true on the W Promotional / Black Star sets. */
  wPromo: boolean;
}

/**
 * Detailed per-print-run metadata. Optional in the response; vintage
 * cards return up to 4 entries (Holo Unlimited, Holo Shadowless 1st
 * Ed, Holo Shadowless, Holo 1999-2000 Copyright). Modern cards return
 * either nothing or the single `{ type: 'holo'|'normal'|'reverse' }`
 * entry that mirrors the boolean flags.
 *
 * `type` is always present when this array is. `subtype` and `stamp`
 * are observed on vintage prints; `size` is `"standard"` for nearly
 * everything (`"jumbo"` for oversized promos).
 */
export interface TCGdexVariantDetailed {
  type: 'normal' | 'reverse' | 'holo' | string;
  subtype?: string;
  size?: string;
  stamp?: string[];
  variantId?: string;
}

/**
 * Embedded set snapshot on `/v2/{lang}/cards/{id}`. Lacks
 * `releaseDate` / `serie` — those live on the standalone Set
 * response.
 */
export interface TCGdexCardSetRef {
  id: string;
  name: string;
  logo?: string | null;
  symbol?: string | null;
  cardCount: TCGdexSetCardCount;
}

/**
 * Full Card shape. The `category` discriminates further fields:
 *   - "Pokemon" → hp / types / stage / evolveFrom / attacks / weaknesses / resistances / retreat
 *   - "Trainer" → effect + trainerType
 *   - "Energy"  → effect + energyType ("Basic" | "Special" | "Normal")
 *
 * Optional fields are kept loose so future TCGdex additions don't
 * fail the adapter — the resolver / classifier only consume the
 * fields explicitly mapped.
 */
export interface TCGdexCard {
  id: string;
  localId: string;
  name: string;
  image?: string | null;
  category: 'Pokemon' | 'Trainer' | 'Energy' | string;
  illustrator?: string | null;
  rarity?: string | null;
  set: TCGdexCardSetRef;
  variants: TCGdexCardVariants;
  variants_detailed?: ReadonlyArray<TCGdexVariantDetailed>;
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
