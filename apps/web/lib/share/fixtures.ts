// Test-only fixtures + fake `ShareApi` for the `/c/[handle]/[slug]`
// test suites. Located inside `lib/share/` so it stays inside
// T-W-SHAREABLE-PUBLIC's `owns_paths`, but it is NOT imported by
// any production code path — only `*.test.tsx` files. The `vi`
// import resolves through vitest (a devDependency) and is
// tree-shaken out of the Next.js production bundle.
//
// Matches the pattern T-W-BROWSE + T-W-COLLECTION established:
// builders for individual DTO shapes, a "standard" fixture that
// drives most assertions, and a `createFakeShareApi` factory that
// returns a `vi.fn`-wrapped implementation for spying.

import { vi } from 'vitest';

import type { ShareableDto } from '@binderly/api-contracts';

import type {
  PublicSharePayload,
  PublicShareMember,
  PublicShareOwner,
  ShareApi,
} from './api';

const DEFAULT_TIMESTAMP = '2024-01-01T00:00:00.000Z';

export function makeShareableDto(overrides: Partial<ShareableDto> = {}): ShareableDto {
  return {
    id: '77777777-7777-7777-7777-777777777771',
    userId: '88888888-8888-8888-8888-888888888888',
    slug: 'my-binder',
    target: { kind: 'full' },
    theme: 'default',
    showValues: false,
    showMissing: true,
    showPhotos: false,
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

export function makePublicShareOwner(
  overrides: Partial<PublicShareOwner> = {},
): PublicShareOwner {
  return {
    handle: 'pablo',
    displayName: 'Pablo Miranda',
    avatarUrl: null,
    bio: 'Collecting since Base Set.',
    ...overrides,
  };
}

export function makePublicShareMember(
  overrides: Partial<PublicShareMember> = {},
): PublicShareMember {
  return {
    printingId: 'p-a1-holo',
    cardId: 'card-a1',
    cardName: 'Charizard',
    cardNumber: '4',
    setName: 'Base Set',
    setCode: 'base1',
    variantLabel: 'Holo',
    imageUrl: 'https://images.binderly.app/printings/base1-4-holo-sm.webp',
    quantity: 1,
    ...overrides,
  };
}

export const FIXTURE_MEMBERS: PublicShareMember[] = [
  makePublicShareMember({
    printingId: 'p-a1-holo',
    cardId: 'card-a1',
    cardName: 'Charizard',
    cardNumber: '4',
    setName: 'Base Set',
    setCode: 'base1',
    variantLabel: 'Holo',
    imageUrl: 'https://images.binderly.app/printings/base1-4-holo-sm.webp',
    quantity: 1,
  }),
  makePublicShareMember({
    printingId: 'p-a2-promo',
    cardId: 'card-a2',
    cardName: 'Blastoise',
    cardNumber: '2',
    setName: 'Base Set',
    setCode: 'base1',
    variantLabel: 'Promo',
    imageUrl: 'https://images.binderly.app/printings/base1-2-promo-sm.webp',
    quantity: 1,
  }),
  makePublicShareMember({
    printingId: 'p-b1-alt',
    cardId: 'card-b1',
    cardName: 'Mew',
    cardNumber: '12',
    setName: 'Astral Radiance',
    setCode: 'swsh10',
    variantLabel: 'Alt art',
    imageUrl: null,
    quantity: 2,
  }),
];

export function makePublicSharePayload(
  overrides: Partial<PublicSharePayload> = {},
): PublicSharePayload {
  return {
    shareable: makeShareableDto(),
    owner: makePublicShareOwner(),
    collectionTitle: "Pablo's collection",
    description: 'My all-time favourites.',
    counts: {
      ownedUnique: 142,
      ownedTotalQuantity: 167,
      catalogTotal: 1832,
      completionPct: 7.75,
    },
    members: FIXTURE_MEMBERS,
    lastUpdatedAt: '2026-05-01T12:00:00.000Z',
    ...overrides,
  };
}

export const FIXTURE_PUBLIC_SHARE_PAYLOAD: PublicSharePayload = makePublicSharePayload();

export interface FakeShareApiOptions {
  /** Override the payload returned by `getPublicSharePayload`. */
  payload?: PublicSharePayload;
  /** When set, `getPublicSharePayload` resolves to `null` (page → 404). */
  notFound?: boolean;
  /** When set, every method throws this error (used for the error state). */
  rejectAll?: Error;
}

export interface FakeShareApi extends ShareApi {
  getPublicSharePayload: ReturnType<typeof vi.fn>;
}

export function createFakeShareApi(options: FakeShareApiOptions = {}): FakeShareApi {
  const payload = options.payload ?? FIXTURE_PUBLIC_SHARE_PAYLOAD;
  const getPublicSharePayload = vi.fn(async () => {
    if (options.rejectAll !== undefined) throw options.rejectAll;
    if (options.notFound === true) return null;
    return payload;
  });
  return { getPublicSharePayload };
}
