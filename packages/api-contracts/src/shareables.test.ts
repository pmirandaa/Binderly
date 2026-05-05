// Tests for `shareables.ts`. Each schema gets a positive +
// negative case.

import { describe, expect, it } from 'vitest';

import {
  createShareableRequest,
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
