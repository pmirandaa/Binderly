// Test-only fixtures + fake `CollectionApi` for the `/collection`
// test suites. Located inside `lib/collection/` so it stays inside
// T-W-COLLECTION's `owns_paths`, but it is NOT imported by any
// production code path — only `*.test.tsx` files. The `vi` import
// resolves through vitest (a devDependency) and is tree-shaken out
// of the Next.js production bundle.
//
// We deliberately re-use T-W-BROWSE's `makeSet` / `makeCard` /
// `makePrinting` builders rather than re-declaring them — the
// per-row defaults are the same and re-implementing would drift.
// `lib/browse/fixtures.ts` is also test-only so importing from it
// keeps the test-only graph isolated from production code.

import { vi } from 'vitest';

import type {
  CardWithPrintingsDto,
  CollectionItemDto,
  SetDto,
} from '@binderly/api-contracts';

import {
  rosterFromCardsWithPrintings,
  type CatalogRoster,
  type CollectionApi,
  type SetContents,
} from './api';
import {
  makeCardWithPrintings,
  makePrinting,
  makeSet,
} from '../browse/fixtures';


const DEFAULT_TIMESTAMP = '2024-01-01T00:00:00.000Z';

export function makeCollectionItem(
  overrides: Partial<CollectionItemDto> = {},
): CollectionItemDto {
  return {
    id: '99999999-9999-9999-9999-999999999991',
    userId: '88888888-8888-8888-8888-888888888888',
    printingId: '33333333-3333-3333-3333-333333333333',
    quantity: 1,
    condition: 'NEAR_MINT',
    gradeCompany: null,
    grade: null,
    acquiredAt: null,
    acquiredPrice: null,
    acquiredCurrency: null,
    notes: null,
    photoUrls: [],
    source: 'manual',
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

/**
 * The standard collection fixture used by most tests in the suite.
 *
 * Three sets, each with two cards, each card with two printings
 * (one master-set-included, one not). The user owns:
 *   - in `set-a`: one printing of card-a1 (the master one) → Set %
 *     = 50, Master % = 50.
 *   - in `set-b`: both printings of card-b1 and one of card-b2 →
 *     Set % = 100, Master % = 75 (3 of 4 master-included printings —
 *     actually 2 of 2; see fixture comments).
 *   - in `set-c`: nothing → set hidden from the home page.
 *
 * Owned card / printing math is asserted directly in
 * `CollectionView.test.tsx` against the `@binderly/set-completion`
 * output. We do NOT duplicate the math expectations here — tests
 * call `computeCompletion(...)` against this fixture to derive
 * expected percentages, exactly the brief's "assert on rendered
 * DOM, not duplicated math" rule.
 */
export const FIXTURE_SETS: SetDto[] = [
  makeSet({
    id: 'set-a',
    canonicalKey: 'en-base1',
    code: 'base1',
    name: 'Base Set',
    series: 'Original',
    releaseDate: '1999-01-09',
    total: 2,
  }),
  makeSet({
    id: 'set-b',
    canonicalKey: 'en-swsh10',
    code: 'swsh10',
    name: 'Astral Radiance',
    series: 'Sword & Shield',
    releaseDate: '2022-05-27',
    total: 2,
  }),
  makeSet({
    id: 'set-c',
    canonicalKey: 'en-sv5',
    code: 'sv5',
    name: 'Temporal Forces',
    series: 'Scarlet & Violet',
    releaseDate: '2024-03-22',
    total: 2,
  }),
];

function setACards(): CardWithPrintingsDto[] {
  return [
    makeCardWithPrintings(
      { id: 'card-a1', setId: 'set-a', number: '1', name: 'Charizard' },
      [
        makePrinting({
          id: 'p-a1-holo',
          cardId: 'card-a1',
          variantClass: 'HOLO',
          variantCode: 'holo',
          includeInMasterSet: true,
        }),
        makePrinting({
          id: 'p-a1-rh',
          cardId: 'card-a1',
          variantClass: 'REVERSE_HOLO',
          variantCode: 'reverse-holo',
          includeInMasterSet: true,
        }),
      ],
    ),
    makeCardWithPrintings(
      { id: 'card-a2', setId: 'set-a', number: '2', name: 'Blastoise' },
      [
        makePrinting({
          id: 'p-a2-holo',
          cardId: 'card-a2',
          variantClass: 'HOLO',
          variantCode: 'holo',
          includeInMasterSet: true,
        }),
        makePrinting({
          id: 'p-a2-promo',
          cardId: 'card-a2',
          variantClass: 'PROMO',
          variantCode: 'promo',
          includeInMasterSet: false,
        }),
      ],
    ),
  ];
}

function setBCards(): CardWithPrintingsDto[] {
  return [
    makeCardWithPrintings(
      { id: 'card-b1', setId: 'set-b', number: '12', name: 'Mew' },
      [
        makePrinting({
          id: 'p-b1-holo',
          cardId: 'card-b1',
          variantClass: 'HOLO',
          variantCode: 'holo',
          includeInMasterSet: true,
        }),
        makePrinting({
          id: 'p-b1-alt',
          cardId: 'card-b1',
          variantClass: 'ALT_ART',
          variantCode: 'alt-art',
          includeInMasterSet: true,
        }),
      ],
    ),
    makeCardWithPrintings(
      { id: 'card-b2', setId: 'set-b', number: '34', name: 'Pikachu' },
      [
        makePrinting({
          id: 'p-b2-holo',
          cardId: 'card-b2',
          variantClass: 'HOLO',
          variantCode: 'holo',
          includeInMasterSet: true,
        }),
        makePrinting({
          id: 'p-b2-fa',
          cardId: 'card-b2',
          variantClass: 'FULL_ART',
          variantCode: 'full-art',
          includeInMasterSet: true,
        }),
      ],
    ),
  ];
}

function setCCards(): CardWithPrintingsDto[] {
  return [
    makeCardWithPrintings(
      { id: 'card-c1', setId: 'set-c', number: '1', name: 'Eevee' },
      [
        makePrinting({
          id: 'p-c1-holo',
          cardId: 'card-c1',
          variantClass: 'HOLO',
          variantCode: 'holo',
          includeInMasterSet: true,
        }),
      ],
    ),
    makeCardWithPrintings(
      { id: 'card-c2', setId: 'set-c', number: '2', name: 'Vaporeon' },
      [
        makePrinting({
          id: 'p-c2-holo',
          cardId: 'card-c2',
          variantClass: 'HOLO',
          variantCode: 'holo',
          includeInMasterSet: true,
        }),
      ],
    ),
  ];
}

export function fixtureSetContents(): Record<string, SetContents> {
  return {
    'set-a': { set: FIXTURE_SETS[0]!, cards: setACards() },
    'set-b': { set: FIXTURE_SETS[1]!, cards: setBCards() },
    'set-c': { set: FIXTURE_SETS[2]!, cards: setCCards() },
  };
}

export function fixtureRoster(): CatalogRoster {
  const allCards = [...setACards(), ...setBCards(), ...setCCards()];
  return rosterFromCardsWithPrintings(allCards);
}

/**
 * Default owned-items fixture matching the doc-comment in
 * `FIXTURE_SETS`:
 *   - `set-a`: owns `p-a1-holo` only.
 *   - `set-b`: owns all four printings of the set's two cards.
 *   - `set-c`: nothing.
 */
export const FIXTURE_OWNED_ITEMS: CollectionItemDto[] = [
  makeCollectionItem({ id: 'item-1', printingId: 'p-a1-holo' }),
  makeCollectionItem({ id: 'item-2', printingId: 'p-b1-holo' }),
  makeCollectionItem({
    id: 'item-3',
    printingId: 'p-b1-alt',
    condition: 'LIGHTLY_PLAYED',
  }),
  makeCollectionItem({ id: 'item-4', printingId: 'p-b2-holo' }),
  makeCollectionItem({ id: 'item-5', printingId: 'p-b2-fa' }),
];

export interface FakeCollectionApiOptions {
  sets?: SetDto[];
  setContents?: Record<string, SetContents>;
  ownedItems?: CollectionItemDto[];
  roster?: CatalogRoster;
  rejectAll?: Error;
}

export interface FakeCollectionApi extends CollectionApi {
  listAllSets: ReturnType<typeof vi.fn>;
  getSet: ReturnType<typeof vi.fn>;
  listOwnedItems: ReturnType<typeof vi.fn>;
  listSetContents: ReturnType<typeof vi.fn>;
  catalogRoster: ReturnType<typeof vi.fn>;
}

export function createFakeCollectionApi(
  options: FakeCollectionApiOptions = {},
): FakeCollectionApi {
  const sets = options.sets ?? FIXTURE_SETS;
  const setContents = options.setContents ?? fixtureSetContents();
  const ownedItems = options.ownedItems ?? FIXTURE_OWNED_ITEMS;
  const roster = options.roster ?? fixtureRoster();

  const listAllSets = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return sets;
  });
  const getSet = vi.fn(async (id: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    const found = sets.find((s) => s.id === id);
    if (found === undefined) {
      throw new Error(`set ${id} not found in fixture`);
    }
    return found;
  });
  const listOwnedItems = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return ownedItems;
  });
  const listSetContents = vi.fn(async (setId: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    const data = setContents[setId];
    if (data === undefined) {
      throw new Error(`set ${setId} has no contents fixture`);
    }
    return data;
  });
  const catalogRoster = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return roster;
  });

  return { listAllSets, getSet, listOwnedItems, listSetContents, catalogRoster };
}
