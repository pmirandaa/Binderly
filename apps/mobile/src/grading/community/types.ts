// Public types for the community grading-flywheel submission flow.
//
// A pro user submits the real graded outcome of one of their cards so it
// becomes labelled training data (PROJECT.md § 12). The flow reuses the photos
// captured during the multi-shot capture session and collects the slab's
// grading cert (company + cert number + the company's overall grade and
// sub-grades when printed).

import type { SubmitCommunitySubmissionResponse } from '@binderly/api-contracts';

/** Companies the flywheel accepts — superset of the collection UI (adds SGC). */
export type CommunityGradeCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC';

export const COMMUNITY_GRADE_COMPANIES: readonly CommunityGradeCompany[] = [
  'PSA',
  'BGS',
  'CGC',
  'SGC',
];

/** The four sub-grade slots a slab may print. */
export type SubgradeKey = 'centering' | 'corners' | 'edges' | 'surface';

export const SUBGRADE_KEYS: readonly SubgradeKey[] = [
  'centering',
  'corners',
  'edges',
  'surface',
];

/**
 * URL references to the photos backing a submission. `front` + `back` are
 * required by the models; the rest are optional. References only — the actual
 * upload / R2 transcode is the separate #FU-39 pipeline. In practice these come
 * from the capture session the user already completed.
 */
export interface CommunitySubmissionImages {
  readonly front?: string;
  readonly back?: string;
  readonly corners?: readonly string[];
  readonly surface?: string;
  readonly slab?: string;
}

/**
 * Raw form state. Numeric grades are held as **strings** (the text inputs'
 * native value) and parsed at validation time so a half-typed "9." doesn't
 * thrash the parsed number.
 */
export interface CommunitySubmissionForm {
  readonly gradeCompany: CommunityGradeCompany;
  readonly certNumber: string;
  readonly overallGrade: string;
  readonly subgrades: Readonly<Record<SubgradeKey, string>>;
  readonly blackLabel: boolean;
  readonly consent: boolean;
}

/** A fresh, empty form (PSA default — the most common company). */
export function emptyCommunityForm(): CommunitySubmissionForm {
  return {
    gradeCompany: 'PSA',
    certNumber: '',
    overallGrade: '',
    subgrades: { centering: '', corners: '', edges: '', surface: '' },
    blackLabel: false,
    consent: false,
  };
}

/**
 * Submission status machine (the five states the brief requires):
 *   - `idle` — form is editable, no in-flight request.
 *   - `submitting` — request in flight.
 *   - `success` — the row was created.
 *   - `already_submitted` — the server matched an existing cert (idempotent).
 *   - `error` — the request failed; `message` is user-facing.
 */
export type SubmissionState =
  | { readonly status: 'idle' }
  | { readonly status: 'submitting' }
  | { readonly status: 'success'; readonly response: SubmitCommunitySubmissionResponse }
  | { readonly status: 'already_submitted'; readonly response: SubmitCommunitySubmissionResponse }
  | { readonly status: 'error'; readonly message: string };
