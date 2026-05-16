// Test-only fixtures + fake `CustomCollectionApi` for the
// `/collections/custom` test suites. Located inside
// `lib/collections/custom/` so it stays inside T-W-CUSTOM's
// `owns_paths`, but it is NOT imported by any production code path
// — only `*.test.tsx` files. The `vi` import resolves through
// vitest (a devDependency) and is tree-shaken out of the Next.js
// production bundle.
//
// We intentionally re-use T-W-BROWSE's `makeSet` / `makeCard` /
// `makePrinting` / `makePrintingWithContext` builders rather than
// re-declaring them — the per-row defaults are the same and
// re-implementing would drift.

import { vi } from 'vitest';

import type {
  CardWithPrintingsDto,
  CustomCollectionDto,
  CustomCollectionItemDto,
  PrintingWithContextDto,
  SetDto,
} from '@binderly/api-contracts';

import { makeCardWithPrintings, makePrinting, makeSet } from '../../browse/fixtures';

import type {
  CreateManualCustomCollectionInput,
  CustomCollectionApi,
  UpdateManualCustomCollectionInput,
} from './api';

const DEFAULT_TIMESTAMP = '2024-01-01T00:00:00.000Z';
const DEFAULT_UPDATED_AT = '2024-04-15T12:00:00.000Z';
const DEFAULT_USER_ID = '88888888-8888-8888-8888-888888888888';

export function makeCustomCollection(
  overrides: Partial<CustomCollectionDto> = {},
): CustomCollectionDto {
  return {
    id: 'cc-charizards',
    userId: DEFAULT_USER_ID,
    name: 'My Charizards',
    slug: 'my-charizards',
    kind: 'manual',
    description: 'Every Charizard I love.',
    coverUrl: null,
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_UPDATED_AT,
    ...overrides,
  };
}

export function makeCustomCollectionItem(
  overrides: Partial<CustomCollectionItemDto> = {},
): CustomCollectionItemDto {
  return {
    customCollectionId: 'cc-charizards',
    printingId: '33333333-3333-3333-3333-333333333333',
    addedAt: '2024-04-10T08:00:00.000Z',
    ...overrides,
  };
}

export function makePrintingWithContextLite(
  overrides: Partial<PrintingWithContextDto> = {},
): PrintingWithContextDto {
  const printing = makePrinting();
  // We deliberately rebuild from local primitives rather than
  // calling makePrintingWithContext — this lets tests pass
  // overrides for `id`, `card`, `set` independently.
  return {
    ...printing,
    card: {
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
    },
    set: makeSet(),
    ...overrides,
  };
}

export const FIXTURE_COLLECTIONS: CustomCollectionDto[] = [
  makeCustomCollection({
    id: 'cc-charizards',
    name: 'My Charizards',
    slug: 'my-charizards',
    description: 'Every Charizard I love.',
  }),
  makeCustomCollection({
    id: 'cc-promos',
    name: 'Tournament Promos',
    slug: 'tournament-promos',
    description: 'Stamped staff + prerelease promos.',
  }),
];

export const FIXTURE_PICKER_SETS: SetDto[] = [
  makeSet({
    id: 'set-base',
    canonicalKey: 'en-base1',
    code: 'base1',
    name: 'Base Set',
    series: 'Original',
    releaseDate: '1999-01-09',
    total: 102,
  }),
  makeSet({
    id: 'set-arcane',
    canonicalKey: 'en-sv5',
    code: 'sv5',
    name: 'Temporal Forces',
    series: 'Scarlet & Violet',
    releaseDate: '2024-03-22',
    total: 162,
  }),
];

export const FIXTURE_PICKER_BASE_CARDS: CardWithPrintingsDto[] = [
  makeCardWithPrintings(
    {
      id: 'card-charizard',
      setId: 'set-base',
      number: '4',
      name: 'Charizard',
    },
    [
      makePrinting({
        id: 'p-charizard-holo',
        cardId: 'card-charizard',
        variantClass: 'HOLO',
        variantCode: 'holo',
        includeInMasterSet: true,
      }),
    ],
  ),
  makeCardWithPrintings(
    {
      id: 'card-blastoise',
      setId: 'set-base',
      number: '2',
      name: 'Blastoise',
    },
    [
      makePrinting({
        id: 'p-blastoise-holo',
        cardId: 'card-blastoise',
        variantClass: 'HOLO',
        variantCode: 'holo',
        includeInMasterSet: true,
      }),
    ],
  ),
];

export interface FakeCustomCollectionApiOptions {
  collections?: CustomCollectionDto[];
  itemsByCollectionId?: Record<string, CustomCollectionItemDto[]>;
  printingsById?: Record<string, PrintingWithContextDto>;
  sets?: SetDto[];
  setCards?: Record<string, CardWithPrintingsDto[]>;
  /**
   * Optional override — when set, every method except the read
   * collection helpers raises this error. Used by the error-state
   * tests (mirrors the T-W-COLLECTION pattern).
   */
  rejectAll?: Error;
}

export interface FakeCustomCollectionApi extends CustomCollectionApi {
  listCustomCollections: ReturnType<typeof vi.fn>;
  getCustomCollection: ReturnType<typeof vi.fn>;
  createCustomCollection: ReturnType<typeof vi.fn>;
  updateCustomCollection: ReturnType<typeof vi.fn>;
  deleteCustomCollection: ReturnType<typeof vi.fn>;
  listCustomCollectionItems: ReturnType<typeof vi.fn>;
  addPrintingToCustomCollection: ReturnType<typeof vi.fn>;
  removePrintingFromCustomCollection: ReturnType<typeof vi.fn>;
  getPrintingsByIds: ReturnType<typeof vi.fn>;
  listAllSets: ReturnType<typeof vi.fn>;
  listSetCardsWithPrintings: ReturnType<typeof vi.fn>;
}

/**
 * Build a fake `CustomCollectionApi` whose method results can be
 * stubbed per-test. Default behaviour resolves with the standard
 * fixture so callers only have to override the methods they
 * explicitly care about.
 */
export function createFakeCustomCollectionApi(
  options: FakeCustomCollectionApiOptions = {},
): FakeCustomCollectionApi {
  const collections = options.collections ?? FIXTURE_COLLECTIONS;
  const itemsByCollectionId = options.itemsByCollectionId ?? {};
  const printingsById = options.printingsById ?? {};
  const sets = options.sets ?? FIXTURE_PICKER_SETS;
  const setCards = options.setCards ?? {
    'set-base': FIXTURE_PICKER_BASE_CARDS,
    'set-arcane': [],
  };

  const listCustomCollections = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return collections;
  });
  const getCustomCollection = vi.fn(async (id: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    const found = collections.find((c) => c.id === id);
    if (found === undefined) {
      const error = new Error(`custom collection ${id} not found in fixture`);
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    return found;
  });
  const createCustomCollection = vi.fn(async (input: CreateManualCustomCollectionInput) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return makeCustomCollection({
      id: `cc-new-${input.slug}`,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
    });
  });
  const updateCustomCollection = vi.fn(
    async (input: { id: string; patch: UpdateManualCustomCollectionInput }) => {
      if (options.rejectAll !== undefined) throw options.rejectAll;
      const existing = collections.find((c) => c.id === input.id);
      if (existing === undefined) {
        throw new Error(`custom collection ${input.id} not found in fixture`);
      }
      return {
        ...existing,
        ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
        ...(input.patch.slug !== undefined ? { slug: input.patch.slug } : {}),
        ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
      } satisfies CustomCollectionDto;
    },
  );
  const deleteCustomCollection = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
  });
  const listCustomCollectionItems = vi.fn(async (id: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return itemsByCollectionId[id] ?? [];
  });
  const addPrintingToCustomCollection = vi.fn(
    async (input: { customCollectionId: string; printingId: string }) => {
      if (options.rejectAll !== undefined) throw options.rejectAll;
      return makeCustomCollectionItem({
        customCollectionId: input.customCollectionId,
        printingId: input.printingId,
        addedAt: new Date().toISOString(),
      });
    },
  );
  const removePrintingFromCustomCollection = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
  });
  const getPrintingsByIds = vi.fn(async (ids: ReadonlyArray<string>) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return ids.map((id) => printingsById[id] ?? makePrintingWithContextLite({ id }));
  });
  const listAllSets = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return sets;
  });
  const listSetCardsWithPrintings = vi.fn(async (setId: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return setCards[setId] ?? [];
  });

  return {
    listCustomCollections,
    getCustomCollection,
    createCustomCollection,
    updateCustomCollection,
    deleteCustomCollection,
    listCustomCollectionItems,
    addPrintingToCustomCollection,
    removePrintingFromCustomCollection,
    getPrintingsByIds,
    listAllSets,
    listSetCardsWithPrintings,
  };
}
