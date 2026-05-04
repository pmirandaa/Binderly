// `ImageDedupResolver` — narrow contract over `printing_image`
// that lets the processor (a) check whether a given source/sha256
// pair has already been transcoded and (b) upsert a new provenance
// row when it has not.
//
// The interface is deliberately decoupled from `@binderly/db` so
// tests can substitute an in-memory map without spinning up Postgres.
// The seed-ingest job will instantiate `DrizzleDedupResolver`
// (lives in this file) with a Drizzle client to plug into the live
// catalog schema.
//
// Cross-package note: the Drizzle table type lives in
// `packages/db/src/schema/printing_image.ts`. To avoid pulling
// `@binderly/db` into the type surface here (would force every
// data-pipeline consumer to load drizzle) we declare a structural
// `PrintingImageRow` that mirrors the persisted columns. The
// alignment is enforced by the seed-ingest job's compile-time
// check, not here.

import { sha256OfBuffer } from './hash.js';
import {
  DedupError,
  type ImageLicense,
  ImageSource,
  ProcessedImageVariant,
  VariantName,
} from './types.js';

/**
 * Variant payload as persisted on `printing_image.variants`. One
 * entry per `VariantName`.
 */
export interface PrintingImageVariantRecord {
  readonly url: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export type PrintingImageVariants = Readonly<Record<VariantName, PrintingImageVariantRecord>>;

/**
 * Mirror of the `printing_image` row shape (snake_case columns
 * camelCased). The Drizzle insert/select types in
 * `packages/db/src/schema/printing_image.ts` are the source of
 * truth; this is the structural contract the data-pipeline
 * consumes without taking a hard dep on @binderly/db.
 */
export interface PrintingImageRow {
  readonly id: string;
  readonly printingId: string | null;
  readonly source: ImageSource;
  readonly sourceUrl: string;
  readonly sourceContentType: string | null;
  readonly originalSha256: string;
  readonly originalByteSize: number;
  readonly variants: PrintingImageVariants;
  readonly license: ImageLicense;
  readonly transcodedAt: Date;
}

/**
 * Look-up key for a dedup probe. `source` + `originalSha256` is
 * the table's UNIQUE constraint and our idempotency contract.
 */
export interface DedupLookup {
  readonly source: ImageSource;
  readonly originalSha256: string;
}

/**
 * Insert/update payload for a transcode result.
 */
export interface DedupUpsertInput {
  readonly source: ImageSource;
  readonly sourceUrl: string;
  readonly sourceContentType: string | null;
  readonly originalSha256: string;
  readonly originalByteSize: number;
  readonly variants: ReadonlyArray<ProcessedImageVariant>;
  readonly license: ImageLicense;
  /** Optional FK target. */
  readonly printingId?: string;
}

export interface ImageDedupResolver {
  findExisting(lookup: DedupLookup): Promise<PrintingImageRow | null>;
  upsert(input: DedupUpsertInput): Promise<PrintingImageRow>;
}

// ============================================================
// In-memory implementation (tests + ad-hoc backfills)
// ============================================================

/**
 * `InMemoryDedupResolver` — keyed off `(source, originalSha256)`.
 * Useful in tests and for the `--dry-run` mode of any future
 * ad-hoc backfill script.
 */
export class InMemoryDedupResolver implements ImageDedupResolver {
  private readonly rows = new Map<string, PrintingImageRow>();
  private idCounter = 0;

  size(): number {
    return this.rows.size;
  }

  clear(): void {
    this.rows.clear();
    this.idCounter = 0;
  }

  async findExisting(lookup: DedupLookup): Promise<PrintingImageRow | null> {
    return this.rows.get(this.keyOf(lookup)) ?? null;
  }

  async upsert(input: DedupUpsertInput): Promise<PrintingImageRow> {
    const key = this.keyOf({ source: input.source, originalSha256: input.originalSha256 });
    const existing = this.rows.get(key);
    const variants = variantsFromList(input.variants);
    const row: PrintingImageRow = {
      id: existing?.id ?? this.nextId(),
      printingId: input.printingId ?? existing?.printingId ?? null,
      source: input.source,
      sourceUrl: input.sourceUrl,
      sourceContentType: input.sourceContentType,
      originalSha256: input.originalSha256,
      originalByteSize: input.originalByteSize,
      variants,
      license: input.license,
      transcodedAt: existing?.transcodedAt ?? new Date(),
    };
    this.rows.set(key, row);
    return row;
  }

  private keyOf(lookup: DedupLookup): string {
    return `${lookup.source}::${lookup.originalSha256}`;
  }

  private nextId(): string {
    this.idCounter += 1;
    return `printing-image-${this.idCounter.toString(16).padStart(8, '0')}`;
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Project a `ProcessedImageVariant[]` into the `variants` jsonb
 * shape the DB persists. Throws via `DedupError` if a required
 * variant is missing — better to fail loudly here than write a
 * partial row.
 */
export function variantsFromList(
  list: ReadonlyArray<ProcessedImageVariant>,
): PrintingImageVariants {
  if (list.length === 0) {
    throw new DedupError('dedup: variants list is empty', { source: 'dedup' });
  }
  const out: Partial<Record<VariantName, PrintingImageVariantRecord>> = {};
  for (const v of list) {
    out[v.name] = {
      url: v.url,
      storageKey: v.storageKey,
      sha256: v.sha256,
      byteSize: v.byteSize,
      width: v.width,
      height: v.height,
    };
  }
  return out as PrintingImageVariants;
}

/**
 * Convenience: hash a buffer once and return the hex digest. The
 * processor calls this between fetch and dedup-lookup; exported
 * here so tests can pre-compute the same hash without re-importing
 * crypto.
 */
export function sha256Hex(buffer: Buffer): string {
  return sha256OfBuffer(buffer);
}
