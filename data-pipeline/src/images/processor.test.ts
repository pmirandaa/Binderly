// Processor tests — exercise `processImage` end-to-end with a
// hand-rolled `RateLimitedClient` (driven by a `fetchImpl` shim,
// matching the pattern in `src/http/rate-limited-client.test.ts`),
// `aws-sdk-client-mock` for the storage put/head, and the
// in-memory dedup resolver.
//
// We use a single-rung ladder in most tests to keep transcode time
// negligible. The full ladder is covered in `transcoder.test.ts`.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryDedupResolver, sha256Hex } from './dedup.js';
import { processImage } from './processor.js';
import { S3ImageStorage } from './storage.js';
import { isWebpBuffer } from './transcoder.js';
import {
  DedupError,
  FetchError,
  StorageError,
  TranscodeError,
  type ImageSource,
  type VariantSpec,
} from './types.js';
import { RateLimitedClient } from '../http/rate-limited-client.js';
import { TransientError } from '../interfaces/adapter.js';

// ============================================================
// Helpers
// ============================================================

const TINY_LADDER: VariantSpec[] = [
  { name: 'thumb', maxSide: 64, quality: 70, effort: 4, lossless: false },
];

const FULL_TINY_LADDER: VariantSpec[] = [
  { name: 'thumb', maxSide: 64, quality: 70, effort: 4, lossless: false },
  { name: 'card', maxSide: 96, quality: 80, effort: 4, lossless: false },
  { name: 'large', maxSide: 128, quality: 85, effort: 4, lossless: false },
  { name: 'original', maxSide: null, quality: 100, effort: 4, lossless: true },
];

const HOST = 'fixture.example.com';
const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

async function makePngBytes(width = 200, height = 280): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

interface FetchProgrammedResponse {
  status: number;
  body?: Buffer;
  headers?: Record<string, string>;
  throw?: Error;
}

class FetchShim {
  readonly requests: { url: string }[] = [];
  private readonly queue: FetchProgrammedResponse[] = [];

  enqueue(...resp: FetchProgrammedResponse[]): this {
    this.queue.push(...resp);
    return this;
  }

  readonly fetch = async (input: string | URL): Promise<Response> => {
    this.requests.push({ url: input.toString() });
    const next = this.queue.shift();
    if (!next) throw new Error(`FetchShim: no programmed response for ${input.toString()}`);
    if (next.throw) throw next.throw;
    return new Response(next.body ?? Buffer.alloc(0), {
      status: next.status,
      headers: next.headers,
    });
  };
}

function newHttp(shim: FetchShim): RateLimitedClient {
  return new RateLimitedClient({
    host: HOST,
    requestsPerSecond: 1000,
    burst: 10,
    userAgent: UA,
    retries: { max: 0, baseDelayMs: 1, factor: 2 },
    timeout: 5_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
  });
}

interface ProcessorRig {
  shim: FetchShim;
  http: RateLimitedClient;
  storage: S3ImageStorage;
  storageMock: ReturnType<typeof mockClient>;
  dedup: InMemoryDedupResolver;
}

function buildRig(): ProcessorRig {
  const shim = new FetchShim();
  const http = newHttp(shim);
  const s3 = new S3Client({});
  const storageMock = mockClient(s3);
  storageMock.on(PutObjectCommand).resolves({});
  const storage = new S3ImageStorage({
    bucket: 'images',
    publicUrlPrefix: 'http://localhost:9000/images',
    client: s3,
  });
  const dedup = new InMemoryDedupResolver();
  return { shim, http, storage, storageMock, dedup };
}

// ============================================================
// Tests
// ============================================================

describe('processImage (skipped paths)', () => {
  let rig: ProcessorRig;
  beforeEach(() => {
    rig = buildRig();
  });
  afterEach(() => {
    rig.storageMock.reset();
  });

  it('returns skipped_no_url when sourceUrl is null', async () => {
    const result = await processImage({
      printing: { variantKey: 'en-swsh9-018-holo', setCanonicalKey: 'en-swsh9' },
      source: 'tcgdex-en',
      sourceUrl: null,
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('skipped_no_url');
    expect(result.provenance).toBeNull();
    expect(result.variants).toEqual([]);
    expect(rig.shim.requests).toHaveLength(0);
    expect(rig.storageMock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(rig.dedup.size()).toBe(0);
  });

  it('returns skipped_no_url for an empty-string sourceUrl', async () => {
    const result = await processImage({
      printing: { variantKey: 'x', setCanonicalKey: 'y' },
      source: 'tcgdex-en',
      sourceUrl: '',
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('skipped_no_url');
  });

  it('returns skipped_excluded_source for Bulbapedia even with a non-null URL', async () => {
    // Defence-in-depth: the adapter already emits null, but if a
    // future code path passed a URL we should still refuse.
    const result = await processImage({
      printing: { variantKey: 'en-swsh9-018-holo', setCanonicalKey: 'en-swsh9' },
      source: 'bulbapedia-en' as ImageSource,
      sourceUrl: 'https://archives.bulbagarden.net/img.png',
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('skipped_excluded_source');
    expect(rig.shim.requests).toHaveLength(0);
    expect(rig.storageMock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(rig.dedup.size()).toBe(0);
  });
});

describe('processImage (happy path)', () => {
  let rig: ProcessorRig;
  beforeEach(() => {
    rig = buildRig();
  });
  afterEach(() => {
    rig.storageMock.reset();
  });

  it('fetches → transcodes → uploads → upserts and returns transcoded', async () => {
    const png = await makePngBytes();
    rig.shim.enqueue({
      status: 200,
      body: png,
      headers: { 'content-type': 'image/png' },
    });

    const result = await processImage({
      printing: {
        variantKey: 'en-swsh9-018-holo',
        setCanonicalKey: 'en-swsh9',
        printingId: 'pr-001',
      },
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/en/swsh/swsh9/018/high.png`,
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
      ladder: FULL_TINY_LADDER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok=true');
    expect(result.status).toBe('transcoded');
    expect(result.variants).toHaveLength(4);
    for (const v of result.variants) {
      expect(v.contentType).toBe('image/webp');
      expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(v.byteSize).toBeGreaterThan(0);
      expect(v.storageKey).toBe(`printings/en-swsh9/en-swsh9-018-holo/${v.name}.webp`);
      expect(v.url).toBe(
        `http://localhost:9000/images/printings/en-swsh9/en-swsh9-018-holo/${v.name}.webp`,
      );
    }

    // Each variant translated to one PutObjectCommand.
    const puts = rig.storageMock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(4);
    for (const call of puts) {
      const input = call.args[0].input;
      expect(input.Bucket).toBe('images');
      expect(input.ContentType).toBe('image/webp');
      expect(input.CacheControl).toContain('immutable');
      const body = input.Body as Buffer;
      expect(isWebpBuffer(body)).toBe(true);
    }

    // Provenance row recorded with the right license + hash.
    expect(result.provenance).not.toBeNull();
    expect(result.provenance?.source).toBe('tcgdex-en');
    expect(result.provenance?.license).toBe('TCGDEX');
    expect(result.provenance?.originalByteSize).toBe(png.length);
    expect(result.provenance?.originalSha256).toBe(sha256Hex(png));
    expect(result.provenance?.printingId).toBe('pr-001');
    expect(result.provenance?.sourceContentType).toBe('image/png');
  });

  it('writes the correct license tag per source', async () => {
    const png = await makePngBytes(80, 80);
    const cases: Array<{ source: ImageSource; license: string }> = [
      { source: 'tcgdex-en', license: 'TCGDEX' },
      { source: 'tcgdex-jp', license: 'TCGDEX' },
      { source: 'ptcgio', license: 'PTCGIO' },
      { source: 'pokemoncard-jp', license: 'POKEMON_CARD_JP' },
    ];
    for (const { source, license } of cases) {
      const localRig = buildRig();
      localRig.shim.enqueue({
        status: 200,
        body: png,
        headers: { 'content-type': 'image/png' },
      });
      const result = await processImage({
        printing: {
          variantKey: `${source}-printing-key`,
          setCanonicalKey: 'set-key',
        },
        source,
        sourceUrl: `https://${HOST}/${source}.png`,
        http: localRig.http,
        storage: localRig.storage,
        dedup: localRig.dedup,
        ladder: TINY_LADDER,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.provenance?.license).toBe(license);
      localRig.storageMock.reset();
    }
  });
});

describe('processImage (cached path)', () => {
  let rig: ProcessorRig;
  beforeEach(() => {
    rig = buildRig();
  });
  afterEach(() => {
    rig.storageMock.reset();
  });

  it('skips transcode + upload when the SHA-256 already exists', async () => {
    const png = await makePngBytes(120, 168);
    // Pre-seed the dedup resolver with a row that matches what
    // the processor would compute.
    await rig.dedup.upsert({
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/x.png`,
      sourceContentType: 'image/png',
      originalSha256: sha256Hex(png),
      originalByteSize: png.length,
      variants: [
        {
          name: 'thumb',
          url: 'http://localhost:9000/images/printings/x/y/thumb.webp',
          storageKey: 'printings/x/y/thumb.webp',
          sha256: 'f'.repeat(64),
          byteSize: 100,
          width: 64,
          height: 64,
          contentType: 'image/webp',
        },
      ],
      license: 'TCGDEX',
    });

    rig.shim.enqueue({
      status: 200,
      body: png,
      headers: { 'content-type': 'image/png' },
    });

    const transcodeSpy = vi.spyOn(rig.storage, 'put');
    const result = await processImage({
      printing: { variantKey: 'x-y', setCanonicalKey: 'x' },
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/x.png`,
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
      ladder: TINY_LADDER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('cached');
    expect(transcodeSpy).not.toHaveBeenCalled();
    expect(rig.storageMock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(result.variants[0]!.storageKey).toBe('printings/x/y/thumb.webp');
  });
});

describe('processImage (error paths)', () => {
  let rig: ProcessorRig;
  beforeEach(() => {
    rig = buildRig();
  });
  afterEach(() => {
    rig.storageMock.reset();
  });

  it('wraps a TransientError fetch failure as FetchError', async () => {
    rig.shim.enqueue({ status: 500, body: Buffer.alloc(0) });
    const result = await processImage({
      printing: { variantKey: 'x-y', setCanonicalKey: 'x' },
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/missing.png`,
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
      ladder: TINY_LADDER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FetchError);
    const fetchErr = result.error as FetchError;
    expect(fetchErr.upstream).toBeInstanceOf(TransientError);
  });

  it('returns TranscodeError when the body is not a real image', async () => {
    rig.shim.enqueue({
      status: 200,
      body: Buffer.from('this is plainly not an image', 'utf8'),
      headers: { 'content-type': 'text/plain' },
    });
    const result = await processImage({
      printing: { variantKey: 'x-y', setCanonicalKey: 'x' },
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/garbage.png`,
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
      ladder: TINY_LADDER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TranscodeError);
  });

  it('returns StorageError when storage.put fails', async () => {
    const png = await makePngBytes(64, 64);
    rig.shim.enqueue({
      status: 200,
      body: png,
      headers: { 'content-type': 'image/png' },
    });
    rig.storageMock.on(PutObjectCommand).rejects(new Error('R2 down'));

    const result = await processImage({
      printing: { variantKey: 'x-y', setCanonicalKey: 'x' },
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/img.png`,
      http: rig.http,
      storage: rig.storage,
      dedup: rig.dedup,
      ladder: TINY_LADDER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(StorageError);
  });

  it('returns DedupError when dedup.findExisting throws', async () => {
    const png = await makePngBytes(64, 64);
    rig.shim.enqueue({
      status: 200,
      body: png,
      headers: { 'content-type': 'image/png' },
    });
    const broken = {
      findExisting: () => Promise.reject(new Error('db down')),
      upsert: rig.dedup.upsert.bind(rig.dedup),
    };
    const result = await processImage({
      printing: { variantKey: 'x-y', setCanonicalKey: 'x' },
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/img.png`,
      http: rig.http,
      storage: rig.storage,
      dedup: broken,
      ladder: TINY_LADDER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(DedupError);
  });

  // Regression test for Q-005: when `processImage` wraps a non-typed
  // upstream Error (e.g. the `RateLimitedClient` cross-host guard
  // throwing a plain `Error`), the resulting `FetchError` MUST
  // round-trip through `JSON.stringify` carrying the underlying
  // `name` + `message`. The seed-run reports drop the cause to `{}`
  // without this — making cross-host wiring bugs invisible.
  it('FetchError JSON serialization preserves Error cause name + message (Q-005)', () => {
    const inner = new Error(
      'RateLimitedClient: refusing cross-host call (expected api.tcgdex.net, got assets.tcgdex.net).',
    );
    const err = new FetchError('msg', {
      source: 'tcgdex-en',
      target: 'https://assets.tcgdex.net/en/swsh/swsh9/018/high.png',
      cause: inner,
    });
    const json = JSON.stringify(err);
    expect(json).toContain('"name":"FetchError"');
    expect(json).toContain('"kind":"fetch"');
    expect(json).toContain('"message":"msg"');
    expect(json).toContain('"source":"tcgdex-en"');
    expect(json).toContain('"target":"https://assets.tcgdex.net/en/swsh/swsh9/018/high.png"');
    expect(json).toContain('"cause":{"name":"Error","message":');
    expect(json).toContain('refusing cross-host call');
    expect(json).not.toContain('"cause":{}');

    const parsed = JSON.parse(json) as {
      name: string;
      kind: string;
      message: string;
      source: string;
      target: string;
      cause: { name: string; message: string };
      upstream: unknown;
    };
    expect(parsed.cause).toEqual({ name: 'Error', message: inner.message });
    expect(parsed.upstream).toBeUndefined();
  });

  it('FetchError JSON serialization includes `upstream` AdapterError when present', () => {
    const upstream = new TransientError('HTTP 503 from x', {
      source: 'x',
      target: 'https://x',
      statusCode: 503,
      attempt: 1,
    });
    const err = new FetchError('image-pipeline: upstream fetch failed (transient)', {
      source: 'tcgdex-en',
      target: 'https://assets.tcgdex.net/img.png',
      upstream,
      cause: upstream,
    });
    const parsed = JSON.parse(JSON.stringify(err)) as {
      cause: { name: string; message: string };
      upstream: { name: string; kind: string; message: string };
    };
    expect(parsed.cause).toEqual({ name: 'TransientError', message: 'HTTP 503 from x' });
    expect(parsed.upstream).toEqual({
      name: 'TransientError',
      kind: 'transient',
      message: 'HTTP 503 from x',
      source: 'x',
      target: 'https://x',
    });
  });

  it('returns DedupError when dedup.upsert throws', async () => {
    const png = await makePngBytes(64, 64);
    rig.shim.enqueue({
      status: 200,
      body: png,
      headers: { 'content-type': 'image/png' },
    });
    const broken = {
      findExisting: () => Promise.resolve(null),
      upsert: () => Promise.reject(new Error('insert failed')),
    };
    const result = await processImage({
      printing: { variantKey: 'x-y', setCanonicalKey: 'x' },
      source: 'tcgdex-en',
      sourceUrl: `https://${HOST}/img.png`,
      http: rig.http,
      storage: rig.storage,
      dedup: broken,
      ladder: TINY_LADDER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(DedupError);
  });
});
