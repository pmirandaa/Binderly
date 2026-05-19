// Tests for `collection.ts`. Each schema gets a positive +
// negative case; the WRITE schemas additionally test the
// "missing-fields-rejected" `.refine()` guard on PATCH bodies.

import { describe, expect, it } from 'vitest';

import {
  addCollectionItemRequest,
  addPrintingToCustomCollectionRequest,
  collectionItemDto,
  collectionItemSourceSchema,
  completionDto,
  createCustomCollectionRequest,
  customCollectionDto,
  customCollectionItemDto,
  customCollectionKindSchema,
  globalCompletionDto,
  gradeCompanySchema,
  perSetCompletionEntryDto,
  smartCollectionRuleDto,
  smartPreviewItemDto,
  smartPreviewRequestDto,
  smartPreviewResponseDto,
  updateCollectionItemRequest,
  updateCustomCollectionRequest,
  updateSmartCollectionExpressionRequest,
} from './collection.js';

const NOW = '2026-05-05T12:00:00Z';
const USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PRINTING_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const COLLECTION_ITEM_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const CUSTOM_COLLECTION_ID = 'dddddddd-4444-4444-8444-dddddddddddd';

describe('gradeCompanySchema', () => {
  it('accepts PSA / BGS / CGC', () => {
    expect(gradeCompanySchema.parse('PSA')).toBe('PSA');
    expect(gradeCompanySchema.parse('BGS')).toBe('BGS');
    expect(gradeCompanySchema.parse('CGC')).toBe('CGC');
  });

  it('rejects an unknown grading company', () => {
    expect(gradeCompanySchema.safeParse('SGC').success).toBe(false);
  });
});

describe('collectionItemSourceSchema', () => {
  it('accepts manual / scan / import', () => {
    expect(collectionItemSourceSchema.parse('manual')).toBe('manual');
    expect(collectionItemSourceSchema.parse('scan')).toBe('scan');
    expect(collectionItemSourceSchema.parse('import')).toBe('import');
  });

  it('rejects an unknown source', () => {
    expect(collectionItemSourceSchema.safeParse('webhook').success).toBe(false);
  });
});

describe('customCollectionKindSchema', () => {
  it('accepts manual and smart', () => {
    expect(customCollectionKindSchema.parse('manual')).toBe('manual');
    expect(customCollectionKindSchema.parse('smart')).toBe('smart');
  });

  it('rejects unknown kinds', () => {
    expect(customCollectionKindSchema.safeParse('hybrid').success).toBe(false);
  });
});

describe('collectionItemDto', () => {
  const VALID = {
    id: COLLECTION_ITEM_ID,
    userId: USER_ID,
    printingId: PRINTING_ID,
    quantity: 1,
    condition: 'NEAR_MINT' as const,
    gradeCompany: 'PSA' as const,
    grade: '9.5',
    acquiredAt: '2025-12-01',
    acquiredPrice: '120.00',
    acquiredCurrency: 'USD',
    notes: 'pulled from a Brilliant Stars booster box',
    photoUrls: ['https://images.binderly.app/users/me/items/1.webp'],
    source: 'manual' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses a graded item', () => {
    expect(collectionItemDto.parse(VALID).grade).toBe('9.5');
  });

  it('parses a raw item with nulls in grade columns', () => {
    expect(
      collectionItemDto.parse({
        ...VALID,
        gradeCompany: null,
        grade: null,
      }).gradeCompany,
    ).toBeNull();
  });

  it('rejects quantity < 1', () => {
    expect(collectionItemDto.safeParse({ ...VALID, quantity: 0 }).success).toBe(false);
  });

  it('rejects an unknown extra key (strict)', () => {
    expect(collectionItemDto.safeParse({ ...VALID, source_metadata: {} }).success).toBe(false);
  });
});

describe('addCollectionItemRequest', () => {
  it('parses a minimal request (only printingId)', () => {
    expect(addCollectionItemRequest.parse({ printingId: PRINTING_ID }).printingId).toBe(
      PRINTING_ID,
    );
  });

  it('parses a fully-populated request', () => {
    expect(
      addCollectionItemRequest.parse({
        printingId: PRINTING_ID,
        quantity: 2,
        condition: 'LIGHTLY_PLAYED',
        gradeCompany: null,
        grade: null,
        acquiredAt: '2025-11-01',
        acquiredPrice: 49.99,
        acquiredCurrency: 'USD',
        notes: 'card-show pickup',
        source: 'manual',
      }).quantity,
    ).toBe(2);
  });

  it('rejects an attempt to set userId on the wire (strict)', () => {
    expect(
      addCollectionItemRequest.safeParse({ printingId: PRINTING_ID, userId: USER_ID }).success,
    ).toBe(false);
  });

  it('rejects a grade > 10', () => {
    expect(addCollectionItemRequest.safeParse({ printingId: PRINTING_ID, grade: 11 }).success).toBe(
      false,
    );
  });
});

describe('updateCollectionItemRequest', () => {
  it('parses a single-field PATCH', () => {
    expect(updateCollectionItemRequest.parse({ quantity: 3 }).quantity).toBe(3);
  });

  it('rejects a fully-empty PATCH body', () => {
    expect(updateCollectionItemRequest.safeParse({}).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(updateCollectionItemRequest.safeParse({ printingId: PRINTING_ID }).success).toBe(false);
  });
});

describe('customCollectionDto', () => {
  const VALID = {
    id: CUSTOM_COLLECTION_ID,
    userId: USER_ID,
    name: 'Charizards',
    slug: 'charizards',
    kind: 'manual' as const,
    description: 'every Charizard I own',
    coverUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses a manual collection', () => {
    expect(customCollectionDto.parse(VALID).slug).toBe('charizards');
  });

  it('rejects a slug with capitals', () => {
    expect(customCollectionDto.safeParse({ ...VALID, slug: 'Charizards' }).success).toBe(false);
  });
});

describe('customCollectionItemDto', () => {
  it('parses a join row', () => {
    expect(
      customCollectionItemDto.parse({
        customCollectionId: CUSTOM_COLLECTION_ID,
        printingId: PRINTING_ID,
        addedAt: NOW,
      }).printingId,
    ).toBe(PRINTING_ID);
  });

  it('rejects a missing addedAt', () => {
    expect(
      customCollectionItemDto.safeParse({
        customCollectionId: CUSTOM_COLLECTION_ID,
        printingId: PRINTING_ID,
      }).success,
    ).toBe(false);
  });
});

describe('createCustomCollectionRequest', () => {
  it('parses a manual create', () => {
    expect(
      createCustomCollectionRequest.parse({
        kind: 'manual',
        name: 'Charizards',
        slug: 'charizards',
      }).kind,
    ).toBe('manual');
  });

  it('parses a smart create with an opaque expression', () => {
    expect(
      createCustomCollectionRequest.parse({
        kind: 'smart',
        name: 'All Charizards in SWSH',
        slug: 'all-charizards-swsh',
        expression: { op: 'AND', terms: [{ field: 'pokemon_name', eq: 'Charizard' }] },
      }).kind,
    ).toBe('smart');
  });

  it('rejects a smart create missing expression', () => {
    expect(
      createCustomCollectionRequest.safeParse({
        kind: 'smart',
        name: 'X',
        slug: 'x',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(
      createCustomCollectionRequest.safeParse({
        kind: 'hybrid',
        name: 'X',
        slug: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('updateCustomCollectionRequest', () => {
  it('parses a name patch', () => {
    expect(updateCustomCollectionRequest.parse({ name: 'New name' }).name).toBe('New name');
  });

  it('rejects an empty patch', () => {
    expect(updateCustomCollectionRequest.safeParse({}).success).toBe(false);
  });

  it('rejects an attempt to flip kind', () => {
    expect(updateCustomCollectionRequest.safeParse({ kind: 'smart' }).success).toBe(false);
  });
});

describe('addPrintingToCustomCollectionRequest', () => {
  it('parses a printing-id payload', () => {
    expect(addPrintingToCustomCollectionRequest.parse({ printingId: PRINTING_ID }).printingId).toBe(
      PRINTING_ID,
    );
  });

  it('rejects a malformed printingId', () => {
    expect(
      addPrintingToCustomCollectionRequest.safeParse({ printingId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('smartCollectionRuleDto', () => {
  it('parses a row with an opaque expression', () => {
    expect(
      smartCollectionRuleDto.parse({
        customCollectionId: CUSTOM_COLLECTION_ID,
        expression: { op: 'AND' },
        lastEvaluatedAt: NOW,
      }).customCollectionId,
    ).toBe(CUSTOM_COLLECTION_ID);
  });

  it('parses a row with a never-evaluated rule', () => {
    expect(
      smartCollectionRuleDto.parse({
        customCollectionId: CUSTOM_COLLECTION_ID,
        expression: {},
        lastEvaluatedAt: null,
      }).lastEvaluatedAt,
    ).toBeNull();
  });

  it('rejects unknown extra keys', () => {
    expect(
      smartCollectionRuleDto.safeParse({
        customCollectionId: CUSTOM_COLLECTION_ID,
        expression: {},
        lastEvaluatedAt: null,
        unexpected: 'extra',
      }).success,
    ).toBe(false);
  });
});

describe('updateSmartCollectionExpressionRequest', () => {
  it('parses a payload with any expression', () => {
    expect(updateSmartCollectionExpressionRequest.parse({ expression: { op: 'OR' } })).toEqual({
      expression: { op: 'OR' },
    });
  });

  it('rejects when expression key is missing', () => {
    expect(updateSmartCollectionExpressionRequest.safeParse({}).success).toBe(false);
  });
});

// ============================================================
// Completion DTOs
// ============================================================

const SET_ID = '99999999-9999-4999-8999-999999999999';

describe('perSetCompletionEntryDto', () => {
  const VALID = {
    setId: SET_ID,
    setCode: 'swsh9',
    setName: 'Brilliant Stars',
    setPct: 42.5,
    masterPct: 17.0,
    ownedNumbered: 85,
    totalNumbered: 200,
    ownedMaster: 34,
    totalMaster: 200,
  };

  it('parses a populated row', () => {
    expect(perSetCompletionEntryDto.parse(VALID).setCode).toBe('swsh9');
  });

  it('parses a zero-row entry (empty set or unowned)', () => {
    expect(
      perSetCompletionEntryDto.parse({
        ...VALID,
        setPct: 0,
        masterPct: 0,
        ownedNumbered: 0,
        ownedMaster: 0,
      }).setPct,
    ).toBe(0);
  });

  it('rejects a percentage above 100', () => {
    expect(perSetCompletionEntryDto.safeParse({ ...VALID, setPct: 101 }).success).toBe(false);
  });

  it('rejects an empty set code', () => {
    expect(perSetCompletionEntryDto.safeParse({ ...VALID, setCode: '' }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(perSetCompletionEntryDto.safeParse({ ...VALID, surplus: 1 }).success).toBe(false);
  });
});

describe('globalCompletionDto', () => {
  const VALID = {
    allPokemonPct: 12.5,
    masterPct: 4.0,
    uniqueCardsOwned: 100,
    uniqueCardsTotal: 800,
    masterOwned: 40,
    masterTotal: 1000,
  };

  it('parses a populated global tally', () => {
    expect(globalCompletionDto.parse(VALID).allPokemonPct).toBe(12.5);
  });

  it('parses an all-zeros (empty collection) tally', () => {
    expect(
      globalCompletionDto.parse({
        allPokemonPct: 0,
        masterPct: 0,
        uniqueCardsOwned: 0,
        uniqueCardsTotal: 0,
        masterOwned: 0,
        masterTotal: 0,
      }).uniqueCardsOwned,
    ).toBe(0);
  });

  it('rejects negative tallies', () => {
    expect(globalCompletionDto.safeParse({ ...VALID, uniqueCardsOwned: -1 }).success).toBe(false);
  });
});

describe('completionDto', () => {
  it('parses a populated response with one per-set entry', () => {
    const parsed = completionDto.parse({
      global: {
        allPokemonPct: 12.5,
        masterPct: 4.0,
        uniqueCardsOwned: 100,
        uniqueCardsTotal: 800,
        masterOwned: 40,
        masterTotal: 1000,
      },
      perSet: [
        {
          setId: SET_ID,
          setCode: 'swsh9',
          setName: 'Brilliant Stars',
          setPct: 42.5,
          masterPct: 17.0,
          ownedNumbered: 85,
          totalNumbered: 200,
          ownedMaster: 34,
          totalMaster: 200,
        },
      ],
      lastUpdatedAt: NOW,
    });
    expect(parsed.perSet).toHaveLength(1);
    expect(parsed.lastUpdatedAt).toBe(NOW);
  });

  it('parses an empty perSet array', () => {
    expect(
      completionDto.parse({
        global: {
          allPokemonPct: 0,
          masterPct: 0,
          uniqueCardsOwned: 0,
          uniqueCardsTotal: 0,
          masterOwned: 0,
          masterTotal: 0,
        },
        perSet: [],
        lastUpdatedAt: null,
      }).perSet,
    ).toHaveLength(0);
  });

  it('rejects a missing global key', () => {
    expect(
      completionDto.safeParse({
        perSet: [],
        lastUpdatedAt: null,
      }).success,
    ).toBe(false);
  });
});

// ============================================================
// Smart-collection preview DTOs
// ============================================================

describe('smartPreviewRequestDto', () => {
  it('parses a request with only the expression', () => {
    expect(
      smartPreviewRequestDto.parse({
        expression: { type: 'eq', field: 'card.name', value: 'Charizard' },
      }).expression,
    ).toEqual({ type: 'eq', field: 'card.name', value: 'Charizard' });
  });

  it('parses a request with limit + offset', () => {
    expect(
      smartPreviewRequestDto.parse({
        expression: { type: 'and', children: [] },
        limit: 50,
        offset: 100,
      }).limit,
    ).toBe(50);
  });

  it('rejects a missing expression', () => {
    expect(smartPreviewRequestDto.safeParse({ limit: 10 }).success).toBe(false);
  });

  it('rejects a limit above the documented max', () => {
    expect(
      smartPreviewRequestDto.safeParse({ expression: {}, limit: 1000 }).success,
    ).toBe(false);
  });

  it('rejects a negative offset', () => {
    expect(
      smartPreviewRequestDto.safeParse({ expression: {}, offset: -1 }).success,
    ).toBe(false);
  });
});

describe('smartPreviewItemDto', () => {
  const VALID = {
    printingId: PRINTING_ID,
    cardId: COLLECTION_ITEM_ID,
    setId: SET_ID,
    cardName: 'Charizard VSTAR',
    cardNumber: '018',
    setName: 'Brilliant Stars',
    setCode: 'swsh9',
    variantLabel: 'Holo',
    imageSmallUrl: 'https://images.binderly.app/small.webp',
  };

  it('parses a populated item', () => {
    expect(smartPreviewItemDto.parse(VALID).cardName).toBe('Charizard VSTAR');
  });

  it('parses an item with a null imageSmallUrl', () => {
    expect(smartPreviewItemDto.parse({ ...VALID, imageSmallUrl: null }).imageSmallUrl).toBeNull();
  });

  it('parses an item with an empty variantLabel (untyped variant)', () => {
    expect(smartPreviewItemDto.parse({ ...VALID, variantLabel: '' }).variantLabel).toBe('');
  });

  it('rejects an item with an empty cardName', () => {
    expect(smartPreviewItemDto.safeParse({ ...VALID, cardName: '' }).success).toBe(false);
  });
});

describe('smartPreviewResponseDto', () => {
  it('parses an empty-results response', () => {
    expect(
      smartPreviewResponseDto.parse({
        items: [],
        totalCount: 0,
        nextOffset: null,
      }).totalCount,
    ).toBe(0);
  });

  it('parses a populated response with paging', () => {
    const parsed = smartPreviewResponseDto.parse({
      items: [
        {
          printingId: PRINTING_ID,
          cardId: COLLECTION_ITEM_ID,
          setId: SET_ID,
          cardName: 'Charizard VSTAR',
          cardNumber: '018',
          setName: 'Brilliant Stars',
          setCode: 'swsh9',
          variantLabel: 'Holo',
          imageSmallUrl: null,
        },
      ],
      totalCount: 500,
      nextOffset: 50,
    });
    expect(parsed.nextOffset).toBe(50);
    expect(parsed.items).toHaveLength(1);
  });

  it('rejects a negative totalCount', () => {
    expect(
      smartPreviewResponseDto.safeParse({ items: [], totalCount: -1, nextOffset: null }).success,
    ).toBe(false);
  });

  it('rejects a missing nextOffset key', () => {
    expect(smartPreviewResponseDto.safeParse({ items: [], totalCount: 0 }).success).toBe(false);
  });
});
