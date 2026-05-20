// Drizzle schema for `auction_lot_observation` — realised auction outcomes
// for graded Pokémon slabs from PWCC Marketplace and Goldin Auctions.
//
// Populated by T-GR-DATA-AUCTIONS. Each row is one closed lot from an
// auction archive. The unique key is `(auction_house, lot_id)` so
// re-scraping the same lot is an idempotent upsert (SHA-256 content hash
// detects whether the title/price was updated post-close).
//
// Dual write-path:
//   1. This table — full pricing + provenance record.
//   2. `grading_training_sample` — image + grade tuple for ML training;
//      source = `auction_pwcc` | `auction_goldin` (CHECK already in
//      grading.ts).
//
// RLS posture: service-role only (no user-owned data; no client reads).
// A companion RLS migration should REVOKE public / authenticated access.

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { printingTable } from './printings.js';

export const auctionLotObservationTable = pgTable(
  'auction_lot_observation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    // Auction-house-scoped lot identifier.  Combined with `auction_house`
    // this is the dedup key for idempotent re-scraping.
    lotId: text('lot_id').notNull(),

    // `pwcc` | `goldin`; pinned by CHECK below.
    auctionHouse: text('auction_house').notNull(),

    // Parent auction session (PWCC: numeric auction number; Goldin: slug).
    auctionId: text('auction_id'),

    // Human-readable auction title, e.g. "PWCC Marketplace Premium Auction".
    auctionName: text('auction_name'),

    // Raw lot title as scraped — preserved verbatim for provenance / kill-switch.
    lotTitle: text('lot_title').notNull(),

    // Parsed from title by grade_parser.py.  `unknown` when the title doesn't
    // contain a recognisable grading company prefix.
    parsedGradingCompany: text('parsed_grading_company'),

    // Parsed overall grade, e.g. 10.0, 9.5, 8.0.  Nullable when the title
    // carries a company name but no numeric grade (e.g. "PSA Authentic").
    parsedOverallGrade: numeric('parsed_overall_grade', { precision: 3, scale: 1 }),

    // Parsed sub-grades (rare; BGS Black Label 10/10/10/10 etc.).
    // Shape: { centering?: number, corners?: number, edges?: number, surface?: number }
    parsedSubGrades: jsonb('parsed_sub_grades'),

    // Hammer price in smallest currency unit (cents / pence).
    realisedPriceCents: bigint('realised_price_cents', { mode: 'number' }),

    // ISO 4217 currency code, e.g. "USD", "GBP".
    currencyCode: text('currency_code'),

    // Buyer's premium in smallest currency unit.  Nullable — not always shown.
    realisedPremiumCents: bigint('realised_premium_cents', { mode: 'number' }),

    // Auction close timestamp from the lot page.  Nullable — some archives
    // show only the date, not the exact time; caller sets timezone to UTC.
    closedAt: timestamp('closed_at', { withTimezone: true }),

    // FK into `printing` — filled by a separate fuzzy-match pass (T-GR-DATA-AUCTIONS #FU-39).
    // ON DELETE SET NULL: preserves the observation if a catalog row is reorganised.
    printingId: uuid('printing_id').references(() => printingTable.id, {
      onDelete: 'set null',
    }),

    // Ordered list of image URLs from the lot page (auction lots typically have
    // multiple angles: front, back, slab case).
    lotImageUrls: text('lot_image_urls').array().notNull().default(sql`'{}'::text[]`),

    // SHA-256 hex digest of the raw lot-page HTML at fetch time.  Used for
    // change-detection on re-runs: if the digest matches the stored value the
    // upsert is effectively a no-op (no column changes).
    rawHtmlSha256: text('raw_html_sha256'),

    // Semver string of the parser that produced this row, e.g. "1.0.0".
    // Downstream training pipelines can filter to a minimum parser version.
    parserVersion: text('parser_version').notNull(),

    // Fetch timestamp — when the lot page was retrieved.
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
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
    // Idempotent upsert key.
    unique('auction_lot_observation_house_lot_unique').on(table.auctionHouse, table.lotId),

    check(
      'auction_lot_observation_auction_house_check',
      sql`${table.auctionHouse} IN ('pwcc', 'goldin')`,
    ),

    // Training corpus join: "how many auction samples do we have per printing?"
    index('auction_lot_observation_printing_id_idx').on(table.printingId),

    // Pricing queries: "what did PSA 10 Charizard Base 1st-ed lots fetch?"
    index('auction_lot_observation_house_grade_idx').on(
      table.auctionHouse,
      table.parsedGradingCompany,
      table.parsedOverallGrade,
    ),

    // Recency queries: "show me the last 100 lots from Goldin".
    index('auction_lot_observation_closed_at_idx').on(table.closedAt.desc()),
  ],
);

export type AuctionLotObservation = typeof auctionLotObservationTable.$inferSelect;
export type NewAuctionLotObservation = typeof auctionLotObservationTable.$inferInsert;
