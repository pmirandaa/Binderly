// Grading-submission DTOs (PROJECT.md § 12).
//
// The wire format for the multi-shot capture flow:
//
//   1. The mobile app captures front + back + four corner crops +
//      a raking-light surface shot, uploads each to R2, and posts
//      the URLs back via `submitGradingPredictionRequest`.
//   2. The grading worker (apps/api-python/grading/) computes the
//      four subgrades + aggregate + confidence and the row lands
//      in `grading_submission` with `status: 'predicted'`.
//   3. Later, the user can mark the card as `'submitted_for_grading'`
//      and (eventually) attach the actual grade from a real PSA /
//      BGS / CGC slab via `attachActualGradeRequest`. Rows where
//      `actual` is filled and `profile.preferences.grading_flywheel_opt_in`
//      is true become eligible for the training corpus (PROJECT.md
//      § 12 "community submission flywheel").
//
// The DB column `grading_submission.predicted` is `jsonb` per
// `packages/db/src/schema/grading.ts`'s comment ("shape is owned by
// the grading worker"). We pin the typed shape here because every
// consumer (mobile capture flow, web detail page, training-flywheel
// dashboard) needs a stable contract for it.
//
// The `grading_training_sample` table is admin-only (service-role)
// per the schema's RLS comment, so it is intentionally NOT exposed
// here as a DTO. If an admin web UI eventually surfaces it, that
// task will own the dedicated DTO.

import { z } from 'zod';

import { gradeCompanySchema } from './collection.js';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// ============================================================
// Subgrade payload — owned by the grading worker
// ============================================================

/**
 * BGS-style subgrade. 0.0..10.0 in 0.5 increments per BGS
 * conventions; we relax to "any value in [0, 10] with up to one
 * fractional digit" because the worker may emit interpolated
 * 0.1-step values during calibration. Server-side validation
 * additionally clamps to the canonical 0.5-step grid.
 */
export const subgradeSchema = z.number().min(0).max(10);
export type Subgrade = z.infer<typeof subgradeSchema>;

/**
 * Predicted-score payload. Pinned at the contracts layer so the
 * UI can render the four subgrades + aggregate + confidence band
 * without consulting the worker repository.
 */
export const predictedScoresSchema = z
  .object({
    centering: subgradeSchema,
    corners: subgradeSchema,
    edges: subgradeSchema,
    surface: subgradeSchema,
    aggregate: subgradeSchema,
    /**
     * 0..1 model confidence. The UI surfaces a band like "PSA
     * 8.5-9 candidate, ~72% confidence" per PROJECT.md § 12.
     */
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type PredictedScores = z.infer<typeof predictedScoresSchema>;

/**
 * Actual-grade payload — populated when the user uploads their
 * real graded slab. Optional `subgrades` for BGS/CGC where the
 * cert provides them; PSA only emits an aggregate.
 */
export const actualGradeSchema = z
  .object({
    company: gradeCompanySchema,
    /**
     * Whole or half grade as it appears on the slab. e.g. PSA
     * 9, BGS 9.5, CGC Pristine 10 (`grade: 10`).
     */
    grade: z.number().min(1).max(10),
    subgrades: z
      .object({
        centering: subgradeSchema.optional(),
        corners: subgradeSchema.optional(),
        edges: subgradeSchema.optional(),
        surface: subgradeSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * R2 URL for the slab photo. Optional — some users prefer
     * not to share the slab photo even when reporting the grade.
     */
    slabUrl: z.string().url().optional(),
  })
  .strict();
export type ActualGrade = z.infer<typeof actualGradeSchema>;

// ============================================================
// grading_submission — read DTO
// ============================================================

/**
 * Lifecycle marker. `'predicted'` (initial), `'submitted_for_grading'`
 * (user has shipped the card to PSA/BGS/CGC), `'graded'` (user
 * uploaded the actual slab + grade). Pinned in the DB via
 * CHECK and surfaced verbatim here.
 */
export const GRADING_SUBMISSION_STATUSES = [
  'predicted',
  'submitted_for_grading',
  'graded',
] as const;
export const gradingSubmissionStatusSchema = z.enum(GRADING_SUBMISSION_STATUSES);
export type GradingSubmissionStatus = z.infer<typeof gradingSubmissionStatusSchema>;

/**
 * Read-side wire shape for a `grading_submission` row.
 *
 * - `printingId` is nullable — the multi-shot capture flow can
 *   run before the user has confirmed which printing the card
 *   is.
 * - `cornerUrls` is exactly 4 entries (DB CHECK enforces this).
 * - `predicted` is the typed `predictedScoresSchema` shape; we
 *   pin it here because the consumer renders all four
 *   subgrades regardless of grading-worker version.
 * - `actual` is `null` until the user attaches the real slab
 *   grade.
 */
export const gradingSubmissionDto = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    printingId: uuidSchema.nullable(),
    frontUrl: z.string().url(),
    backUrl: z.string().url(),
    cornerUrls: z.array(z.string().url()).length(4),
    surfaceUrl: z.string().url(),
    predicted: predictedScoresSchema,
    actual: actualGradeSchema.nullable(),
    status: gradingSubmissionStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type GradingSubmissionDto = z.infer<typeof gradingSubmissionDto>;

// ============================================================
// Write DTOs
// ============================================================

/**
 * Submit a fresh grading prediction. The mobile client uploads
 * the six images to R2 first (presigned URL flow lives in
 * T-BE-EDGE-FUNCTIONS), then posts the URLs here. The Edge
 * Function calls the grading worker, persists the row, and
 * returns the resulting `gradingSubmissionDto`.
 *
 * `printingId` is optional — the user may not have confirmed
 * which printing yet (the post-prediction step "is this the
 * card?" runs after the prediction lands).
 */
export const submitGradingPredictionRequest = z
  .object({
    printingId: uuidSchema.optional(),
    frontUrl: z.string().url(),
    backUrl: z.string().url(),
    cornerUrls: z.array(z.string().url()).length(4),
    surfaceUrl: z.string().url(),
  })
  .strict();
export type SubmitGradingPredictionRequest = z.infer<typeof submitGradingPredictionRequest>;

/**
 * Attach the actual graded outcome to an existing submission.
 * Flips `status` to `'graded'` server-side and (if the user has
 * `grading_flywheel_opt_in: true`) makes the row eligible for
 * the training corpus.
 */
export const attachActualGradeRequest = z
  .object({
    actual: actualGradeSchema,
  })
  .strict();
export type AttachActualGradeRequest = z.infer<typeof attachActualGradeRequest>;

/**
 * Flip `status` between the lifecycle states without attaching
 * an actual grade (e.g. user has shipped to PSA but the slab
 * hasn't returned yet — `'predicted'` → `'submitted_for_grading'`).
 * `'graded'` is reachable only via `attachActualGradeRequest`
 * because it requires the actual payload.
 */
export const updateGradingSubmissionStatusRequest = z
  .object({
    status: z.enum(['predicted', 'submitted_for_grading']),
  })
  .strict();
export type UpdateGradingSubmissionStatusRequest = z.infer<
  typeof updateGradingSubmissionStatusRequest
>;
