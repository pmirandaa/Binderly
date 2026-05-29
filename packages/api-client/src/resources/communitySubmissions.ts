// Community submissions resource — `POST /v1/me/community-submissions`.
//
// The pro-gated write path for the community grading flywheel
// (T-GR-COMMUNITY-FLYWHEEL, PROJECT.md § 12). A pro user submits the real
// graded outcome of one of their cards (slab cert + the captured photos) so it
// becomes labelled training data.
//
// Per § 16, grading prediction — and contributing to it — is a Pro feature, so
// the Edge Function behind this endpoint enforces the freemium gate: free users
// get an `ApiForbiddenError` (HTTP 403). The mobile client additionally gates
// the *entry point* up-front via `@binderly/entitlements` so free users see an
// upgrade prompt rather than discovering the 403 after filling the form.
//
// The endpoint is idempotent on `(gradeCompany, certNumber)`: a re-submit
// returns the existing row with `alreadySubmitted: true`.
//
// NOTE: the matching Edge Function handler shipped in #FU-55
// (`infra/supabase/functions/_shared/handlers/communitySubmissions.ts`,
// route `POST /me/community-submissions`). The contract + client surface here
// were pinned ahead of it, exactly as the `grading` resource preceded its
// handler; this resource is also exercised against the mocked-fetch test
// harness, and the mobile screen consumes it through an injected
// `BinderlyClient`.

import {
  submitCommunitySubmissionRequest,
  submitCommunitySubmissionResponse,
  type SubmitCommunitySubmissionRequest,
  type SubmitCommunitySubmissionResponse,
} from '@binderly/api-contracts';

import { validateRequest } from './_validate.js';

import type { HttpClient } from '../client.js';

export interface CommunitySubmissionsResource {
  /**
   * Submit a graded outcome to the community flywheel. Pro-gated
   * server-side (free → `ApiForbiddenError`). Returns the persisted row
   * plus `alreadySubmitted` (true on an idempotent re-submit of the same
   * `(gradeCompany, certNumber)`).
   */
  readonly submitCommunitySubmission: (
    input: SubmitCommunitySubmissionRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<SubmitCommunitySubmissionResponse>;
}

export function makeCommunitySubmissionsResource(http: HttpClient): CommunitySubmissionsResource {
  return {
    async submitCommunitySubmission(input, options = {}): Promise<SubmitCommunitySubmissionResponse> {
      const body = validateRequest(
        submitCommunitySubmissionRequest,
        input,
        'submitCommunitySubmissionRequest',
      );
      return http.request(
        {
          path: '/v1/me/community-submissions',
          method: 'POST',
          body,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        submitCommunitySubmissionResponse,
      );
    },
  };
}
