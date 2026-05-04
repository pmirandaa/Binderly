// `printing_image` — sidecar provenance table for the image
// pipeline. Records the upstream source URL, raw-byte SHA-256, and
// the variant ladder produced by `data-pipeline/src/images` for
// each (printing, source) pair we re-host.
//
// Why a sidecar instead of more columns on `printing`:
//   - A printing can have images from multiple primary/validation
//     sources (TCGdex EN + PTCGIO emit different image URLs for the
//     same printing). The sidecar keeps every observation; the
//     `printing.image_small_url` / `image_large_url` columns
//     continue to hold the *chosen* canonical R2 URLs that the UI
//     reads (set by the seed-ingest job from the primary-tier
//     adapter's image).
//   - Widening `printing` would conflate "URL the UI uses" with
//     "audit trail" and double the table's column count.
//
// Notes for downstream readers:
//   - `(source, original_sha256)` is UNIQUE: the dedup contract.
//     Re-running the image pipeline on the same upstream bytes
//     upserts onto this key without writing new R2 objects.
//   - `license` is a CHECK-constrained enum
//     (`'TCGDEX' | 'PTCGIO' | 'POKEMON_CARD_JP'`). Bulbapedia is
//     intentionally absent — we do NOT persist Bulbapedia images
//     (CC-BY-NC-SA, see `context/legal-and-brand.md`); the pipeline
//     skips that source at the processor layer and the CHECK is
//     defence in depth.
//   - `variants` is jsonb, shape contractually owned by
//     `data-pipeline/src/images/dedup.ts` (the
//     `PrintingImageVariants` type): a record keyed by variant name
//     (`thumb` | `card` | `large` | `original`) carrying
//     `{ url, storage_key, sha256, byte_size, width, height }`.
//   - RLS posture mirrors the other catalog tables (public-read,
//     service-role-write); the policies + grants live in the
//     companion migration `0011_image_provenance_rls.sql` per the
//     conventions.md "RLS policy changes ship in their own
//     migration" rule.

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { printingTable } from './printings.js';

export const printingImageTable = pgTable(
  'printing_image',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    printingId: uuid('printing_id').references(() => printingTable.id, {
      onDelete: 'cascade',
    }),
    source: text('source').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceContentType: text('source_content_type'),
    originalSha256: text('original_sha256').notNull(),
    originalByteSize: integer('original_byte_size').notNull(),
    variants: jsonb('variants').notNull(),
    license: text('license').notNull(),
    transcodedAt: timestamp('transcoded_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('printing_image_source_original_sha256_unique').on(table.source, table.originalSha256),
    check(
      'printing_image_license_check',
      sql`${table.license} IN ('TCGDEX', 'PTCGIO', 'POKEMON_CARD_JP')`,
    ),
    // Hot path: "all images for this printing".
    index('printing_image_printing_id_idx').on(table.printingId),
    // Cross-source dedup audit: "where else have we seen these
    // exact bytes?". Cheap to maintain, useful when investigating
    // a takedown.
    index('printing_image_original_sha256_idx').on(table.originalSha256),
  ],
);

export type PrintingImage = typeof printingImageTable.$inferSelect;
export type NewPrintingImage = typeof printingImageTable.$inferInsert;
