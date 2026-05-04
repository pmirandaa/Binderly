// Pokemon-Card.com → TCGdex JP matcher.
//
// The filler tier is only useful insofar as it joins with the
// primary's canonical records. Both adapters key cards by their own
// IDs (Pokemon-Card.com integers, TCGdex JP `{setId}-{localId}`
// strings); the matcher returns the TCGdex JP cardKey for a parsed
// Pokemon-Card.com record so the resolver can merge them.
//
// Strategy (see elaborated task spec § "Pokemon-Card.com → TCGdex
// JP matcher"):
//   1. Map the source's on-page short code → TCGdex JP set id via
//      `pcjpToTcgdexSetCode`.
//   2. Pad / preserve the card number via `normalizeCardNumberForKey`.
//   3. Compose `${setCode}-${number}`.
//
// Returns `null` when:
//   - the source card lacks a short code (very old vintage entries),
//   - the source card lacks a number,
//   - the alias table has an explicit `null` mapping (none today).

import { pcjpToTcgdexSetCode } from './set-aliases.js';
import { normalizeCardNumberForKey } from '../../canonical-keys.js';

import type { PokemonCardJpCard } from './api-types.js';

/**
 * Map a parsed Pokemon-Card.com card to its TCGdex JP cardKey.
 *
 * Returns `null` if the matcher cannot produce a deterministic key
 * (missing inputs); the resolver treats this as "no primary match"
 * and either fills missing fields on a separate canonical record or
 * surfaces the printing as a filler-tier-only entry per the
 * resolver's contract for unmatched filler records.
 */
export function pokemoncardJpToTcgdexJp(
  card: Pick<PokemonCardJpCard, 'shortCode' | 'number'>,
): string | null {
  const setCode = pcjpToTcgdexSetCode(card.shortCode);
  if (!setCode) return null;
  const numTrimmed = card.number?.trim();
  if (!numTrimmed) return null;
  let normalizedNumber: string;
  try {
    normalizedNumber = normalizeCardNumberForKey(numTrimmed);
  } catch {
    return null;
  }
  return `${setCode}-${normalizedNumber}`;
}
