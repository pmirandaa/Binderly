// Handler for `POST /v1/me/community-submissions` (#FU-55).
//
// The pro-gated write path for the community grading flywheel
// (T-GR-COMMUNITY-FLYWHEEL, PROJECT.md § 12). A pro user submits the
// real graded outcome of one of their cards — the slab's grading
// company + cert number + the company's overall grade / sub-grades,
// linked to the photos captured during the multi-shot capture flow — so
// it becomes labelled training data. The Python flywheel ingestion job
// later normalises opted-in rows into `grading_training_sample`.
//
// The contract (`submitCommunitySubmissionRequest` /
// `submitCommunitySubmissionResponse`) and the api-client surface
// (`client.communitySubmissions.submitCommunitySubmission`) were pinned
// ahead of this handler when the table (migration 0025) + RLS (0026) +
// mobile UI + ingestion shipped; this file is the missing HTTP handler.
//
// ── Posture ──────────────────────────────────────────────────────────
//   1. Auth — `requireUser()` (anonymous → 401).
//   2. Pro entitlement — `resolveEntitlements()` (the same fail-closed
//      RC read the `/me/entitlements` endpoint uses; mirror of
//      `@binderly/entitlements`). Free tier — and the fail-closed
//      fallback when RC is unreachable — get a 403 (`ApiForbiddenError`
//      on the client). Per § 16, contributing to grading prediction is
//      a Pro feature.
//   3. Validate — the mirrored `submitCommunitySubmissionRequest`.
//   4. Insert — user-scoped client, `user_id` from the session so RLS's
//      `auth.uid() = user_id` WITH CHECK passes. Idempotent on
//      `(user_id, grade_company, cert_number_normalized)`: a duplicate
//      INSERT (unique-violation 23505) re-reads the existing row and
//      returns it with `alreadySubmitted: true`.

import { submitCommunitySubmissionRequest } from '../contracts.ts';
import { ApiError, apiOk } from '../errors.ts';
import { parseJsonBody } from '../validate.ts';
import { requireUser, translatePostgrestError, type AuthenticatedSession } from '../db.ts';
import { resolveEntitlements } from './entitlements.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

const COMMUNITY_SUBMISSION_TABLE = 'community_submission';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

/**
 * Snake-cased DB row shape — what `.from('community_submission')
 * .select('*')` returns.
 */
interface CommunitySubmissionRow {
  readonly id: string;
  readonly user_id: string;
  readonly grading_submission_id: string | null;
  readonly grade_company: string;
  readonly cert_number: string;
  readonly cert_number_normalized: string;
  // numeric(3,1) → PostgREST serialises as a string.
  readonly overall_grade: string | number | null;
  readonly subgrades: Record<string, number> | null;
  readonly black_label: boolean;
  readonly raw_grade_label: string | null;
  readonly images: Record<string, unknown>;
  readonly consent: boolean;
  readonly status: string;
  readonly ingested_source_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Wire DTO mirroring `communitySubmissionDto` in api-contracts. */
interface CommunitySubmissionWire {
  id: string;
  userId: string;
  gradingSubmissionId: string | null;
  gradeCompany: string;
  certNumber: string;
  certNumberNormalized: string;
  overallGrade: number | null;
  subgrades: Record<string, number> | null;
  blackLabel: boolean;
  rawGradeLabel: string | null;
  images: Record<string, unknown>;
  consent: boolean;
  status: string;
  ingestedSourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToWire(row: CommunitySubmissionRow): CommunitySubmissionWire {
  return {
    id: row.id,
    userId: row.user_id,
    gradingSubmissionId: row.grading_submission_id,
    gradeCompany: row.grade_company,
    certNumber: row.cert_number,
    certNumberNormalized: row.cert_number_normalized,
    overallGrade: toNumberOrNull(row.overall_grade),
    subgrades: row.subgrades,
    blackLabel: row.black_label,
    rawGradeLabel: row.raw_grade_label,
    images: row.images,
    consent: row.consent,
    status: row.status,
    ingestedSourceId: row.ingested_source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Canonical, normalised cert: uppercase, strip every non-alphanumeric
 * separator (spaces, hyphens, slashes). This is the idempotency key the
 * `UNIQUE(user_id, grade_company, cert_number_normalized)` constraint
 * keys on, so "PSA 1234-5678" and "psa12345678" dedupe to one row.
 */
export function normalizeCertNumber(certNumber: string): string {
  return certNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function handleSubmitCommunitySubmission(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  // 1. Auth — fail closed for anonymous callers (standard 401).
  const session = await requireUser(request, ctx.env, ctx.deps);

  // 2. Pro gate — fail-closed RC read (free / RC-down → 403). Mirrors
  //    the entitlements endpoint so the gate is identical to what the
  //    client up-front check reads.
  const entitlements = await resolveEntitlements(session.user.id, ctx);
  if (entitlements.tier !== 'pro') {
    throw new ApiError(
      'AUTH',
      'Submitting to the community grading flywheel is a Pro feature.',
      { status: 403 },
    );
  }

  // 3. Validate the body against the mirrored contract.
  const payload = await parseJsonBody(request, submitCommunitySubmissionRequest);

  // 4. Insert. `user_id` from the session so RLS's WITH CHECK passes.
  const insertRow = {
    user_id: session.user.id,
    grade_company: payload.gradeCompany,
    cert_number: payload.certNumber,
    cert_number_normalized: normalizeCertNumber(payload.certNumber),
    overall_grade:
      payload.overallGrade === null || payload.overallGrade === undefined
        ? null
        : payload.overallGrade.toFixed(1),
    subgrades: payload.subgrades ?? null,
    black_label: payload.blackLabel,
    raw_grade_label: payload.rawGradeLabel ?? null,
    images: payload.images,
    consent: payload.consent,
    ...(payload.gradingSubmissionId !== undefined
      ? { grading_submission_id: payload.gradingSubmissionId }
      : {}),
  };

  const { data: inserted, error: insertError } = await session.supabase
    .from(COMMUNITY_SUBMISSION_TABLE)
    .insert(insertRow)
    .select('*')
    .single();

  if (insertError === null && inserted !== null) {
    return apiOk(
      request,
      ctx.cors,
      ctx.requestId,
      { submission: rowToWire(inserted as CommunitySubmissionRow), alreadySubmitted: false },
      { status: 201 },
    );
  }

  // Idempotent re-submit: the unique constraint fired. Re-read the
  // existing row (RLS scopes it to the caller) and return it.
  if (insertError !== null && insertError.code === '23505') {
    const existing = await readExisting(session, insertRow.grade_company, insertRow.cert_number_normalized);
    return apiOk(
      request,
      ctx.cors,
      ctx.requestId,
      { submission: rowToWire(existing), alreadySubmitted: true },
      { status: 200 },
    );
  }

  if (insertError !== null) {
    throw translatePostgrestError(insertError);
  }
  throw new ApiError('INTERNAL', 'Insert returned no data and no error.');
}

async function readExisting(
  session: AuthenticatedSession,
  gradeCompany: string,
  certNumberNormalized: string,
): Promise<CommunitySubmissionRow> {
  const { data, error } = await session.supabase
    .from(COMMUNITY_SUBMISSION_TABLE)
    .select('*')
    .eq('user_id', session.user.id)
    .eq('grade_company', gradeCompany)
    .eq('cert_number_normalized', certNumberNormalized)
    .maybeSingle();
  if (error !== null) {
    throw translatePostgrestError(error);
  }
  if (data === null) {
    // Race: the conflicting row vanished between INSERT and re-read.
    throw new ApiError(
      'CONFLICT',
      'Conflict resolved between insert and re-fetch; retry the request.',
    );
  }
  return data as CommunitySubmissionRow;
}

function toNumberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
