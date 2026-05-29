// `community_submission` — the user-owned raw row for the community
// grading flywheel (T-GR-COMMUNITY-FLYWHEEL, PROJECT.md § 12).
//
// A pro user submits the real graded outcome of one of their cards: the
// slab's grading company + cert number + the company's overall grade (and
// sub-grades when the slab prints them), linked to the photos they captured
// during the multi-shot capture flow. This is the first-party analogue of the
// stage-07 scrapers (PSA/eBay/auction): instead of scraping, users contribute
// their own labelled data.
//
// Two-table split (mirrors the `grading_submission` / `grading_training_sample`
// posture established in `grading.ts`):
//
//   1. `community_submission` (THIS table) — user-owned, owner-CRUD RLS. The
//      raw thing the user submitted. Holds PII-adjacent provenance (`user_id`,
//      the photo refs) and an explicit `consent` flag.
//   2. `grading_training_sample` (existing, service-role-only) — the training
//      corpus. The Python flywheel ingestion job
//      (`apps/api-python/grading/flywheel/`) reads opted-in `community_submission`
//      rows with the service-role key, normalises them, and upserts rows with
//      `source='community_flywheel'` (that literal is already in the
//      `grading_training_sample` CHECK constraint — no change needed there).
//
// Keeping the user-owned table separate from the corpus means the training
// pipeline never reads user-owned rows through an end-user session; the
// service-role job is the only reader that crosses the boundary, and only for
// rows where `consent = true`.
//
// Idempotency: `UNIQUE(user_id, grade_company, cert_number_normalized)`. A user
// re-submitting the same slab updates their existing row rather than creating a
// duplicate. The cross-user / cross-source dedup happens at the corpus layer
// via `grading_training_sample(source, source_id)` where
// `source_id = 'COMPANY:cert'`.
//
// Cross-schema FK pattern (per T-DL-SCHEMA-USERS / grading.ts precedent):
// `user_id` is a plain `uuid('user_id').notNull()` here; the FK + ON DELETE
// CASCADE into Supabase's managed `auth.users` is emitted in the hand-authored
// RLS migration that pairs with this file.

import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { gradingSubmissionTable } from './grading.js';

export const communitySubmissionTable = pgTable(
  'community_submission',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // 1:N with `auth.users(id)`. FK + ON DELETE CASCADE emitted in the
    // companion RLS migration (cross-schema FK; drizzle-kit can't author it).
    userId: uuid('user_id').notNull(),
    // Optional link to the multi-shot capture session that produced the
    // photos. Nullable because a user can submit a graded card straight from
    // their collection without a fresh capture session. ON DELETE SET NULL
    // keeps the submission alive if the capture row is later deleted.
    gradingSubmissionId: uuid('grading_submission_id').references(
      () => gradingSubmissionTable.id,
      { onDelete: 'set null' },
    ),
    // PSA / BGS / CGC / SGC — pinned via CHECK so a typo surfaces at write time.
    gradeCompany: text('grade_company').notNull(),
    // Raw cert number exactly as the user entered it (provenance / display).
    certNumber: text('cert_number').notNull(),
    // Canonical, normalised cert (uppercased, label-stripped, separators
    // removed) — the idempotency key the unique constraint keys on.
    certNumberNormalized: text('cert_number_normalized').notNull(),
    // The company's overall grade (1.0–10.0, 0.5 grid). Nullable for
    // non-numeric outcomes (e.g. PSA "Authentic") or BGS Black Label (where
    // the perfect grade is implied by `black_label`).
    overallGrade: numeric('overall_grade', { precision: 3, scale: 1 }),
    // {centering?, corners?, edges?, surface?} — same shape as
    // `grading_training_sample.subgrades` so the ingestion job copies it across
    // without reshaping.
    subgrades: jsonb('subgrades'),
    // BGS Black Label marker (perfect 10/10/10/10). Normalisation expands this
    // to a full sub-grade set during ingestion.
    blackLabel: boolean('black_label').notNull().default(false),
    // Original grade string as printed on the slab ("PSA 10", "BGS 9.5", …).
    rawGradeLabel: text('raw_grade_label'),
    // {front?, back?, corners?: text[], surface?, slab?} — URL references to
    // the user's captured photos + (optionally) the slab photo. References
    // only; image download / R2 transcode is the separate #FU-39 pipeline.
    images: jsonb('images')
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Explicit opt-in: the images + grades become training data only when the
    // user consents. The ingestion job reads only `consent = true` rows.
    consent: boolean('consent').notNull().default(false),
    // Ingestion lifecycle: `pending` (submitted, not yet ingested),
    // `ingested` (a grading_training_sample row was written), `rejected`
    // (validation failed server-side). Pinned via CHECK.
    status: text('status').notNull().default('pending'),
    // Traceability back to the corpus row this submission produced
    // (`grading_training_sample.source_id`, i.e. 'COMPANY:cert'). Null until
    // ingested.
    ingestedSourceId: text('ingested_source_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Per-user idempotency: a user re-submitting the same slab upserts.
    unique('community_submission_user_company_cert_unique').on(
      table.userId,
      table.gradeCompany,
      table.certNumberNormalized,
    ),
    check(
      'community_submission_grade_company_check',
      sql`${table.gradeCompany} IN ('PSA', 'BGS', 'CGC', 'SGC')`,
    ),
    check(
      'community_submission_status_check',
      sql`${table.status} IN ('pending', 'ingested', 'rejected')`,
    ),
    // Hot path: "show me my submissions" on the mobile collection / settings.
    index('community_submission_user_id_created_at_idx').on(
      table.userId,
      table.createdAt.desc(),
    ),
    // Ingestion job sweep: "give me opted-in pending rows".
    index('community_submission_status_idx').on(table.status),
  ],
);

export type CommunitySubmission = typeof communitySubmissionTable.$inferSelect;
export type NewCommunitySubmission = typeof communitySubmissionTable.$inferInsert;
