// Storage tests — exercise both the pure key shape and the
// `S3ImageStorage` wrapper against `aws-sdk-client-mock`.
//
// We do NOT hit a live MinIO in these tests (per the elaborated
// task spec). A separate, env-gated smoke test lives outside the
// vitest run for human-runnable end-to-end verification — see
// `infra/r2/README.md`.

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from '@aws-sdk/client-s3';
import { mockClient, type AwsClientStub } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { S3ImageStorage, imageKeyFor } from './storage.js';
import { StorageError } from './types.js';

describe('imageKeyFor', () => {
  it('builds the canonical printings/{set}/{variant_key}/{name}.webp key', () => {
    expect(
      imageKeyFor({
        setCanonicalKey: 'en-swsh9',
        variantKey: 'en-swsh9-018-holo',
        variant: 'large',
      }),
    ).toBe('printings/en-swsh9/en-swsh9-018-holo/large.webp');
  });

  it('builds keys for every variant name', () => {
    const variants = ['thumb', 'card', 'large', 'original'] as const;
    for (const v of variants) {
      const key = imageKeyFor({
        setCanonicalKey: 'jp-s9',
        variantKey: 'jp-s9-018-holo',
        variant: v,
      });
      expect(key.endsWith(`/${v}.webp`)).toBe(true);
    }
  });

  it('throws StorageError when set/variant keys are empty', () => {
    expect(() => imageKeyFor({ setCanonicalKey: '', variantKey: 'x', variant: 'thumb' })).toThrow(
      StorageError,
    );
    expect(() => imageKeyFor({ setCanonicalKey: 'x', variantKey: '', variant: 'thumb' })).toThrow(
      StorageError,
    );
  });
});

describe('S3ImageStorage (mocked client)', () => {
  let mock: AwsClientStub<S3Client>;
  let client: S3Client;
  let storage: S3ImageStorage;

  beforeEach(() => {
    client = new S3Client({});
    mock = mockClient(client);
    storage = new S3ImageStorage({
      bucket: 'images',
      publicUrlPrefix: 'http://localhost:9000/images',
      client,
    });
  });

  afterEach(() => {
    mock.reset();
  });

  it('issues a PutObjectCommand with the expected fields', async () => {
    mock.on(PutObjectCommand).resolves({});
    await storage.put({
      key: 'printings/en-swsh9/en-swsh9-018-holo/thumb.webp',
      body: Buffer.from('fake webp'),
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    const calls = mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.Bucket).toBe('images');
    expect(input.Key).toBe('printings/en-swsh9/en-swsh9-018-holo/thumb.webp');
    expect(input.ContentType).toBe('image/webp');
    expect(input.CacheControl).toBe('public, max-age=31536000, immutable');
    expect(input.ContentLength).toBe('fake webp'.length);
  });

  it('translates put failures into StorageError', async () => {
    mock.on(PutObjectCommand).rejects(new Error('bucket on fire'));
    await expect(
      storage.put({
        key: 'printings/x/y/thumb.webp',
        body: Buffer.from('z'),
        contentType: 'image/webp',
      }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it('returns exists=true with content-length on a HEAD success', async () => {
    mock.on(HeadObjectCommand).resolves({ ContentLength: 1234, ETag: '"abc"' });
    const head = await storage.head('printings/x/y/thumb.webp');
    expect(head.exists).toBe(true);
    expect(head.contentLength).toBe(1234);
    expect(head.etag).toBe('"abc"');
  });

  it('returns exists=false on a NotFound', async () => {
    const notFound = Object.assign(new Error('NotFound'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    }) as S3ServiceException;
    mock.on(HeadObjectCommand).rejects(notFound);
    const head = await storage.head('printings/x/y/thumb.webp');
    expect(head.exists).toBe(false);
  });

  it('translates non-NotFound HEAD failures into StorageError', async () => {
    mock.on(HeadObjectCommand).rejects(new Error('oof 500'));
    await expect(storage.head('printings/x/y/thumb.webp')).rejects.toBeInstanceOf(StorageError);
  });

  it('builds public URLs from the configured prefix', () => {
    expect(storage.urlFor('printings/en-swsh9/en-swsh9-018-holo/large.webp')).toBe(
      'http://localhost:9000/images/printings/en-swsh9/en-swsh9-018-holo/large.webp',
    );
  });

  it('rejects construction with an empty bucket or prefix', () => {
    expect(
      () =>
        new S3ImageStorage({
          bucket: '',
          publicUrlPrefix: 'http://localhost:9000/images',
          client,
        }),
    ).toThrow(StorageError);
    expect(() => new S3ImageStorage({ bucket: 'images', publicUrlPrefix: '', client })).toThrow(
      StorageError,
    );
  });
});
