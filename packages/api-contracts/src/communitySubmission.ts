// Community grading-flywheel submission DTOs (T-GR-COMMUNITY-FLYWHEEL,
// PROJECT.md § 12).
//
// The wire format for a pro user submitting the real graded outcome of one of
// their cards so it becomes labelled training data:
//
//   1. The mobile app collects the slab's grading cert (company + cert number +
//      the company's overall grade and sub-grades when printed) and links the
//      photos captured during the multi-shot capture flow.
//   2. It POSTs `submitCommunitySubmissionRequest` to
//      `POST /v1/me/community-submissions`. The endpoint is **pro-gated** (per
//      § 16, grading prediction — and contributing to it — is a Pro feature);
//      free users get an `ApiForbiddenError` (HTTP 403).
//   3. The row lands in `community_submission` (user-owned). The Python
//      flywheel ingestion job later normalises opted-in rows into
//      `grading_training_sample` (`source='community_flywheel'`).
//
// Idempotency: re-submitting the same `(gradeCompany, certNumber)` returns the
// existing row with `alreadySubmitted: true` (HTTP 200), so the client can show
// an "already submitted" state instead of erroring.
//
// Grading-company note: unlike `gradeCompanySchema` in `collection.ts`
// (PSA/BGS/CGC — the companies the collection UI surfaces), the flywheel also
// accepts **SGC**, matching the `community_submission` /
// `grading_training_sample` CHECK constraints in the DB schema.

import { z } from 'zod';

import { isoDateTimeSchema, uuidSchema } from './common.js';

// ============================================================
// Grading company — PSA / BGS / CGC / SGC
// ============================================================

/**
 * Companies the community flywheel accepts. Superset of
 * `collection.ts`'s `GRADE_COMPANIES` (which omits SGC) — pinned against the
 * `community_submission_grade_company_check` DB constraint.
 */
export const COMMUNITY_GRADE_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC'] as const;
export const communityGradeCompanySchema = z.enum(COMMUNITY_GRADE_COMPANIES);
export type CommunityGradeCompany = z.infer<typeof communityGradeCompanySchema>;

// ============================================================
// Grade + sub-grade primitives
// ============================================================

/**
 * A grade on the canonical 1.0–10.0 0.5-step grid. The server re-validates;
 * the client uses this so an off-grid value (8.3) is rejected before submit.
 */
export const communityGradeSchema = z
  .number()
  .min(1)
  .max(10)
  .refine((v) => Number.isInteger(v * 2), {
    message: 'grade must be on the 0.5 step grid (e.g. 9 or 9.5)',
  });

export const communitySubgradesSchema = z
  .object({
    centering: communityGradeSchema.optional(),
    corners: communityGradeSchema.optional(),
    edges: communityGradeSchema.optional(),
    surface: communityGradeSchema.optional(),
  })
  .strict();
export type CommunitySubgrades = z.infer<typeof communitySubgradesSchema>;

/**
 * Photo references. `front` + `back` are required (the centering + corners
 * models need both); the rest are optional. References only — image
 * download / R2 transcode is the separate #FU-39 pipeline.
 */
export const communitySubmissionImagesSchema = z
  .object({
    front: z.string().url(),
    back: z.string().url(),
    corners: z.array(z.string().url()).optional(),
    surface: z.string().url().optional(),
    slab: z.string().url().optional(),
  })
  .strict();
export type CommunitySubmissionImages = z.infer<typeof communitySubmissionImagesSchema>;

// ============================================================
// Status
// ============================================================

/**
 * Ingestion lifecycle (DB `community_submission.status`): `pending`
 * (submitted, not yet ingested), `ingested` (a `grading_training_sample` row
 * was written), `rejected` (server-side validation failed).
 */
export const COMMUNITY_SUBMISSION_STATUSES = ['pending', 'ingested', 'rejected'] as const;
export const communitySubmissionStatusSchema = z.enum(COMMUNITY_SUBMISSION_STATUSES);
export type CommunitySubmissionStatus = z.infer<typeof communitySubmissionStatusSchema>;

// ============================================================
// Request
// ============================================================

/**
 * Submit a graded outcome. `consent` MUST be `true` (the images + grades
 * become training data). At least one grade signal is required: an
 * `overallGrade`, a non-empty `subgrades`, or `blackLabel: true`.
 */
export const submitCommunitySubmissionRequest = z
  .object({
    gradeCompany: communityGradeCompanySchema,
    certNumber: z.string().min(1).max(64),
    overallGrade: communityGradeSchema.nullish(),
    subgrades: communitySubgradesSchema.nullish(),
    blackLabel: z.boolean().optional().default(false),
    rawGradeLabel: z.string().max(64).nullish(),
    images: communitySubmissionImagesSchema,
    gradingSubmissionId: uuidSchema.optional(),
    consent: z.literal(true),
  })
  .strict()
  .refine(
    (v) =>
      v.blackLabel === true ||
      (v.overallGrade !== null && v.overallGrade !== undefined) ||
      (v.subgrades !== null && v.subgrades !== undefined && Object.keys(v.subgrades).length > 0),
    {
      message: 'a grade is required: provide overallGrade, sub-grades, or blackLabel',
      path: ['overallGrade'],
    },
  );
export type SubmitCommunitySubmissionRequest = z.infer<typeof submitCommunitySubmissionRequest>;

// ============================================================
// Response
// ============================================================

/** Read-side wire shape for a `community_submission` row. */
export const communitySubmissionDto = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    gradingSubmissionId: uuidSchema.nullable(),
    gradeCompany: communityGradeCompanySchema,
    certNumber: z.string(),
    certNumberNormalized: z.string(),
    overallGrade: z.number().nullable(),
    subgrades: communitySubgradesSchema.nullable(),
    blackLabel: z.boolean(),
    rawGradeLabel: z.string().nullable(),
    images: communitySubmissionImagesSchema,
    consent: z.boolean(),
    status: communitySubmissionStatusSchema,
    ingestedSourceId: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type CommunitySubmissionDto = z.infer<typeof communitySubmissionDto>;

/**
 * Submit response. `alreadySubmitted` is `true` when the request matched an
 * existing `(user, company, cert)` row (idempotent re-submit) — the client
 * surfaces an "already submitted" state rather than a duplicate-success toast.
 */
export const submitCommunitySubmissionResponse = z
  .object({
    submission: communitySubmissionDto,
    alreadySubmitted: z.boolean(),
  })
  .strict();
export type SubmitCommunitySubmissionResponse = z.infer<typeof submitCommunitySubmissionResponse>;
