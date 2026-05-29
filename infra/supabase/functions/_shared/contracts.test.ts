import { describe, expect, it } from 'vitest';

import {
  addCollectionItemRequest,
  addPrintingToCustomCollectionRequest,
  bulkUpdateCollectionRequest,
  CARD_CONDITIONS,
  COLLECTION_ITEM_SOURCES,
  COMMUNITY_GRADE_COMPANIES,
  createCustomCollectionRequest,
  GRADE_COMPANIES,
  slugSchema,
  submitCommunitySubmissionRequest,
  updateCollectionItemRequest,
  updateCustomCollectionRequest,
  updateSmartCollectionExpressionRequest,
} from './contracts.ts';
import { FIXTURE_PRINTING_ID, FIXTURE_COLLECTION_ITEM_ID } from './test-helpers.ts';

describe('addCollectionItemRequest', () => {
  it('accepts a minimal valid payload', () => {
    const result = addCollectionItemRequest.safeParse({ printingId: FIXTURE_PRINTING_ID });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown key (strict)', () => {
    const result = addCollectionItemRequest.safeParse({
      printingId: FIXTURE_PRINTING_ID,
      surprise: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid printingId', () => {
    const result = addCollectionItemRequest.safeParse({ printingId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a quantity below 1', () => {
    const result = addCollectionItemRequest.safeParse({
      printingId: FIXTURE_PRINTING_ID,
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a grade above 10', () => {
    const result = addCollectionItemRequest.safeParse({
      printingId: FIXTURE_PRINTING_ID,
      grade: 11,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a 1.0–10.0 numeric grade', () => {
    const result = addCollectionItemRequest.safeParse({
      printingId: FIXTURE_PRINTING_ID,
      grade: 9.5,
      gradeCompany: 'PSA',
    });
    expect(result.success).toBe(true);
  });

  it('accepts only canonical conditions', () => {
    for (const condition of CARD_CONDITIONS) {
      const result = addCollectionItemRequest.safeParse({
        printingId: FIXTURE_PRINTING_ID,
        condition,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts only canonical grade companies', () => {
    for (const gradeCompany of GRADE_COMPANIES) {
      const result = addCollectionItemRequest.safeParse({
        printingId: FIXTURE_PRINTING_ID,
        gradeCompany,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts only canonical sources', () => {
    for (const source of COLLECTION_ITEM_SOURCES) {
      const result = addCollectionItemRequest.safeParse({
        printingId: FIXTURE_PRINTING_ID,
        source,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('updateCollectionItemRequest', () => {
  it('rejects an empty patch body', () => {
    const result = updateCollectionItemRequest.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts a single-field patch', () => {
    const result = updateCollectionItemRequest.safeParse({ quantity: 3 });
    expect(result.success).toBe(true);
  });
});

describe('bulkUpdateCollectionRequest', () => {
  it('requires at least one item', () => {
    const result = bulkUpdateCollectionRequest.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it('caps batches at 100 items', () => {
    const items = Array.from({ length: 101 }, () => ({
      id: FIXTURE_COLLECTION_ITEM_ID,
      patch: { quantity: 1 },
    }));
    const result = bulkUpdateCollectionRequest.safeParse({ items });
    expect(result.success).toBe(false);
  });

  it('accepts a 1-item batch', () => {
    const result = bulkUpdateCollectionRequest.safeParse({
      items: [{ id: FIXTURE_COLLECTION_ITEM_ID, patch: { quantity: 1 } }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a 100-item batch', () => {
    const items = Array.from({ length: 100 }, () => ({
      id: FIXTURE_COLLECTION_ITEM_ID,
      patch: { quantity: 1 },
    }));
    const result = bulkUpdateCollectionRequest.safeParse({ items });
    expect(result.success).toBe(true);
  });

  it('rejects an item without a uuid id', () => {
    const result = bulkUpdateCollectionRequest.safeParse({
      items: [{ id: 'nope', patch: { quantity: 1 } }],
    });
    expect(result.success).toBe(false);
  });
});

describe('createCustomCollectionRequest', () => {
  it('accepts a manual collection', () => {
    const result = createCustomCollectionRequest.safeParse({
      kind: 'manual',
      name: 'Gym Leaders',
      slug: 'gym-leaders',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a smart collection with an expression', () => {
    const result = createCustomCollectionRequest.safeParse({
      kind: 'smart',
      name: 'Holos',
      slug: 'holos',
      expression: { rule: 'variantClass=HOLO' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a smart collection without an expression', () => {
    const result = createCustomCollectionRequest.safeParse({
      kind: 'smart',
      name: 'Holos',
      slug: 'holos',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    const result = createCustomCollectionRequest.safeParse({
      kind: 'enchanted',
      name: 'Mythicals',
      slug: 'myth',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-kebab-case slug', () => {
    const result = createCustomCollectionRequest.safeParse({
      kind: 'manual',
      name: 'X',
      slug: 'Bad Slug',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateCustomCollectionRequest', () => {
  it('rejects an empty patch', () => {
    expect(updateCustomCollectionRequest.safeParse({}).success).toBe(false);
  });

  it('accepts a name-only patch', () => {
    expect(updateCustomCollectionRequest.safeParse({ name: 'Renamed' }).success).toBe(true);
  });
});

describe('addPrintingToCustomCollectionRequest', () => {
  it('requires printingId', () => {
    expect(addPrintingToCustomCollectionRequest.safeParse({}).success).toBe(false);
  });
  it('accepts a uuid printingId', () => {
    expect(
      addPrintingToCustomCollectionRequest.safeParse({ printingId: FIXTURE_PRINTING_ID }).success,
    ).toBe(true);
  });
});

describe('updateSmartCollectionExpressionRequest', () => {
  it('requires expression', () => {
    expect(updateSmartCollectionExpressionRequest.safeParse({}).success).toBe(false);
  });
  it('accepts any non-undefined expression', () => {
    expect(
      updateSmartCollectionExpressionRequest.safeParse({ expression: { foo: 'bar' } }).success,
    ).toBe(true);
    expect(updateSmartCollectionExpressionRequest.safeParse({ expression: null }).success).toBe(
      true,
    );
  });
});

describe('submitCommunitySubmissionRequest', () => {
  const FRONT = 'https://cdn.binderly.test/front.jpg';
  const BACK = 'https://cdn.binderly.test/back.jpg';
  const base = {
    gradeCompany: 'PSA',
    certNumber: '12345678',
    images: { front: FRONT, back: BACK },
    consent: true,
  } as const;

  it('accepts a minimal valid payload with an overallGrade', () => {
    const result = submitCommunitySubmissionRequest.safeParse({ ...base, overallGrade: 9 });
    expect(result.success).toBe(true);
  });

  it('accepts SGC (superset of the collection grade companies)', () => {
    expect(COMMUNITY_GRADE_COMPANIES).toContain('SGC');
    const result = submitCommunitySubmissionRequest.safeParse({
      ...base,
      gradeCompany: 'SGC',
      overallGrade: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects consent !== true', () => {
    const result = submitCommunitySubmissionRequest.safeParse({
      ...base,
      overallGrade: 9,
      consent: false,
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one grade signal', () => {
    const result = submitCommunitySubmissionRequest.safeParse(base);
    expect(result.success).toBe(false);
  });

  it('accepts blackLabel as the sole grade signal', () => {
    const result = submitCommunitySubmissionRequest.safeParse({ ...base, blackLabel: true });
    expect(result.success).toBe(true);
  });

  it('accepts non-empty subgrades as the sole grade signal', () => {
    const result = submitCommunitySubmissionRequest.safeParse({
      ...base,
      subgrades: { centering: 9.5 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an off-grid grade (e.g. 8.3)', () => {
    const result = submitCommunitySubmissionRequest.safeParse({ ...base, overallGrade: 8.3 });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    const result = submitCommunitySubmissionRequest.safeParse({
      ...base,
      overallGrade: 9,
      surprise: true,
    });
    expect(result.success).toBe(false);
  });

  it('requires front + back images', () => {
    const result = submitCommunitySubmissionRequest.safeParse({
      ...base,
      overallGrade: 9,
      images: { front: FRONT },
    });
    expect(result.success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('accepts a kebab-case alphanumeric slug', () => {
    expect(slugSchema.safeParse('gym-leaders-99').success).toBe(true);
  });
  it('rejects uppercase letters', () => {
    expect(slugSchema.safeParse('GymLeaders').success).toBe(false);
  });
  it('rejects whitespace', () => {
    expect(slugSchema.safeParse('gym leaders').success).toBe(false);
  });
});
