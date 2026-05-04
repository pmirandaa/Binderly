// Public types for the image ingestion pipeline.
//
// Two surfaces live here:
//
//   1. The variant-ladder constants (`VARIANT_LADDER`, `VARIANT_NAMES`)
//      and their compile-time types. Locked at elaboration time —
//      see `tasks/01-data-layer/T-DL-IMAGE-PIPELINE.md` § "Variant
//      ladder".
//
//   2. The processor input / result shapes consumed by
//      `T-DL-SEED-INGEST` and the per-source license enum that
//      gates which adapters we persist images for (Bulbapedia is
//      explicitly excluded — see § "License posture per source").
//
// All consumer-facing types are exported from `data-pipeline/src/index.ts`
// via the new `./images/index.js` barrel.

import type { ImageDedupResolver, PrintingImageRow } from './dedup.js';
import type { ImageStorage } from './storage.js';
import type { RateLimitedClient } from '../http/rate-limited-client.js';
import type { AdapterError, AdapterLogger } from '../interfaces/adapter.js';

// ============================================================
// Variant ladder
// ============================================================

/**
 * The four WebP variants emitted per source image. Order matters
 * for `Object.entries(VARIANT_LADDER)` callers — keeping it
 * thumb→card→large→original makes test assertions and storage
 * paths predictable.
 */
export const VARIANT_NAMES = ['thumb', 'card', 'large', 'original'] as const;
export type VariantName = (typeof VARIANT_NAMES)[number];

export interface VariantSpec {
  /** Variant identifier; doubles as the storage filename stem. */
  readonly name: VariantName;
  /**
   * Maximum dimension on the long edge after resize. `null` means
   * "do not resize" (used by `original`, which preserves source
   * resolution).
   */
  readonly maxSide: number | null;
  /**
   * WebP quality (1–100). Ignored when `lossless: true`.
   */
  readonly quality: number;
  /**
   * Sharp encode effort (0–6). Higher = smaller files at more CPU.
   * 6 is the project default — see the elaborated task spec.
   */
  readonly effort: number;
  /** Lossless WebP. Used by `original`. */
  readonly lossless: boolean;
}

/**
 * The canonical variant ladder. Locked by the elaborated task
 * spec; tests can override via `processImage({ ladder: ... })`.
 */
export const VARIANT_LADDER: ReadonlyArray<VariantSpec> = [
  { name: 'thumb', maxSide: 256, quality: 70, effort: 6, lossless: false },
  { name: 'card', maxSide: 512, quality: 80, effort: 6, lossless: false },
  { name: 'large', maxSide: 1024, quality: 85, effort: 6, lossless: false },
  { name: 'original', maxSide: null, quality: 100, effort: 6, lossless: true },
];

// ============================================================
// Source / license enum
// ============================================================

/**
 * Image source identifiers. Match the `SourceAdapter.name` values
 * (see `data-pipeline/src/adapters/<source>/transform.ts`).
 *
 * `bulbapedia-en` is explicitly enumerated so the processor's
 * `skipped_excluded_source` guard is type-safe; we never persist
 * Bulbapedia images per `context/legal-and-brand.md`.
 */
export const IMAGE_SOURCES = [
  'tcgdex-en',
  'tcgdex-jp',
  'ptcgio',
  'pokemoncard-jp',
  'bulbapedia-en',
] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

/**
 * License tags persisted on `printing_image.license`. Bulbapedia
 * is intentionally absent — the DB CHECK constraint enumerates
 * exactly these three.
 */
export const IMAGE_LICENSES = ['TCGDEX', 'PTCGIO', 'POKEMON_CARD_JP'] as const;
export type ImageLicense = (typeof IMAGE_LICENSES)[number];

/**
 * Sources whose images we do NOT persist. The processor returns
 * `skipped_excluded_source` for these even when an adapter
 * accidentally provides a non-null `imageSourceUrl` (defence in
 * depth on top of the per-adapter exclusion in
 * `data-pipeline/src/adapters/bulbapedia/transform.ts`).
 */
export const EXCLUDED_IMAGE_SOURCES: ReadonlySet<ImageSource> = new Set<ImageSource>([
  'bulbapedia-en',
]);

/**
 * Source → license tag mapping. Exhaustive over the persisted
 * sources. `bulbapedia-en` has no entry by design — looking it up
 * is a programmer error and triggers `InvariantError`.
 */
export const SOURCE_LICENSE_MAP: Readonly<Partial<Record<ImageSource, ImageLicense>>> = {
  'tcgdex-en': 'TCGDEX',
  'tcgdex-jp': 'TCGDEX',
  ptcgio: 'PTCGIO',
  'pokemoncard-jp': 'POKEMON_CARD_JP',
};

// ============================================================
// Processor I/O
// ============================================================

export interface ProcessImagePrintingRef {
  /**
   * `printing.variant_key` — `{card.canonical_key}-{variant_code}`,
   * e.g. `en-swsh9-018-holo`. Drives the storage path's leaf
   * directory.
   */
  readonly variantKey: string;
  /**
   * `set.canonical_key` — `{language}-{code}`, e.g. `en-swsh9`.
   * Drives the storage path's first segment.
   */
  readonly setCanonicalKey: string;
  /**
   * Optional `printing.id`. Used as the FK target on the
   * `printing_image` row. Optional because the seed-ingest job may
   * call `processImage` before the printing has been upserted; the
   * dedup resolver layer is responsible for resolving variantKey →
   * id at write time when this is omitted.
   */
  readonly printingId?: string;
}

export interface ProcessImageInput {
  readonly printing: ProcessImagePrintingRef;
  readonly source: ImageSource;
  /**
   * `RawPrinting.imageSourceUrl`. `null` is a valid input — the
   * processor returns `skipped_no_url` rather than raising.
   */
  readonly sourceUrl: string | null;
  /**
   * Pre-built rate-limited client pinned to the source's image
   * host. The processor never constructs its own client (per
   * `rules/01-data-layer.md`).
   */
  readonly http: RateLimitedClient;
  readonly storage: ImageStorage;
  readonly dedup: ImageDedupResolver;
  readonly logger?: AdapterLogger;
  /** Variant ladder override; defaults to `VARIANT_LADDER`. */
  readonly ladder?: ReadonlyArray<VariantSpec>;
}

/**
 * One transcoded variant's metadata. Persisted into
 * `printing_image.variants` as a jsonb sub-object keyed by name.
 */
export interface ProcessedImageVariant {
  readonly name: VariantName;
  readonly url: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly contentType: 'image/webp';
}

export type ProcessedImageStatus =
  | 'transcoded'
  | 'cached'
  | 'skipped_no_url'
  | 'skipped_excluded_source';

export type ProcessedImageResult =
  | {
      readonly ok: true;
      readonly status: ProcessedImageStatus;
      readonly provenance: PrintingImageRow | null;
      readonly variants: ReadonlyArray<ProcessedImageVariant>;
    }
  | {
      readonly ok: false;
      readonly error: ImagePipelineError;
    };

// ============================================================
// Errors — discriminated union
// ============================================================

export type ImagePipelineErrorKind = 'fetch' | 'transcode' | 'storage' | 'dedup' | 'invariant';

export interface ImagePipelineErrorContext {
  /** Source name or storage backend identifier that raised. */
  readonly source: string;
  /** Best-effort URL or storage key the operation targeted. */
  readonly target?: string;
  readonly cause?: unknown;
}

/**
 * Base class. Carries the `kind` discriminator so consumers can
 * narrow without `instanceof` chains.
 *
 * `toJSON` is overridden so this error round-trips through
 * `JSON.stringify` without dropping `name` / `message` / `cause`.
 * `Error`'s built-in fields are non-enumerable, so the default
 * serializer would emit `{}` and the seed-run reports would lose
 * the underlying failure (Q-005, 2026-05-04 SEED-INGEST smoke).
 */
export abstract class ImagePipelineError extends Error {
  abstract readonly kind: ImagePipelineErrorKind;
  readonly source: string;
  readonly target: string | undefined;
  override readonly cause: unknown;

  constructor(message: string, ctx: ImagePipelineErrorContext) {
    super(message);
    this.name = new.target.name;
    this.source = ctx.source;
    this.target = ctx.target;
    this.cause = ctx.cause;
  }

  toJSON(): {
    name: string;
    kind: ImagePipelineErrorKind;
    message: string;
    source: string;
    target: string | undefined;
    cause: { name: string; message: string } | string | undefined;
  } {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      source: this.source,
      target: this.target,
      cause: serializeErrorCause(this.cause),
    };
  }
}

/**
 * Coerce an `Error.cause` (or `AdapterErrorContext.cause`) into a
 * shape that survives `JSON.stringify`. Plain `Error` instances
 * have non-enumerable `name` / `message` / `stack`, so the default
 * serializer drops them; string / number / object causes pass
 * through untouched (the latter only stringified via
 * `String(...)` for safety).
 */
export function serializeErrorCause(
  cause: unknown,
): { name: string; message: string } | string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message };
  }
  if (typeof cause === 'string') return cause;
  if (cause === null) return 'null';
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/**
 * Fetch from upstream failed. Wraps the underlying `AdapterError`
 * (preserves `rate_limit` / `not_found` / `transient` /
 * `permanent` discrimination) so callers can decide retry policy.
 */
export class FetchError extends ImagePipelineError {
  override readonly kind = 'fetch' as const;
  readonly upstream: AdapterError | undefined;

  constructor(message: string, ctx: ImagePipelineErrorContext & { upstream?: AdapterError }) {
    super(message, ctx);
    this.upstream = ctx.upstream;
  }

  override toJSON(): ReturnType<ImagePipelineError['toJSON']> & {
    upstream:
      | { name: string; kind: string; message: string; source: string; target: string | undefined }
      | undefined;
  } {
    const base = super.toJSON();
    const upstream = this.upstream;
    return {
      ...base,
      upstream:
        upstream === undefined
          ? undefined
          : {
              name: upstream.name,
              kind: upstream.kind,
              message: upstream.message,
              source: upstream.source,
              target: upstream.target,
            },
    };
  }
}

export class TranscodeError extends ImagePipelineError {
  override readonly kind = 'transcode' as const;
}

export class StorageError extends ImagePipelineError {
  override readonly kind = 'storage' as const;
}

export class DedupError extends ImagePipelineError {
  override readonly kind = 'dedup' as const;
}

/**
 * Programmer error — e.g. licence map missing for a persisted
 * source, ladder override violates invariants. Should never fire
 * at runtime in well-formed callers.
 */
export class InvariantError extends ImagePipelineError {
  override readonly kind = 'invariant' as const;
}

export function isImagePipelineError(value: unknown): value is ImagePipelineError {
  return value instanceof ImagePipelineError;
}
