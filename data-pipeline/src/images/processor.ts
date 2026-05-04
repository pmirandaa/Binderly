// `processImage` — top-level orchestrator. Composes:
//
//   fetch (RateLimitedClient) → SHA-256 → dedup probe →
//   transcode (sharp) → upload (S3ImageStorage) → upsert
//   (ImageDedupResolver).
//
// The function is the public surface T-DL-SEED-INGEST will call
// once per resolved canonical printing. It returns a discriminated
// union (`{ ok: true, status, ... } | { ok: false, error }`) so
// callers never have to wrap it in a try/catch — every operational
// failure mode is a typed error in the result.
//
// The two "skipped" statuses are the legal posture in code:
//
//   - `skipped_no_url`: adapter didn't emit an upstream URL.
//     Bulbapedia is the canonical case (its adapter sets
//     `imageSourceUrl: null`); other adapters can return null when
//     the upstream simply doesn't have an image for that printing.
//
//   - `skipped_excluded_source`: defence-in-depth on top of the
//     adapter-level skip. If a future code path *did* somehow
//     pass a non-null URL with `source: 'bulbapedia-en'`, the
//     processor refuses to fetch.

import { sha256OfBuffer } from './hash.js';
import { imageKeyFor } from './storage.js';
import { transcode } from './transcoder.js';
import {
  DedupError,
  EXCLUDED_IMAGE_SOURCES,
  FetchError,
  InvariantError,
  SOURCE_LICENSE_MAP,
  StorageError,
  TranscodeError,
  type ImageLicense,
  type ImageSource,
  type ProcessImageInput,
  type ProcessedImageResult,
  type ProcessedImageVariant,
  type VariantName,
} from './types.js';
import { AdapterError, type AdapterLogger } from '../interfaces/adapter.js';

import type { RateLimitedClient } from '../http/rate-limited-client.js';

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/**
 * Long-lived public surface. See module-level docstring for the
 * pipeline composition.
 */
export async function processImage(input: ProcessImageInput): Promise<ProcessedImageResult> {
  const logger = input.logger ?? NOOP_LOGGER;
  const { source, sourceUrl } = input;

  // ----- guard: excluded source ------------------------------
  if (EXCLUDED_IMAGE_SOURCES.has(source)) {
    logger.info?.(
      { source, target: input.printing.variantKey },
      'image-pipeline.skipped_excluded_source',
    );
    return {
      ok: true,
      status: 'skipped_excluded_source',
      provenance: null,
      variants: [],
    };
  }

  // ----- guard: no upstream URL -------------------------------
  if (sourceUrl == null || sourceUrl.length === 0) {
    logger.info?.({ source, target: input.printing.variantKey }, 'image-pipeline.skipped_no_url');
    return {
      ok: true,
      status: 'skipped_no_url',
      provenance: null,
      variants: [],
    };
  }

  // ----- license lookup (defensive) ---------------------------
  const license = SOURCE_LICENSE_MAP[source];
  if (!license) {
    return {
      ok: false,
      error: new InvariantError(`image-pipeline: no license tag registered for source ${source}`, {
        source: 'processor',
        target: input.printing.variantKey,
      }),
    };
  }

  // ----- fetch ------------------------------------------------
  let fetched: FetchOutcome;
  try {
    fetched = await fetchSource(sourceUrl, input.http);
  } catch (err) {
    if (err instanceof AdapterError) {
      return {
        ok: false,
        error: new FetchError(`image-pipeline: upstream fetch failed (${err.kind})`, {
          source,
          target: sourceUrl,
          upstream: err,
          cause: err,
        }),
      };
    }
    return {
      ok: false,
      error: new FetchError('image-pipeline: upstream fetch failed', {
        source,
        target: sourceUrl,
        cause: err,
      }),
    };
  }

  // ----- hash + dedup probe -----------------------------------
  const originalSha256 = sha256OfBuffer(fetched.body);
  let cachedRow;
  try {
    cachedRow = await input.dedup.findExisting({ source, originalSha256 });
  } catch (err) {
    return {
      ok: false,
      error: wrapDedupError('image-pipeline: dedup lookup failed', source, err),
    };
  }
  if (cachedRow) {
    logger.info?.(
      {
        source,
        target: input.printing.variantKey,
        original_sha256: originalSha256,
      },
      'image-pipeline.cached',
    );
    return {
      ok: true,
      status: 'cached',
      provenance: cachedRow,
      variants: variantsFromCachedRow(cachedRow),
    };
  }

  // ----- transcode --------------------------------------------
  let transcoded;
  try {
    transcoded = await transcode(fetched.body, input.ladder ? { ladder: input.ladder } : {});
  } catch (err) {
    if (err instanceof TranscodeError) {
      return { ok: false, error: err };
    }
    return {
      ok: false,
      error: new TranscodeError('image-pipeline: transcode failed', {
        source,
        cause: err,
      }),
    };
  }

  // ----- upload + collect variant metadata -------------------
  const variants: ProcessedImageVariant[] = [];
  for (const tv of transcoded) {
    const key = imageKeyFor({
      setCanonicalKey: input.printing.setCanonicalKey,
      variantKey: input.printing.variantKey,
      variant: tv.name,
    });
    try {
      await input.storage.put({
        key,
        body: tv.buffer,
        contentType: tv.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      });
    } catch (err) {
      if (err instanceof StorageError) {
        return { ok: false, error: err };
      }
      return {
        ok: false,
        error: new StorageError(`image-pipeline: storage put failed for ${key}`, {
          source,
          target: key,
          cause: err,
        }),
      };
    }
    variants.push({
      name: tv.name,
      url: input.storage.urlFor(key),
      storageKey: key,
      sha256: sha256OfBuffer(tv.buffer),
      byteSize: tv.buffer.length,
      width: tv.width,
      height: tv.height,
      contentType: tv.contentType,
    });
  }

  // ----- upsert provenance -----------------------------------
  let provenance;
  try {
    const upsertInput: Parameters<typeof input.dedup.upsert>[0] = {
      source,
      sourceUrl,
      sourceContentType: fetched.contentType,
      originalSha256,
      originalByteSize: fetched.body.length,
      variants,
      license,
    };
    if (input.printing.printingId !== undefined) {
      Object.assign(upsertInput, { printingId: input.printing.printingId });
    }
    provenance = await input.dedup.upsert(upsertInput);
  } catch (err) {
    return {
      ok: false,
      error: wrapDedupError('image-pipeline: dedup upsert failed', source, err),
    };
  }

  logger.info?.(
    {
      source,
      target: input.printing.variantKey,
      original_sha256: originalSha256,
      variants: variants.map((v) => v.name),
    },
    'image-pipeline.transcoded',
  );

  return {
    ok: true,
    status: 'transcoded',
    provenance,
    variants,
  };
}

// ============================================================
// Internals
// ============================================================

interface FetchOutcome {
  readonly body: Buffer;
  readonly contentType: string | null;
}

async function fetchSource(url: string, http: RateLimitedClient): Promise<FetchOutcome> {
  const res = await http.request(url);
  // Most R2/S3-style fetches return a `body` ReadableStream;
  // ArrayBuffer is the simplest universal way to get the bytes
  // without reaching for streams (the ladder transcodes from a
  // Buffer regardless, so we materialize once).
  const arrayBuffer = await res.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  const contentType = res.headers.get('content-type');
  return { body, contentType };
}

function variantsFromCachedRow(row: {
  variants: Readonly<
    Record<
      string,
      {
        url: string;
        storageKey: string;
        sha256: string;
        byteSize: number;
        width: number;
        height: number;
      }
    >
  >;
}): ProcessedImageVariant[] {
  const out: ProcessedImageVariant[] = [];
  for (const [name, v] of Object.entries(row.variants)) {
    out.push({
      name: name as VariantName,
      url: v.url,
      storageKey: v.storageKey,
      sha256: v.sha256,
      byteSize: v.byteSize,
      width: v.width,
      height: v.height,
      contentType: 'image/webp',
    });
  }
  return out;
}

function wrapDedupError(message: string, source: ImageSource, err: unknown): DedupError {
  return new DedupError(message, { source, cause: err });
}

// `ImageLicense` is referenced by tests for completeness; re-export
// so processor consumers can reach it without a second import.
export type { ImageLicense };
