// TypeScript shapes for the slice of the pokemontcg.io v2 REST API the
// `ptcgio` adapter consumes. Lenient on purpose — the PTCGIO dataset is
// community-maintained and tolerant of additional fields. Unknown
// fields are preserved on the raw card's `extra` only when listed in
// the elaborated mapping table (see
// `tasks/01-data-layer/T-DL-SOURCE-PTCGIO.md`).
//
// References:
//   - https://docs.pokemontcg.io/api-reference/cards/card-object
//   - https://docs.pokemontcg.io/api-reference/sets/set-object
//   - https://docs.pokemontcg.io/api-reference/cards/search-cards

/**
 * PTCGIO's standard list-response envelope. Single-resource endpoints
 * return `{ data: T }`; list endpoints return `{ data: T[], page,
 * pageSize, count, totalCount }`. The adapter strips the envelope and
 * returns the inner payload.
 */
export interface PTCGIOEnvelope<T> {
  data: T;
}

export interface PTCGIOListEnvelope<T> {
  data: T[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

/**
 * The set object as documented in
 * https://docs.pokemontcg.io/api-reference/sets/set-object.
 *
 * `releaseDate` is `yyyy/mm/dd` — the adapter normalizes to ISO
 * `yyyy-mm-dd` before emitting `RawSet`.
 */
export interface PTCGIOSet {
  id: string;
  name: string;
  series?: string | null;
  printedTotal?: number;
  total?: number;
  legalities?: PTCGIOLegalities;
  ptcgoCode?: string;
  releaseDate: string;
  updatedAt?: string;
  images?: PTCGIOSetImages;
}

export interface PTCGIOSetImages {
  symbol?: string;
  logo?: string;
}

/**
 * Format legality. Only legal-or-banned formats appear in the hash;
 * absent keys mean "not legal in that format". Preserved verbatim on
 * `RawSet.extra.legalities`.
 */
export interface PTCGIOLegalities {
  standard?: 'Legal' | 'Banned' | string;
  expanded?: 'Legal' | 'Banned' | string;
  unlimited?: 'Legal' | 'Banned' | string;
}

/**
 * Embedded set snapshot on `/v2/cards/{id}`. Same shape as the full
 * `PTCGIOSet` (PTCGIO inlines the full set on every card).
 */
export type PTCGIOCardSetRef = PTCGIOSet;

/**
 * Pokémon ability or Pokémon Power.
 */
export interface PTCGIOAbility {
  name: string;
  text: string;
  type?: string;
}

export interface PTCGIOAttack {
  name: string;
  cost?: string[];
  convertedEnergyCost?: number;
  damage?: string;
  text?: string;
}

export interface PTCGIOEffectStat {
  type: string;
  value: string;
}

export interface PTCGIOAncientTrait {
  name: string;
  text: string;
}

export interface PTCGIOTcgPlayerBlock {
  /**
   * Map of variant-key → price details. The adapter only reads the
   * KEY SET (variant signal); the inner price values are volatile and
   * stripped from fixtures. Documented keys per the PTCGIO docs:
   * `normal`, `holofoil`, `reverseHolofoil`, `1stEditionHolofoil`,
   * `1stEditionNormal`. We tolerate additional keys by ignoring them
   * (unknown keys log `ptcgio.unknown_price_key` at warn level).
   */
  prices?: Record<string, Record<string, unknown>>;
  url?: string;
  updatedAt?: string;
}

export interface PTCGIOImages {
  small?: string;
  large?: string;
}

/**
 * Full Card shape. The `supertype` field discriminates further:
 *   - "Pokémon" → hp / types / evolvesFrom / evolvesTo / attacks /
 *     weaknesses / resistances / retreatCost / convertedRetreatCost
 *   - "Trainer" → rules (effect text) + subtypes carry the
 *     Item/Supporter/Stadium/Pokémon Tool tag
 *   - "Energy"  → subtypes carry "Basic" / "Special"
 *
 * Optional fields are kept loose so future PTCGIO additions don't
 * fail the adapter — the resolver / classifier only consume the
 * fields explicitly mapped.
 */
export interface PTCGIOCard {
  id: string;
  name: string;
  supertype?: 'Pokémon' | 'Trainer' | 'Energy' | string;
  subtypes?: string[];
  level?: string;
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  evolvesTo?: string[];
  rules?: string[];
  ancientTrait?: PTCGIOAncientTrait;
  abilities?: PTCGIOAbility[];
  attacks?: PTCGIOAttack[];
  weaknesses?: PTCGIOEffectStat[];
  resistances?: PTCGIOEffectStat[];
  retreatCost?: string[];
  convertedRetreatCost?: number;
  set: PTCGIOCardSetRef;
  number: string;
  artist?: string;
  rarity?: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  legalities?: PTCGIOLegalities;
  regulationMark?: string;
  images?: PTCGIOImages;
  tcgplayer?: PTCGIOTcgPlayerBlock;
  /**
   * Cardmarket pricing block. The adapter ignores it entirely (volatile
   * pricing belongs in the pricing pipeline).
   */
  cardmarket?: Record<string, unknown>;
}
