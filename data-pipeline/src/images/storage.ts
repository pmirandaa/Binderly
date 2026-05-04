// `ImageStorage` — narrow R2/S3 contract used by the image
// pipeline. The interface is intentionally small (`put`, `head`,
// `urlFor`, `keyFor`) so tests can substitute a hand-rolled
// in-memory implementation without spinning up MinIO.
//
// `S3ImageStorage` is the production wrapper over
// `@aws-sdk/client-s3`. The same surface works against:
//
//   - Cloudflare R2 (production) — endpoint
//     `https://{account}.r2.cloudflarestorage.com`
//   - MinIO (local dev) — endpoint `http://localhost:9000`
//   - aws-sdk-client-mock (unit tests)
//
// The S3 SDK is a real dependency, declared in
// `data-pipeline/package.json`. It is the canonical client surface
// for R2; the `aws4fetch` alternative was considered and rejected
// in the elaborated task spec for lack of mocking ergonomics.

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

import { StorageError } from './types.js';

import type { VariantName } from './types.js';

// ============================================================
// Key shape
// ============================================================

/**
 * Canonical R2 key shape:
 *
 *   printings/{set_canonical_key}/{variant_key}/{variant}.webp
 *
 * Pure helper — no I/O. Exported so callers can pre-compute the
 * key without instantiating a storage client.
 */
export function imageKeyFor(input: {
  setCanonicalKey: string;
  variantKey: string;
  variant: VariantName;
}): string {
  if (!input.setCanonicalKey) {
    throw new StorageError('storage: setCanonicalKey is required for key derivation', {
      source: 'storage',
    });
  }
  if (!input.variantKey) {
    throw new StorageError('storage: variantKey is required for key derivation', {
      source: 'storage',
    });
  }
  return `printings/${input.setCanonicalKey}/${input.variantKey}/${input.variant}.webp`;
}

// ============================================================
// Interface
// ============================================================

export interface PutOptions {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  /** Optional cache-control header for CDN consumers. */
  readonly cacheControl?: string;
}

export interface HeadResult {
  readonly exists: boolean;
  readonly contentLength?: number;
  readonly etag?: string;
}

export interface ImageStorage {
  /** Upload `body` to `key`. Overwrite-on-write semantics. */
  put(opts: PutOptions): Promise<void>;
  /** Cheap existence + metadata probe; returns `exists: false` on a 404. */
  head(key: string): Promise<HeadResult>;
  /**
   * Return the externally-visible URL for `key`. The seed-ingest
   * job persists this on `printing.image_*_url`, so it must be
   * stable across calls and survive in shared catalog metadata.
   */
  urlFor(key: string): string;
}

// ============================================================
// S3 / R2 implementation
// ============================================================

export interface S3ImageStorageConfig {
  readonly bucket: string;
  /**
   * Public-facing URL prefix used in `urlFor` (without trailing
   * slash). For local MinIO this is typically
   * `http://localhost:9000/images`; for prod R2 it's the public
   * bucket URL.
   */
  readonly publicUrlPrefix: string;
  /**
   * Pre-built S3 client. Tests pass `aws-sdk-client-mock`'s mock
   * client; production callers pass a real `S3Client` aimed at R2
   * or MinIO.
   */
  readonly client: S3Client;
}

export class S3ImageStorage implements ImageStorage {
  private readonly bucket: string;
  private readonly publicUrlPrefix: string;
  private readonly client: S3Client;

  constructor(config: S3ImageStorageConfig) {
    if (!config.bucket) {
      throw new StorageError('S3ImageStorage: bucket is required', { source: 'S3ImageStorage' });
    }
    if (!config.publicUrlPrefix) {
      throw new StorageError('S3ImageStorage: publicUrlPrefix is required', {
        source: 'S3ImageStorage',
      });
    }
    this.bucket = config.bucket;
    this.publicUrlPrefix = config.publicUrlPrefix.replace(/\/$/, '');
    this.client = config.client;
  }

  async put(opts: PutOptions): Promise<void> {
    try {
      const cmdInput: PutObjectCommandInput = {
        Bucket: this.bucket,
        Key: opts.key,
        Body: opts.body,
        ContentType: opts.contentType,
        ContentLength: opts.body.length,
      };
      if (opts.cacheControl !== undefined) {
        cmdInput.CacheControl = opts.cacheControl;
      }
      await this.client.send(new PutObjectCommand(cmdInput));
    } catch (err) {
      throw new StorageError(`S3ImageStorage: PUT failed for ${opts.key}`, {
        source: 'S3ImageStorage',
        target: opts.key,
        cause: err,
      });
    }
  }

  async head(key: string): Promise<HeadResult> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const out: HeadResult = { exists: true };
      if (typeof res.ContentLength === 'number') {
        Object.assign(out, { contentLength: res.ContentLength });
      }
      if (typeof res.ETag === 'string') {
        Object.assign(out, { etag: res.ETag });
      }
      return out;
    } catch (err) {
      if (isNotFoundError(err)) {
        return { exists: false };
      }
      throw new StorageError(`S3ImageStorage: HEAD failed for ${key}`, {
        source: 'S3ImageStorage',
        target: key,
        cause: err,
      });
    }
  }

  urlFor(key: string): string {
    return `${this.publicUrlPrefix}/${key}`;
  }
}

interface PutObjectCommandInput {
  Bucket: string;
  Key: string;
  Body: Buffer;
  ContentType: string;
  ContentLength?: number;
  CacheControl?: string;
}

/**
 * AWS SDK v3 raises a `NotFound` exception with `name === 'NotFound'`
 * (and `$metadata.httpStatusCode === 404`) for a missing object.
 * The check tolerates both shapes plus a generic 404.
 */
function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e['name'] === 'NotFound' || e['name'] === 'NoSuchKey') return true;
  const meta = e['$metadata'];
  if (typeof meta === 'object' && meta !== null) {
    const code = (meta as Record<string, unknown>)['httpStatusCode'];
    if (code === 404) return true;
  }
  return false;
}

// ============================================================
// Factory helpers
// ============================================================

/**
 * Build an `S3Client` aimed at the local MinIO emulator. Mirrors
 * the bucket bootstrap in `infra/docker-compose.yml` (`images`,
 * root creds `minio` / `miniominio`).
 *
 * Production callers should construct their own `S3Client` against
 * the R2 endpoint and pass it directly to `S3ImageStorage`.
 */
export function createLocalMinioClient(overrides: Partial<S3ClientConfig> = {}): S3Client {
  const endpoint = process.env['S3_ENDPOINT_URL'] ?? 'http://localhost:9000';
  const accessKeyId = process.env['MINIO_ROOT_USER'] ?? 'minio';
  const secretAccessKey = process.env['MINIO_ROOT_PASSWORD'] ?? 'miniominio';
  return new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    ...overrides,
  });
}
