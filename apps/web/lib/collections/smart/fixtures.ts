// Test-only fixtures + fake `SmartCollectionsApi` for the
// `/collections/smart` test suites. Located inside
// `lib/collections/smart/` so it stays inside this task's
// pre-authorized paths, but it is NOT imported by any production
// code path — only `*.test.tsx` files. The `vi` import resolves
// through vitest (a devDependency) and is tree-shaken out of the
// Next.js production bundle.

import { vi } from 'vitest';

import type {
  CardWithPrintingsDto,
  CollectionItemDto,
  CustomCollectionDto,
  PrintingDto,
  SetDto,
  SmartCollectionRuleDto,
  SmartPreviewRequestDto,
  SmartPreviewResponseDto,
  SubscriptionDto,
} from '@binderly/api-contracts';
import type { Expression } from '@binderly/smart-collection-dsl';
import { evaluateExpression } from '@binderly/smart-collection-dsl';

import {
  indexOwnedItems,
  projectCandidateItem,
  type CatalogPreview,
  type CreateSmartCollectionInput,
  type SmartCollectionsApi,
} from './api';
import { variantClassLabel } from './format';
import {
  makeCard,
  makeCardWithPrintings,
  makePrinting,
  makeSet,
} from '../../browse/fixtures';
import { makeCollectionItem } from '../../collection/fixtures';

const NOW = '2026-05-15T20:00:00.000Z';

// ============================================================
// Catalog fixture
// ============================================================

/**
 * Three sets covering both languages and a few rarities. The
 * fixture is small but rich enough to exercise the DSL's
 * field allowlist (language, rarity, variant class, set series,
 * release date range, ownership flag).
 */
export const SMART_FIXTURE_SETS: SetDto[] = [
  makeSet({
    id: 'set-base',
    canonicalKey: 'en-base1',
    code: 'base1',
    language: 'en',
    name: 'Base Set',
    series: 'Original',
    releaseDate: '1999-01-09',
    total: 2,
  }),
  makeSet({
    id: 'set-swsh',
    canonicalKey: 'en-swsh10',
    code: 'swsh10',
    language: 'en',
    name: 'Astral Radiance',
    series: 'Sword & Shield',
    releaseDate: '2022-05-27',
    total: 2,
  }),
  makeSet({
    id: 'set-jp-svv',
    canonicalKey: 'jp-svv',
    code: 'svv',
    language: 'jp',
    name: 'Vstar Universe',
    series: 'Scarlet & Violet',
    releaseDate: '2022-12-02',
    total: 1,
  }),
];

const charizardBase = makeCardWithPrintings(
  {
    id: 'card-base-charizard',
    canonicalKey: 'en-base1-4',
    setId: 'set-base',
    language: 'en',
    number: '4',
    name: 'Charizard',
    rarity: 'HOLO_RARE',
    type: 'FIRE',
  },
  [
    makePrinting({
      id: 'p-base-charizard-holo',
      cardId: 'card-base-charizard',
      variantClass: 'HOLO',
      variantCode: 'holo',
      includeInMasterSet: true,
    }),
    makePrinting({
      id: 'p-base-charizard-rh',
      cardId: 'card-base-charizard',
      variantClass: 'REVERSE_HOLO',
      variantCode: 'reverse-holo',
      includeInMasterSet: true,
    }),
  ],
);

const blastoiseBase = makeCardWithPrintings(
  {
    id: 'card-base-blastoise',
    canonicalKey: 'en-base1-2',
    setId: 'set-base',
    language: 'en',
    number: '2',
    name: 'Blastoise',
    rarity: 'HOLO_RARE',
    type: 'WATER',
  },
  [
    makePrinting({
      id: 'p-base-blastoise-holo',
      cardId: 'card-base-blastoise',
      variantClass: 'HOLO',
      variantCode: 'holo',
      includeInMasterSet: true,
    }),
  ],
);

const charizardSwsh = makeCardWithPrintings(
  {
    id: 'card-swsh-charizard',
    canonicalKey: 'en-swsh10-20',
    setId: 'set-swsh',
    language: 'en',
    number: '20',
    name: 'Charizard',
    rarity: 'ULTRA_RARE',
    type: 'FIRE',
  },
  [
    makePrinting({
      id: 'p-swsh-charizard-fa',
      cardId: 'card-swsh-charizard',
      variantClass: 'FULL_ART',
      variantCode: 'full-art',
      includeInMasterSet: true,
    }),
    makePrinting({
      id: 'p-swsh-charizard-alt',
      cardId: 'card-swsh-charizard',
      variantClass: 'ALT_ART',
      variantCode: 'alt-art',
      includeInMasterSet: true,
    }),
  ],
);

const pikachuSwsh = makeCardWithPrintings(
  {
    id: 'card-swsh-pikachu',
    canonicalKey: 'en-swsh10-50',
    setId: 'set-swsh',
    language: 'en',
    number: '50',
    name: 'Pikachu',
    rarity: 'COMMON',
    type: 'LIGHTNING',
  },
  [
    makePrinting({
      id: 'p-swsh-pikachu-norm',
      cardId: 'card-swsh-pikachu',
      variantClass: 'NON_HOLO',
      variantCode: 'non-holo',
      includeInMasterSet: true,
    }),
  ],
);

const charizardJp = makeCardWithPrintings(
  {
    id: 'card-jp-charizard',
    canonicalKey: 'jp-svv-15',
    setId: 'set-jp-svv',
    language: 'jp',
    number: '15',
    name: 'リザードン',
    rarity: 'HOLO_RARE',
    type: 'FIRE',
  },
  [
    makePrinting({
      id: 'p-jp-charizard-holo',
      cardId: 'card-jp-charizard',
      variantClass: 'HOLO',
      variantCode: 'holo',
      includeInMasterSet: true,
    }),
  ],
);

export const SMART_FIXTURE_CARDS: CardWithPrintingsDto[] = [
  charizardBase,
  blastoiseBase,
  charizardSwsh,
  pikachuSwsh,
  charizardJp,
];

export function fixtureCatalogPreview(): CatalogPreview {
  const setsById = new Map<string, SetDto>();
  for (const s of SMART_FIXTURE_SETS) setsById.set(s.id, s);
  const cardsById = new Map<string, CardWithPrintingsDto>();
  const printings: PrintingDto[] = [];
  for (const card of SMART_FIXTURE_CARDS) {
    cardsById.set(card.id, card);
    for (const p of card.printings) printings.push(p);
  }
  return { printings, setsById, cardsById };
}

// ============================================================
// Saved smart-collections
// ============================================================

/**
 * Default smart-collection saved fixture. A single rule that
 * matches every Charizard in any English set.
 */
export const SMART_FIXTURE_EXPRESSION: Expression = {
  type: 'and',
  children: [
    { type: 'eq', field: 'card.name', value: 'Charizard' },
    { type: 'eq', field: 'card.language', value: 'en' },
  ],
};

export function makeSmartCollection(
  overrides: Partial<CustomCollectionDto> = {},
): CustomCollectionDto {
  return {
    id: 'cc-smart-1',
    userId: '88888888-8888-8888-8888-888888888888',
    name: 'All English Charizards',
    slug: 'all-english-charizards',
    kind: 'smart',
    description: 'Every Charizard printing across English sets.',
    coverUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeSmartRule(
  overrides: Partial<SmartCollectionRuleDto> = {},
): SmartCollectionRuleDto {
  return {
    customCollectionId: 'cc-smart-1',
    expression: SMART_FIXTURE_EXPRESSION,
    lastEvaluatedAt: null,
    ...overrides,
  };
}

export const SMART_FIXTURE_SAVED: CustomCollectionDto[] = [
  makeSmartCollection(),
  makeSmartCollection({
    id: 'cc-smart-2',
    name: 'Master-set holos in Astral Radiance',
    slug: 'master-set-holos-astral-radiance',
    description: null,
  }),
];

export function makeSubscription(
  overrides: Partial<SubscriptionDto> = {},
): SubscriptionDto {
  return {
    userId: '88888888-8888-8888-8888-888888888888',
    tier: 'free',
    source: null,
    externalCustomerId: null,
    expiresAt: null,
    lastEventAt: null,
    ...overrides,
  };
}

// ============================================================
// Fake api
// ============================================================

export interface FakeSmartCollectionsApiOptions {
  collections?: CustomCollectionDto[];
  rulesByCollectionId?: Record<string, SmartCollectionRuleDto>;
  ownedItems?: CollectionItemDto[];
  preview?: CatalogPreview;
  subscription?: SubscriptionDto;
  /** When set, every read method rejects with this error. */
  rejectAll?: Error;
  /** Optional reject for previewCatalog only. */
  rejectPreview?: Error;
  /** Optional reject for createSmartCollection only. */
  rejectCreate?: Error;
  /** Optional reject for getSmartCollection only. */
  rejectGetCollection?: Error;
  /** Optional reject for getSmartRule only. */
  rejectGetRule?: Error;
  /** Optional reject for runServerPreview only. */
  rejectServerPreview?: Error;
  /**
   * Optional override for the server-preview response. When omitted
   * the fake derives a synthetic response by running the request's
   * expression against the local `preview` fixture using the same
   * `evaluateExpression()` the editor's typing-preview uses — so
   * existing tests that didn't override get the same match counts
   * they used to get from the in-browser `runExpression()` path.
   */
  runServerPreview?: (
    input: SmartPreviewRequestDto,
  ) => SmartPreviewResponseDto;
}

export interface FakeSmartCollectionsApi extends SmartCollectionsApi {
  listSmartCollections: ReturnType<typeof vi.fn>;
  getSmartCollection: ReturnType<typeof vi.fn>;
  getSmartRule: ReturnType<typeof vi.fn>;
  createSmartCollection: ReturnType<typeof vi.fn>;
  updateSmartExpression: ReturnType<typeof vi.fn>;
  deleteSmartCollection: ReturnType<typeof vi.fn>;
  listOwnedItems: ReturnType<typeof vi.fn>;
  previewCatalog: ReturnType<typeof vi.fn>;
  runServerPreview: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
}

/**
 * Derive a synthetic `SmartPreviewResponseDto` from the in-memory
 * fixture preview. Mirrors what the V2 worker would return: the
 * matching printings projected to `SmartPreviewItemDto` rows. The
 * server's pagination is collapsed to "return all matches up to
 * `limit`" — sufficient for the editor + detail-view tests.
 */
export function deriveServerPreviewFromFixture(
  input: SmartPreviewRequestDto,
  preview: CatalogPreview,
  ownedItems: ReadonlyArray<CollectionItemDto>,
): SmartPreviewResponseDto {
  const limit = input.limit ?? 200;
  const offset = input.offset ?? 0;
  const owned = indexOwnedItems(ownedItems);
  const allMatches: SmartPreviewResponseDto['items'] = [];
  for (const printing of preview.printings) {
    const card = preview.cardsById.get(printing.cardId);
    if (card === undefined) continue;
    const set = preview.setsById.get(card.setId);
    if (set === undefined) continue;
    const candidate = projectCandidateItem(printing, preview.cardsById, preview.setsById, owned);
    if (candidate === null) continue;
    if (!evaluateExpression(input.expression as Expression, candidate)) continue;
    allMatches.push({
      printingId: printing.id,
      cardId: card.id,
      setId: set.id,
      cardName: card.name,
      cardNumber: card.number,
      setName: set.name,
      setCode: set.code,
      variantLabel: variantClassLabel(printing.variantClass),
      imageSmallUrl: printing.imageSmallUrl,
    });
  }
  const page = allMatches.slice(offset, offset + limit);
  const nextOffset = offset + page.length < allMatches.length ? offset + page.length : null;
  return {
    items: page,
    totalCount: allMatches.length,
    nextOffset,
  };
}

export function createFakeSmartCollectionsApi(
  options: FakeSmartCollectionsApiOptions = {},
): FakeSmartCollectionsApi {
  const collections = options.collections ?? SMART_FIXTURE_SAVED;
  const rulesByCollectionId =
    options.rulesByCollectionId ?? {
      'cc-smart-1': makeSmartRule(),
      'cc-smart-2': makeSmartRule({
        customCollectionId: 'cc-smart-2',
        expression: {
          type: 'and',
          children: [
            { type: 'eq', field: 'set.code', value: 'swsh10' },
            { type: 'eq', field: 'printing.includeInMasterSet', value: true },
            { type: 'in', field: 'printing.variantClass', values: ['HOLO', 'ULTRA_RARE'] },
          ],
        },
      }),
    };
  const ownedItems = options.ownedItems ?? [];
  const preview = options.preview ?? fixtureCatalogPreview();
  const subscription = options.subscription ?? makeSubscription();

  const listSmartCollections = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return collections;
  });
  const getSmartCollection = vi.fn(async (id: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    if (options.rejectGetCollection !== undefined) throw options.rejectGetCollection;
    const found = collections.find((c) => c.id === id);
    if (found === undefined) {
      const err = new Error(`smart collection ${id} not found in fixture`);
      err.name = 'NotFound';
      throw err;
    }
    return found;
  });
  const getSmartRule = vi.fn(async (customCollectionId: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    if (options.rejectGetRule !== undefined) throw options.rejectGetRule;
    const found = rulesByCollectionId[customCollectionId];
    if (found === undefined) {
      throw new Error(`smart rule for ${customCollectionId} not found in fixture`);
    }
    return found;
  });
  const createSmartCollection = vi.fn(async (input: CreateSmartCollectionInput) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    if (options.rejectCreate !== undefined) throw options.rejectCreate;
    const created = makeSmartCollection({
      id: 'cc-smart-new',
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
    });
    return created;
  });
  const updateSmartExpression = vi.fn(async (customCollectionId: string) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return makeSmartRule({
      customCollectionId,
      lastEvaluatedAt: NOW,
    });
  });
  const deleteSmartCollection = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return undefined;
  });
  const listOwnedItems = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return ownedItems;
  });
  const previewCatalog = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    if (options.rejectPreview !== undefined) throw options.rejectPreview;
    return preview;
  });
  const runServerPreview = vi.fn(async (input: SmartPreviewRequestDto) => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    if (options.rejectServerPreview !== undefined) throw options.rejectServerPreview;
    if (options.runServerPreview !== undefined) return options.runServerPreview(input);
    return deriveServerPreviewFromFixture(input, preview, ownedItems);
  });
  const getSubscription = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    return subscription;
  });

  return {
    listSmartCollections,
    getSmartCollection,
    getSmartRule,
    createSmartCollection,
    updateSmartExpression,
    deleteSmartCollection,
    listOwnedItems,
    previewCatalog,
    runServerPreview,
    getSubscription,
  };
}

// Re-exports for tests that need to build candidate items by hand.
export { makeCard, makePrinting, makeSet, makeCollectionItem };
