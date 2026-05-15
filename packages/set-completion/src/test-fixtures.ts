// Fixtures for tests — small, hand-curated rosters that exercise the
// edge cases called out in the acceptance criteria.
//
// NOT exported from `index.ts` — fixtures are test-only. The file
// lives in `src/` so vitest's tsconfig sees it; eslint's `node`
// preset accepts it as ordinary source code.

import type { RosterCard, RosterPrinting } from './types.js';

/**
 * Card-id helper — keeps fixtures readable. Card ids in real data
 * are uuids; the math doesn't care about the format, so for tests
 * we use opaque strings like `'card:base1-004'`.
 */
export const cardId = (set: string, number: string): string => `card:${set}-${number}`;

/**
 * Printing-id helper. `variant` is anything that uniquely
 * identifies the variant within the card; e.g. `'holo'`,
 * `'reverse'`, `'1st-ed'`.
 */
export const printingId = (set: string, number: string, variant: string): string =>
  `printing:${set}-${number}-${variant}`;

/**
 * Build a `RosterCard`.
 */
export const card = (setId: string, number: string): RosterCard => ({
  cardId: cardId(setId, number),
  setId,
});

/**
 * Build a `RosterPrinting` for a given card.
 */
export const printing = (
  setId: string,
  number: string,
  variant: string,
  options: { includeInMasterSet?: boolean } = {},
): RosterPrinting => ({
  printingId: printingId(setId, number, variant),
  cardId: cardId(setId, number),
  setId,
  includeInMasterSet: options.includeInMasterSet ?? true,
});

/**
 * "Brilliant Stars" mini-fixture — three cards, mix of variants.
 *
 *   - 001 Charizard: HOLO (in master), REVERSE (in master),
 *     ALT_ART (in master)
 *   - 002 Pikachu:   NON_HOLO (in master), REVERSE (in master)
 *   - 003 Charmander: NON_HOLO (in master), STAFF promo (NOT in master)
 *
 * Set %  denominator = 3 cards.
 * Master Set % denominator = 6 master-included printings.
 */
export const brilliantStars = (): {
  setId: string;
  cards: RosterCard[];
  printings: RosterPrinting[];
} => {
  const setId = 'set:brilliant-stars';
  const cards = [card(setId, '001'), card(setId, '002'), card(setId, '003')];
  const printings = [
    printing(setId, '001', 'holo', { includeInMasterSet: true }),
    printing(setId, '001', 'reverse', { includeInMasterSet: true }),
    printing(setId, '001', 'altart', { includeInMasterSet: true }),
    printing(setId, '002', 'nonholo', { includeInMasterSet: true }),
    printing(setId, '002', 'reverse', { includeInMasterSet: true }),
    printing(setId, '003', 'nonholo', { includeInMasterSet: true }),
    printing(setId, '003', 'staff', { includeInMasterSet: false }),
  ];
  return { setId, cards, printings };
};

/**
 * "Hidden Fates" mini-fixture — distinct from `brilliantStars` so
 * we can compose multi-set rosters for All Pokémon % and global
 * Master tests.
 *
 *   - SV001 Mewtwo: HOLO (in master), SHINY_VAULT_HOLO (in master)
 *   - SV002 Mew:    HOLO (in master)
 *
 * Set % denominator = 2 cards.
 * Master Set % denominator = 3 master-included printings.
 */
export const hiddenFates = (): {
  setId: string;
  cards: RosterCard[];
  printings: RosterPrinting[];
} => {
  const setId = 'set:hidden-fates';
  const cards = [card(setId, 'SV001'), card(setId, 'SV002')];
  const printings = [
    printing(setId, 'SV001', 'holo', { includeInMasterSet: true }),
    printing(setId, 'SV001', 'shiny-vault', { includeInMasterSet: true }),
    printing(setId, 'SV002', 'holo', { includeInMasterSet: true }),
  ];
  return { setId, cards, printings };
};

/**
 * "Errors" mini-fixture — every printing is flagged
 * `includeInMasterSet === false`. Used to check the
 * "0/0 → 0 (not NaN)" denominator-empty case.
 */
export const errorsOnly = (): {
  setId: string;
  cards: RosterCard[];
  printings: RosterPrinting[];
} => {
  const setId = 'set:errors-only';
  const cards = [card(setId, '001')];
  const printings = [
    printing(setId, '001', 'misprint', { includeInMasterSet: false }),
    printing(setId, '001', 'misprint-2', { includeInMasterSet: false }),
  ];
  return { setId, cards, printings };
};

/**
 * Compose a multi-set roster — used by the aggregate tests.
 */
export const multiSetRoster = (): {
  cards: RosterCard[];
  printings: RosterPrinting[];
} => {
  const bs = brilliantStars();
  const hf = hiddenFates();
  return {
    cards: [...bs.cards, ...hf.cards],
    printings: [...bs.printings, ...hf.printings],
  };
};

/**
 * Build a synthetic large roster for the performance test.
 *
 * `nSets` distinct sets, each with `cardsPerSet` cards, each card
 * with `printingsPerCard` printings. The first 80% of printings are
 * `includeInMasterSet: true`, the rest false — gives the math
 * realistic "some printings excluded" load.
 */
export const buildLargeRoster = (params: {
  nSets: number;
  cardsPerSet: number;
  printingsPerCard: number;
}): { cards: RosterCard[]; printings: RosterPrinting[]; allSetIds: string[] } => {
  const cards: RosterCard[] = [];
  const printings: RosterPrinting[] = [];
  const allSetIds: string[] = [];

  for (let s = 0; s < params.nSets; s += 1) {
    const setId = `set:perf-${s}`;
    allSetIds.push(setId);
    for (let c = 0; c < params.cardsPerSet; c += 1) {
      const number = String(c).padStart(3, '0');
      cards.push({ cardId: cardId(setId, number), setId });
      for (let v = 0; v < params.printingsPerCard; v += 1) {
        const variant = `v${v}`;
        printings.push({
          printingId: printingId(setId, number, variant),
          cardId: cardId(setId, number),
          setId,
          includeInMasterSet: v < Math.ceil(params.printingsPerCard * 0.8),
        });
      }
    }
  }

  return { cards, printings, allSetIds };
};
