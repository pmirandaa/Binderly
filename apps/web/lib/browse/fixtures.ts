// Test-only fixtures + fake-api-client helpers for the browse /
// set / card test suites. Located inside `lib/browse/` so it
// stays inside T-W-BROWSE's `owns_paths`, but it is NOT imported
// by any production code path — only `*.test.tsx` files. The
// `vi` import resolves through vitest (a devDependency) and is
// tree-shaken out of the Next.js production bundle.

import { vi } from 'vitest';

import type {
  CardDto,
  CardWithPrintingsDto,
  PrintingDto,
  PrintingWithContextDto,
  SetDto,
} from '@binderly/api-contracts';

import type { BrowseApi, PrintingsForSet } from './api';

const DEFAULT_TIMESTAMP = '2024-01-01T00:00:00.000Z';

export function makeSet(overrides: Partial<SetDto> = {}): SetDto {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    canonicalKey: 'en-base1',
    code: 'base1',
    language: 'en',
    name: 'Base Set',
    series: 'Original',
    releaseDate: '1999-01-09',
    printedTotal: 102,
    total: 102,
    logoUrl: 'https://images.binderly.app/sets/base1/logo.webp',
    symbolUrl: 'https://images.binderly.app/sets/base1/symbol.webp',
    masterSetRules: {},
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

export function makeCard(overrides: Partial<CardDto> = {}): CardDto {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    canonicalKey: 'en-base1-4',
    setId: '11111111-1111-1111-1111-111111111111',
    language: 'en',
    number: '4',
    name: 'Charizard',
    nameLocalized: null,
    type: 'FIRE',
    subtype: 'POKEMON',
    hp: 120,
    illustrator: 'Mitsuhiro Arita',
    flavorText: null,
    attacks: [],
    weakness: [],
    resistance: [],
    retreatCost: 3,
    rarity: 'HOLO_RARE',
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

export function makePrinting(overrides: Partial<PrintingDto> = {}): PrintingDto {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    variantKey: 'en-base1-4-holo',
    cardId: '22222222-2222-2222-2222-222222222222',
    variantClass: 'HOLO',
    variantFlags: [],
    variantCode: 'holo',
    includeInMasterSet: true,
    imageSmallUrl: 'https://images.binderly.app/printings/base1-4-holo-sm.webp',
    imageLargeUrl: 'https://images.binderly.app/printings/base1-4-holo-lg.webp',
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

export function makeCardWithPrintings(
  card: Partial<CardDto> = {},
  printings: PrintingDto[] = [makePrinting()],
): CardWithPrintingsDto {
  return {
    ...makeCard(card),
    printings,
  };
}

export function makePrintingWithContext(
  overrides: Partial<PrintingWithContextDto> = {},
): PrintingWithContextDto {
  const printing = makePrinting();
  const card = makeCard();
  const set = makeSet();
  return {
    ...printing,
    card,
    set,
    ...overrides,
  };
}

/**
 * The standard set list test fixture — three sets across two
 * languages and three series. Sorted by release_date asc on the
 * way OUT of the api-client deliberately so tests can assert
 * the page sorts to release_date desc.
 */
export const SAMPLE_SETS: SetDto[] = [
  makeSet({
    id: 'set-old',
    canonicalKey: 'en-base1',
    code: 'base1',
    name: 'Base Set',
    series: 'Original',
    releaseDate: '1999-01-09',
    total: 102,
  }),
  makeSet({
    id: 'set-mid',
    canonicalKey: 'en-swsh10',
    code: 'swsh10',
    name: 'Astral Radiance',
    series: 'Sword & Shield',
    releaseDate: '2022-05-27',
    total: 189,
  }),
  makeSet({
    id: 'set-new',
    canonicalKey: 'en-sv5',
    code: 'sv5',
    name: 'Temporal Forces',
    series: 'Scarlet & Violet',
    releaseDate: '2024-03-22',
    total: 162,
  }),
  makeSet({
    id: 'set-jp',
    canonicalKey: 'jp-svv',
    code: 'svv',
    language: 'jp',
    name: 'Vstar Universe',
    series: 'Scarlet & Violet',
    releaseDate: '2022-12-02',
    total: 200,
  }),
];

/**
 * Build a fake `BrowseApi` whose method results can be stubbed
 * per-test. Default behaviour is to resolve with empty / mock
 * data so callers only have to override the methods they care
 * about.
 */
export interface FakeBrowseApiOptions {
  sets?: SetDto[];
  setsBySetId?: Record<string, PrintingsForSet>;
  printingsById?: Record<string, PrintingWithContextDto>;
  rejectAll?: Error;
}

export interface FakeBrowseApi extends BrowseApi {
  listAllSets: ReturnType<typeof vi.fn>;
  getSet: ReturnType<typeof vi.fn>;
  listPrintingsInSet: ReturnType<typeof vi.fn>;
  getPrintingDetail: ReturnType<typeof vi.fn>;
}

export function createFakeBrowseApi(options: FakeBrowseApiOptions = {}): FakeBrowseApi {
  const sets = options.sets ?? [];
  const setsBySetId = options.setsBySetId ?? {};
  const printingsById = options.printingsById ?? {};

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
  const listPrintingsInSet = vi.fn(async (setId: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    const data = setsBySetId[setId];
    if (data === undefined) {
      throw new Error(`set ${setId} has no printings fixture`);
    }
    return data;
  });
  const getPrintingDetail = vi.fn(async (id: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    const data = printingsById[id];
    if (data === undefined) {
      throw new Error(`printing ${id} not in fixture`);
    }
    return data;
  });

  return { listAllSets, getSet, listPrintingsInSet, getPrintingDetail };
}
