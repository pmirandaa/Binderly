// Tests for `shareables.ts`. Each schema gets a positive +
// negative case.

import { describe, expect, it } from 'vitest';

import {
  createShareableRequest,
  publicShareCountsDto,
  publicShareMemberDto,
  publicShareOwnerDto,
  publicShareableDto,
  shareableDto,
  shareableTarget,
  shareableThemeSchema,
  updateShareableRequest,
} from './shareables.js';

const NOW = '2026-05-05T12:00:00Z';
const USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SHAREABLE_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CUSTOM_COLLECTION_ID = 'cccccccc-3333-4333-8333-cccccccccccc';

describe('shareableThemeSchema', () => {
  it('accepts default and built-in themes', () => {
    expect(shareableThemeSchema.parse('default')).toBe('default');
    expect(shareableThemeSchema.parse('gold')).toBe('gold');
  });

  it('rejects unknown themes', () => {
    expect(shareableThemeSchema.safeParse('chrome').success).toBe(false);
  });
});

describe('shareableTarget', () => {
  it('accepts a full-collection target', () => {
    expect(shareableTarget.parse({ kind: 'full' }).kind).toBe('full');
  });

  it('accepts a custom-collection target', () => {
    expect(
      shareableTarget.parse({
        kind: 'custom',
        customCollectionId: CUSTOM_COLLECTION_ID,
      }).kind,
    ).toBe('custom');
  });

  it('rejects a custom target missing customCollectionId', () => {
    expect(shareableTarget.safeParse({ kind: 'custom' }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(shareableTarget.safeParse({ kind: 'partial' }).success).toBe(false);
  });
});

describe('shareableDto', () => {
  const VALID = {
    id: SHAREABLE_ID,
    userId: USER_ID,
    slug: 'main',
    target: { kind: 'full' as const },
    theme: 'default' as const,
    showValues: false,
    showMissing: true,
    showPhotos: false,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses a default-theme full-collection shareable', () => {
    expect(shareableDto.parse(VALID).target.kind).toBe('full');
  });

  it('parses a themed custom-collection shareable', () => {
    expect(
      shareableDto.parse({
        ...VALID,
        slug: 'charizards',
        target: { kind: 'custom', customCollectionId: CUSTOM_COLLECTION_ID },
        theme: 'gold',
        showValues: true,
        showPhotos: true,
      }).theme,
    ).toBe('gold');
  });

  it('rejects an unknown theme', () => {
    expect(shareableDto.safeParse({ ...VALID, theme: 'platinum' }).success).toBe(false);
  });

  it('rejects a slug with spaces', () => {
    expect(shareableDto.safeParse({ ...VALID, slug: 'my main' }).success).toBe(false);
  });
});

describe('createShareableRequest', () => {
  it('parses a minimal request', () => {
    expect(
      createShareableRequest.parse({
        slug: 'main',
        target: { kind: 'full' },
      }).slug,
    ).toBe('main');
  });

  it('rejects an attempt to set userId (strict)', () => {
    expect(
      createShareableRequest.safeParse({
        slug: 'main',
        target: { kind: 'full' },
        userId: USER_ID,
      }).success,
    ).toBe(false);
  });

  it('rejects a missing target', () => {
    expect(createShareableRequest.safeParse({ slug: 'main' }).success).toBe(false);
  });
});

describe('updateShareableRequest', () => {
  it('parses a single-field PATCH', () => {
    expect(updateShareableRequest.parse({ showValues: true }).showValues).toBe(true);
  });

  it('rejects an empty body', () => {
    expect(updateShareableRequest.safeParse({}).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(updateShareableRequest.safeParse({ slug: 'main', userId: USER_ID }).success).toBe(false);
  });
});

// ============================================================
// Public shareable DTOs
// ============================================================

const PRINTING_ID = 'dddddddd-4444-4444-8444-dddddddddddd';
const CARD_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const SET_ID = 'ffffffff-6666-4666-8666-ffffffffffff';

describe('publicShareOwnerDto', () => {
  it('parses a populated owner row', () => {
    expect(
      publicShareOwnerDto.parse({
        handle: 'pablo',
        displayName: 'Pablo',
        avatarUrl: 'https://images.binderly.app/p.webp',
        bio: 'Binder enjoyer',
      }).handle,
    ).toBe('pablo');
  });

  it('parses a barebones owner (every optional field null)', () => {
    expect(
      publicShareOwnerDto.parse({
        handle: 'pablo',
        displayName: null,
        avatarUrl: null,
        bio: null,
      }).displayName,
    ).toBeNull();
  });

  it('rejects an avatar URL that is not a URL', () => {
    expect(
      publicShareOwnerDto.safeParse({
        handle: 'pablo',
        displayName: null,
        avatarUrl: 'not-a-url',
        bio: null,
      }).success,
    ).toBe(false);
  });
});

describe('publicShareMemberDto', () => {
  const VALID = {
    printingId: PRINTING_ID,
    cardId: CARD_ID,
    cardName: 'Charizard VSTAR',
    cardNumber: '018',
    setName: 'Brilliant Stars',
    setCode: 'swsh9',
    variantLabel: 'Holo',
    imageUrl: 'https://images.binderly.app/p.webp',
    quantity: 2,
  };

  it('parses a populated member', () => {
    expect(publicShareMemberDto.parse(VALID).quantity).toBe(2);
  });

  it('parses a member with a null imageUrl', () => {
    expect(publicShareMemberDto.parse({ ...VALID, imageUrl: null }).imageUrl).toBeNull();
  });

  it('rejects a negative quantity', () => {
    expect(publicShareMemberDto.safeParse({ ...VALID, quantity: -1 }).success).toBe(false);
  });
});

describe('publicShareCountsDto', () => {
  it('parses populated counts', () => {
    expect(
      publicShareCountsDto.parse({
        ownedUnique: 12,
        ownedTotalQuantity: 24,
        catalogTotal: 200,
        completionPct: 6,
      }).completionPct,
    ).toBe(6);
  });

  it('parses all-zeros counts', () => {
    expect(
      publicShareCountsDto.parse({
        ownedUnique: 0,
        ownedTotalQuantity: 0,
        catalogTotal: 0,
        completionPct: 0,
      }).catalogTotal,
    ).toBe(0);
  });

  it('rejects a percentage above 100', () => {
    expect(
      publicShareCountsDto.safeParse({
        ownedUnique: 0,
        ownedTotalQuantity: 0,
        catalogTotal: 0,
        completionPct: 100.5,
      }).success,
    ).toBe(false);
  });
});

describe('publicShareableDto', () => {
  const VALID_SHAREABLE = {
    id: SHAREABLE_ID,
    userId: USER_ID,
    slug: 'main',
    target: { kind: 'full' as const },
    theme: 'default' as const,
    showValues: false,
    showMissing: true,
    showPhotos: false,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const VALID = {
    shareable: VALID_SHAREABLE,
    owner: {
      handle: 'pablo',
      displayName: 'Pablo',
      avatarUrl: null,
      bio: null,
    },
    collectionTitle: "Pablo's collection",
    description: null,
    counts: {
      ownedUnique: 100,
      ownedTotalQuantity: 120,
      catalogTotal: 800,
      completionPct: 12.5,
    },
    members: [
      {
        printingId: PRINTING_ID,
        cardId: CARD_ID,
        cardName: 'Charizard VSTAR',
        cardNumber: '018',
        setName: 'Brilliant Stars',
        setCode: 'swsh9',
        variantLabel: 'Holo',
        imageUrl: null,
        quantity: 1,
      },
    ],
    lastUpdatedAt: NOW,
  };

  it('parses a populated payload', () => {
    expect(publicShareableDto.parse(VALID).collectionTitle).toBe("Pablo's collection");
  });

  it('parses a zero-members payload (empty array, NOT 404)', () => {
    expect(publicShareableDto.parse({ ...VALID, members: [] }).members).toHaveLength(0);
  });

  it('parses a custom-target payload', () => {
    expect(
      publicShareableDto.parse({
        ...VALID,
        shareable: { ...VALID_SHAREABLE, target: { kind: 'custom', customCollectionId: SET_ID } },
        collectionTitle: 'Charizard binder',
      }).collectionTitle,
    ).toBe('Charizard binder');
  });

  it('rejects a missing owner key', () => {
    const { owner: _o, ...without } = VALID;
    expect(publicShareableDto.safeParse(without).success).toBe(false);
  });

  it('rejects unknown extra keys (strict)', () => {
    expect(publicShareableDto.safeParse({ ...VALID, surplus: 1 }).success).toBe(false);
  });
});
