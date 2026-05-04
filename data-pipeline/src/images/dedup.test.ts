// Dedup tests — exercise the in-memory resolver (the production
// resolver wiring lives in T-DL-SEED-INGEST). The interface is
// narrow enough that the in-memory shape is the same one the
// processor consumes, which keeps the contract honest.

import { describe, expect, it } from 'vitest';

import { InMemoryDedupResolver, sha256Hex, variantsFromList } from './dedup.js';
import { DedupError, type ProcessedImageVariant } from './types.js';

const SAMPLE_VARIANTS: ProcessedImageVariant[] = [
  {
    name: 'thumb',
    url: 'http://localhost:9000/images/printings/en-swsh9/en-swsh9-018-holo/thumb.webp',
    storageKey: 'printings/en-swsh9/en-swsh9-018-holo/thumb.webp',
    sha256: 'a'.repeat(64),
    byteSize: 1234,
    width: 183,
    height: 256,
    contentType: 'image/webp',
  },
  {
    name: 'card',
    url: 'http://localhost:9000/images/printings/en-swsh9/en-swsh9-018-holo/card.webp',
    storageKey: 'printings/en-swsh9/en-swsh9-018-holo/card.webp',
    sha256: 'b'.repeat(64),
    byteSize: 4321,
    width: 366,
    height: 512,
    contentType: 'image/webp',
  },
  {
    name: 'large',
    url: 'http://localhost:9000/images/printings/en-swsh9/en-swsh9-018-holo/large.webp',
    storageKey: 'printings/en-swsh9/en-swsh9-018-holo/large.webp',
    sha256: 'c'.repeat(64),
    byteSize: 12345,
    width: 731,
    height: 1024,
    contentType: 'image/webp',
  },
  {
    name: 'original',
    url: 'http://localhost:9000/images/printings/en-swsh9/en-swsh9-018-holo/original.webp',
    storageKey: 'printings/en-swsh9/en-swsh9-018-holo/original.webp',
    sha256: 'd'.repeat(64),
    byteSize: 99999,
    width: 1463,
    height: 2048,
    contentType: 'image/webp',
  },
];

describe('InMemoryDedupResolver', () => {
  it('returns null on the first lookup for a (source, hash)', async () => {
    const resolver = new InMemoryDedupResolver();
    const row = await resolver.findExisting({
      source: 'tcgdex-en',
      originalSha256: 'deadbeef'.repeat(8),
    });
    expect(row).toBeNull();
  });

  it('upsert + findExisting round-trip preserves all fields', async () => {
    const resolver = new InMemoryDedupResolver();
    const inserted = await resolver.upsert({
      source: 'tcgdex-en',
      sourceUrl: 'https://assets.tcgdex.net/en/swsh/swsh9/018/high.png',
      sourceContentType: 'image/png',
      originalSha256: 'feed'.repeat(16),
      originalByteSize: 50_000,
      variants: SAMPLE_VARIANTS,
      license: 'TCGDEX',
      printingId: 'pr-001',
    });
    expect(inserted.id).toMatch(/^printing-image-/);
    expect(inserted.printingId).toBe('pr-001');
    expect(inserted.license).toBe('TCGDEX');
    expect(inserted.variants.thumb.byteSize).toBe(1234);

    const fetched = await resolver.findExisting({
      source: 'tcgdex-en',
      originalSha256: 'feed'.repeat(16),
    });
    expect(fetched?.id).toBe(inserted.id);
    expect(fetched?.variants.large.url).toBe(SAMPLE_VARIANTS[2]!.url);
  });

  it('upsert is idempotent: re-upserting same key updates instead of inserting', async () => {
    const resolver = new InMemoryDedupResolver();
    await resolver.upsert({
      source: 'ptcgio',
      sourceUrl: 'https://images.pokemontcg.io/swsh9/18_hires.png',
      sourceContentType: 'image/png',
      originalSha256: '1234'.repeat(16),
      originalByteSize: 1000,
      variants: SAMPLE_VARIANTS,
      license: 'PTCGIO',
    });
    const updated = await resolver.upsert({
      source: 'ptcgio',
      sourceUrl: 'https://images.pokemontcg.io/swsh9/18_hires.png',
      sourceContentType: 'image/png',
      originalSha256: '1234'.repeat(16),
      originalByteSize: 1000,
      variants: SAMPLE_VARIANTS,
      license: 'PTCGIO',
    });
    expect(resolver.size()).toBe(1);
    expect(updated.id).toBeDefined();
  });

  it('keys dedup separately per source (same hash, different sources is two rows)', async () => {
    const resolver = new InMemoryDedupResolver();
    const sha = 'abc'.repeat(20).slice(0, 64);
    await resolver.upsert({
      source: 'tcgdex-en',
      sourceUrl: 'https://assets.tcgdex.net/en/x/x.png',
      sourceContentType: 'image/png',
      originalSha256: sha,
      originalByteSize: 1,
      variants: SAMPLE_VARIANTS,
      license: 'TCGDEX',
    });
    await resolver.upsert({
      source: 'ptcgio',
      sourceUrl: 'https://images.pokemontcg.io/x.png',
      sourceContentType: 'image/png',
      originalSha256: sha,
      originalByteSize: 1,
      variants: SAMPLE_VARIANTS,
      license: 'PTCGIO',
    });
    expect(resolver.size()).toBe(2);
  });
});

describe('variantsFromList', () => {
  it('projects an array into a name-keyed record', () => {
    const projected = variantsFromList(SAMPLE_VARIANTS);
    expect(Object.keys(projected).sort()).toEqual(['card', 'large', 'original', 'thumb']);
    expect(projected.thumb.byteSize).toBe(1234);
  });

  it('throws DedupError on an empty list', () => {
    expect(() => variantsFromList([])).toThrow(DedupError);
  });
});

describe('sha256Hex', () => {
  it('matches the universally-known SHA-256 of the empty buffer', () => {
    // Reference: https://en.wikipedia.org/wiki/SHA-2#Test_vectors
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns a 64-character lowercase hex digest', () => {
    const digest = sha256Hex(Buffer.from('whatever non-empty payload', 'utf8'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: same bytes → same digest', () => {
    const a = sha256Hex(Buffer.from([0x01, 0x02, 0x03]));
    const b = sha256Hex(Buffer.from([0x01, 0x02, 0x03]));
    expect(a).toBe(b);
  });
});
