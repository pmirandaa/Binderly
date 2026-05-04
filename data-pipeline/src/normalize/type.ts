// Pokémon type and trainer/energy subtype normalization.
//
// Different sources call the same type different things — most
// notably "Lightning" (TCGdex, official) vs "Electric" (some
// community sources, Bulbapedia in places). We normalize to the
// canonical enum from `context/tcg-domain.md` § 7.

import type { CardSubtype, PokemonType } from '../types.js';

const TYPE_ALIASES: Readonly<Record<string, PokemonType>> = {
  // Direct hits
  GRASS: 'GRASS',
  FIRE: 'FIRE',
  WATER: 'WATER',
  LIGHTNING: 'LIGHTNING',
  PSYCHIC: 'PSYCHIC',
  FIGHTING: 'FIGHTING',
  DARKNESS: 'DARKNESS',
  METAL: 'METAL',
  FAIRY: 'FAIRY',
  DRAGON: 'DRAGON',
  COLORLESS: 'COLORLESS',
  // Common synonyms
  ELECTRIC: 'LIGHTNING',
  STEEL: 'METAL',
  DARK: 'DARKNESS',
  NORMAL: 'COLORLESS',
  // pokemontcg.io quirks
  Lightning: 'LIGHTNING',
};

/**
 * Normalize a source's pokémon-type string to the canonical
 * `PokemonType`. Returns `null` for missing input rather than
 * throwing — many trainer / energy cards have no Pokémon type.
 *
 * Throws only when the input is non-empty but unrecognized; that
 * indicates a missing alias and should be surfaced (via DataConflict
 * upstream, or a fail-fast in tests).
 */
export function normalizePokemonType(input: string | null | undefined): PokemonType | null {
  if (input == null || input.trim() === '') return null;
  const trimmed = input.trim();
  const exact = TYPE_ALIASES[trimmed];
  if (exact) return exact;
  const upper = trimmed.toUpperCase();
  const upperHit = TYPE_ALIASES[upper];
  if (upperHit) return upperHit;
  throw new Error(`normalize/type: unknown pokemon type ${JSON.stringify(input)}`);
}

const SUBTYPE_ALIASES: Readonly<Record<string, CardSubtype>> = {
  // Pokémon
  Pokemon: 'POKEMON',
  Pokémon: 'POKEMON',
  POKEMON: 'POKEMON',
  // Trainer subtypes — sources spell these in mixed case
  Item: 'TRAINER_ITEM',
  ITEM: 'TRAINER_ITEM',
  'Trainer-Item': 'TRAINER_ITEM',
  Supporter: 'TRAINER_SUPPORTER',
  SUPPORTER: 'TRAINER_SUPPORTER',
  'Trainer-Supporter': 'TRAINER_SUPPORTER',
  Stadium: 'TRAINER_STADIUM',
  STADIUM: 'TRAINER_STADIUM',
  'Trainer-Stadium': 'TRAINER_STADIUM',
  Tool: 'TRAINER_TOOL',
  TOOL: 'TRAINER_TOOL',
  'Pokémon Tool': 'TRAINER_POKEMON_TOOL',
  'Pokemon Tool': 'TRAINER_POKEMON_TOOL',
  POKEMON_TOOL: 'TRAINER_POKEMON_TOOL',
  // Energy subtypes
  'Basic Energy': 'ENERGY_BASIC',
  'Basic-Energy': 'ENERGY_BASIC',
  BASIC: 'ENERGY_BASIC',
  Basic: 'ENERGY_BASIC',
  'Special Energy': 'ENERGY_SPECIAL',
  'Special-Energy': 'ENERGY_SPECIAL',
  SPECIAL: 'ENERGY_SPECIAL',
  Special: 'ENERGY_SPECIAL',
};

/**
 * Normalize a card subtype string. Returns `null` for missing input.
 * Sources that emit a multi-axis subtype (e.g., TCGdex puts the high-
 * level "Trainer" in `card.category` and the specific "Item" in
 * `card.subtype`) should pass the more specific value here.
 */
export function normalizeCardSubtype(input: string | null | undefined): CardSubtype | null {
  if (input == null || input.trim() === '') return null;
  const trimmed = input.trim();
  const exact = SUBTYPE_ALIASES[trimmed];
  if (exact) return exact;
  const upper = trimmed.toUpperCase();
  const upperHit = SUBTYPE_ALIASES[upper];
  if (upperHit) return upperHit;
  throw new Error(`normalize/type: unknown card subtype ${JSON.stringify(input)}`);
}
