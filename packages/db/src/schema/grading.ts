// Drizzle schemas for the grading product surface (PROJECT.md § 12).
//
// Two tables ship in this single file:
//
// 1. `grading_submission` — the user-facing row. One per multi-shot
//    capture session: front + back + four corner crops + the
//    raking-light surface shot, plus the predicted four-subgrade payload
//    and an optional `actual` payload that's filled in when the user
//    later uploads their actual graded slab. Mirrors
//    `context/data-model.md` § "User tables → grading_submission"
//    column-for-column.
//
// 2. `grading_training_sample` — the service-role-only training corpus.
//    Populated by the stage-07 ingestion tasks (T-GR-DATA-PSA,
//    T-GR-DATA-EBAY, T-GR-DATA-AUCTIONS) and, post-launch, by a
//    flywheel job that copies eligible `grading_submission` rows in.
//    No `user_id` (samples are not user-owned), variable image shape
//    (PROJECT.md § 12: "many listings only have one shot — those are
//    usable for centering and partial corner training but not full
//    grading"), and provenance fields (`source`, `source_id`,
//    `source_url`) used for dedupe + kill-switch / takedown response
//    per `context/legal-and-brand.md`.
//
// The split is intentional. Keeping the user-owned table user-owned
// (with strict owner-CRUD RLS) and the training corpus separate
// (service-role-only) means the training pipeline never reads user
// PII directly — it reads from the corpus, which only contains
// flywheel rows users have explicitly opted into via
// `profile.preferences.grading_flywheel_opt_in`.
//
// Cross-schema FK pattern (per T-DL-SCHEMA-USERS' precedent):
// `user_id` is declared as a plain `uuid('user_id').notNull()` here.
// drizzle-kit can't author FKs into Supabase's managed `auth.users`,
// so the FK + ON DELETE CASCADE constraint is emitted in the
// hand-authored RLS migration that pairs with this file.

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { printingTable } from './printings.js';

export const gradingSubmissionTable = pgTable(
  'grading_submission',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // 1:N with `auth.users(id)`. The FK + ON DELETE CASCADE constraint
    // is emitted in the companion RLS migration (cross-schema FK;
    // drizzle-kit can't author it from this file).
    userId: uuid('user_id').notNull(),
    // Nullable per spec — the multi-shot capture flow can run before
    // the user has confirmed which printing the card is. ON DELETE
    // SET NULL keeps the submission alive if a catalog row is
    // reorganized (catalog rows are essentially never deleted in
    // practice, but the safer default preserves the user's grading
    // history regardless).
    printingId: uuid('printing_id').references(() => printingTable.id, { onDelete: 'set null' }),
    frontUrl: text('front_url').notNull(),
    backUrl: text('back_url').notNull(),
    // Exactly four corner crops per the multi-shot capture UX
    // (PROJECT.md § 12). The length-4 invariant is enforced via a
    // CHECK constraint declared below; the column type is `text[]`
    // so the four entries stay ordered and queryable as an array.
    cornerUrls: text('corner_urls').array().notNull(),
    surfaceUrl: text('surface_url').notNull(),
    // {centering, corners, edges, surface, aggregate, confidence}
    // — the AI-emitted score column. Shape is owned by the grading
    // worker in `apps/api-python/grading/`; jsonb so the contract can
    // evolve without schema migrations.
    predicted: jsonb('predicted').notNull(),
    // {company, grade, subgrades?, slab_url?} — populated when the
    // user later uploads their actual graded slab. Nullable until
    // then. The presence of this payload is what makes the row
    // eligible for the community-flywheel training corpus (gated
    // additionally by `profile.preferences.grading_flywheel_opt_in`).
    actual: jsonb('actual'),
    // Lifecycle marker: `predicted` (initial), `submitted_for_grading`
    // (user has shipped the card to PSA/BGS/CGC), `graded` (user
    // uploaded the actual slab + grade). Pinned via CHECK below.
    status: text('status').notNull().default('predicted'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      'grading_submission_status_check',
      sql`${table.status} IN ('predicted', 'submitted_for_grading', 'graded')`,
    ),
    // The capture flow is fixed at four corner crops; an array of any
    // other length means the row was authored by something that
    // doesn't follow the multi-shot UX contract and should be
    // rejected at write time rather than discovered at read time.
    check(
      'grading_submission_corner_urls_length_check',
      sql`array_length(${table.cornerUrls}, 1) = 4`,
    ),
    // Hot path: "show me my recent grading attempts" on the mobile
    // collection home screen.
    index('grading_submission_user_id_created_at_idx').on(table.userId, table.createdAt.desc()),
    // Hot path: "show me grading attempts for this printing" on the
    // card detail page (renders historical predictions next to the
    // user's own attempts).
    index('grading_submission_printing_id_idx').on(table.printingId),
  ],
);

export type GradingSubmission = typeof gradingSubmissionTable.$inferSelect;
export type NewGradingSubmission = typeof gradingSubmissionTable.$inferInsert;

export const gradingTrainingSampleTable = pgTable(
  'grading_training_sample',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // PROJECT.md § 12 names three external ingestion pipelines (PSA
    // cert lookup, eBay sold listings, auction archives — PWCC,
    // Goldin) plus the community submission flywheel. The CHECK
    // constraint pins the enum so a typo in a stage-07 scraper
    // surfaces immediately at write time.
    source: text('source').notNull(),
    // PSA cert number, eBay item id, auction lot id, or the
    // originating `grading_submission.id` for flywheel rows. Combined
    // with `source` it forms the dedup key for idempotent ingestion
    // (same upstream record re-scraped tomorrow → upsert, not
    // duplicate).
    sourceId: text('source_id').notNull(),
    // Provenance fallback. Required by `context/legal-and-brand.md`
    // for a kill-switch / takedown response: if a complaint arrives
    // we need to know exactly where each sample came from. Never
    // surfaced to clients — `grading_training_sample` is service-role
    // only.
    sourceUrl: text('source_url'),
    // Nullable: not every scraped sample matches a known printing.
    // The stage-07 ingestion pipelines may match opportunistically
    // (cert page → set + number → printing) but cleanly leave it
    // null when matching fails rather than corrupting the catalog
    // join. ON DELETE SET NULL preserves the sample if a printing
    // row gets reorganized.
    printingId: uuid('printing_id').references(() => printingTable.id, {
      onDelete: 'set null',
    }),
    gradeCompany: text('grade_company').notNull(),
    // Overall grade. Nullable because partial-quality samples may
    // carry only subgrade hints (e.g. eBay listing photo good for
    // centering but not for an aggregate label).
    grade: numeric('grade', { precision: 3, scale: 1 }),
    // {centering?, corners?, edges?, surface?} — same shape as
    // `grading_submission.predicted` so downstream training code
    // shares one parser.
    subgrades: jsonb('subgrades'),
    // {front?, back?, corners?: text[], surface?, raw_photos?: text[]}
    // — variable shape per PROJECT.md § 12 ("many listings only have
    // one shot"). jsonb keeps the schema permissive while still
    // grouping the URLs logically.
    images: jsonb('images')
      .notNull()
      .default(sql`'{}'::jsonb`),
    // 0..1 parser confidence. Mirrors the price_observation
    // convention: aggregates / training jobs filter to ≥0.7 by
    // default. Nullable because some sources (e.g. PSA cert pages)
    // are confidence-free by definition (the data is authoritative).
    parseConfidence: numeric('parse_confidence', { precision: 3, scale: 2 }),
    // Parser breadcrumbs — scraped title, source HTML excerpt, etc.
    // Debug-only surface for the stage-07 ingestion tasks.
    rawMetadata: jsonb('raw_metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
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
    // Idempotent ingestion: same `(source, source_id)` upserts.
    unique('grading_training_sample_source_source_id_unique').on(table.source, table.sourceId),
    check(
      'grading_training_sample_source_check',
      sql`${table.source} IN ('psa_cert', 'ebay_sold', 'auction_pwcc', 'auction_goldin', 'community_flywheel')`,
    ),
    check(
      'grading_training_sample_grade_company_check',
      sql`${table.gradeCompany} IN ('PSA', 'BGS', 'CGC', 'SGC', 'OTHER')`,
    ),
    // Catalog join: "how many training samples do we have per
    // printing?" — used by the training pipeline to balance the
    // dataset across printings.
    index('grading_training_sample_printing_id_idx').on(table.printingId),
    // Tier-balanced dataset queries: "give me 1k samples per
    // (PSA, 9.0)" etc.
    index('grading_training_sample_grade_company_grade_idx').on(table.gradeCompany, table.grade),
  ],
);

export type GradingTrainingSample = typeof gradingTrainingSampleTable.$inferSelect;
export type NewGradingTrainingSample = typeof gradingTrainingSampleTable.$inferInsert;

// ============================================================
// T-GR-DATA-EBAY — eBay sold-listing observations for graded slabs
// ============================================================
//
// Populated by `apps/api-python/grading/scrapers/ebay/`. Two downstream
// consumers:
//   1. Graded-card pricing intelligence (sold price → "PSA 10 sold for $X").
//   2. Training corpus — a downstream job copies rows into
//      `grading_training_sample` (source = 'ebay_sold').
//
// Service-role-only. No RLS (anon/authenticated revoked in migration).
// Dedup key: `UNIQUE(listing_id)`.
// Re-parse: bump `parser_version` in Python and sweep old rows using the
//   `ebay_graded_listing_observation_parser_version_idx` index; `raw_blob_json`
//   preserves the original eBay payload so re-parsing is a pure DB update.

export const ebayGradedListingObservationTable = pgTable(
  'ebay_graded_listing_observation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listingId: text('listing_id').notNull(),
    title: text('title').notNull(),
    // Grading company parsed from the listing title (PSA/BGS/CGC/SGC/OTHER).
    // CHECK constraint pinned to the same enum used by grading_training_sample.
    parsedGradingCompany: text('parsed_grading_company'),
    // Overall grade 1.0–10.0. NULL = parse failed or Authentic slab.
    parsedOverallGrade: numeric('parsed_overall_grade', { precision: 3, scale: 1 }),
    // BGS sub-grades only: {centering, corners, edges, surface}.
    parsedSubGrades: jsonb('parsed_sub_grades'),
    // Price in the smallest currency unit (cents for USD/GBP/EUR; yen for JPY).
    finalPriceCents: integer('final_price_cents').notNull(),
    // ISO 4217 currency code as returned by eBay.
    currencyCode: text('currency_code').notNull(),
    // Listing end time (when the sale closed).
    soldAt: timestamp('sold_at', { withTimezone: true }),
    // Nullable FK → printing catalog. Backfilled by follow-up #FU-38.
    printingId: uuid('printing_id').references(() => printingTable.id, {
      onDelete: 'set null',
    }),
    // eBay hosted thumbnail URL. NOT proxied/downloaded by this task.
    thumbnailUrl: text('thumbnail_url'),
    // Full eBay Finding API item dict — preserved for re-parsing.
    rawBlobJson: jsonb('raw_blob_json').notNull(),
    // Parser version (semver string). Increment when regex evolves.
    parserVersion: text('parser_version').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('ebay_graded_listing_observation_listing_id_unique').on(table.listingId),
    check(
      'ebay_graded_listing_observation_company_check',
      sql`${table.parsedGradingCompany} IS NULL OR ${table.parsedGradingCompany} IN ('PSA', 'BGS', 'CGC', 'SGC', 'OTHER')`,
    ),
    // Hot path: pricing queries for a given printing + grade company.
    index('ebay_graded_listing_observation_printing_company_grade_idx').on(
      table.printingId,
      table.parsedGradingCompany,
      table.parsedOverallGrade,
    ),
    // Hot path: recent sold data.
    index('ebay_graded_listing_observation_sold_at_idx').on(table.soldAt),
    // Re-parse sweep.
    index('ebay_graded_listing_observation_parser_version_idx').on(table.parserVersion),
  ],
);

export type EbayGradedListingObservation = typeof ebayGradedListingObservationTable.$inferSelect;
export type NewEbayGradedListingObservation =
  typeof ebayGradedListingObservationTable.$inferInsert;
