// Public barrel for the Pokemon-Card.com adapter.
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`); internal
// modules can pull directly from this file.

export {
  PokemonCardJpAdapter,
  createPokemonCardJpAdapter,
  POKEMONCARD_JP_CARD_PATH,
  POKEMONCARD_JP_DEFAULT_BASE_URL,
  POKEMONCARD_JP_DEFAULT_BURST,
  POKEMONCARD_JP_DEFAULT_RPS,
  POKEMONCARD_JP_DEFAULT_UA,
  POKEMONCARD_JP_EXPANSION_PATH,
  POKEMONCARD_JP_HOST,
  type PokemonCardJpAdapterConfig,
} from './adapter.js';
export {
  POKEMONCARD_JP_ORIGIN,
  POKEMONCARD_JP_SOURCE,
  pokemonCardJpCardToPrintings,
  pokemonCardJpCardToRaw,
  pokemonCardJpHtmlToCard,
  pokemonCardJpHtmlToSet,
  pokemonCardJpSetToRaw,
} from './transform.js';
export { pokemoncardJpToTcgdexJp } from './matcher.js';
export { pcjpToTcgdexSetCode, pokemoncardJpSetToTcgdexJp } from './set-aliases.js';
export type { PokemonCardJpCard, PokemonCardJpRarityLabel, PokemonCardJpSet } from './api-types.js';
