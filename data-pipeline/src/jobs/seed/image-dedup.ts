// `DrizzleImageDedupResolver` — production `ImageDedupResolver`
// implementation against the `printing_image` table.
//
// The image pipeline (`data-pipeline/src/images/processor.ts`) calls
// `findExisting({source, originalSha256})` BEFORE any transcode work.
// On a hit, the processor returns `status: 'cached'` and never
// re-uploads — that is the entire idempotency contract for images.
//
// `upsert` lands a new provenance row when the bytes are new.
// `(source, original_sha256)` is the UNIQUE constraint enforcing
// dedup; the writer issues `INSERT … ON CONFLICT (source,
// original_sha256) DO UPDATE` so a concurrent racer doesn't double
// the row.

import { and, eq, sql } from 'drizzle-orm';

import { printingImageTable, type DbClient } from '@binderly/db';

import {
  variantsFromList,
  type DedupLookup,
  type DedupUpsertInput,
  type ImageDedupResolver,
  type PrintingImageRow,
} from '../../images/dedup.js';

import type { ImageLicense, ImageSource } from '../../images/types.js';

export class DrizzleImageDedupResolver implements ImageDedupResolver {
  constructor(private readonly db: DbClient) {}

  async findExisting(lookup: DedupLookup): Promise<PrintingImageRow | null> {
    const rows = await this.db
      .select()
      .from(printingImageTable)
      .where(
        and(
          eq(printingImageTable.source, lookup.source),
          eq(printingImageTable.originalSha256, lookup.originalSha256),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return rowToProvenance(row);
  }

  async upsert(input: DedupUpsertInput): Promise<PrintingImageRow> {
    const variants = variantsFromList(input.variants);
    const insertValues = {
      printingId: input.printingId ?? null,
      source: input.source,
      sourceUrl: input.sourceUrl,
      sourceContentType: input.sourceContentType,
      originalSha256: input.originalSha256,
      originalByteSize: input.originalByteSize,
      variants,
      license: input.license,
    };
    const rows = await this.db
      .insert(printingImageTable)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [printingImageTable.source, printingImageTable.originalSha256],
        set: {
          printingId: input.printingId ?? null,
          sourceUrl: input.sourceUrl,
          sourceContentType: input.sourceContentType,
          originalByteSize: input.originalByteSize,
          variants,
          license: input.license,
          transcodedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error(
        `image-dedup: insert into printing_image returned no rows for (${input.source}, ${input.originalSha256})`,
      );
    }
    return rowToProvenance(row);
  }
}

// ============================================================
// Internals
// ============================================================

function rowToProvenance(row: typeof printingImageTable.$inferSelect): PrintingImageRow {
  return {
    id: row.id,
    printingId: row.printingId ?? null,
    source: row.source as ImageSource,
    sourceUrl: row.sourceUrl,
    sourceContentType: row.sourceContentType ?? null,
    originalSha256: row.originalSha256,
    originalByteSize: row.originalByteSize,
    variants: row.variants as PrintingImageRow['variants'],
    license: row.license as ImageLicense,
    transcodedAt: row.transcodedAt instanceof Date ? row.transcodedAt : new Date(row.transcodedAt),
  };
}
