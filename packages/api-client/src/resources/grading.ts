// Grading resource — multi-shot capture flow + outcome reporting.
//
// All methods require an authenticated session (`/v1/me/grading`).
// Per PROJECT.md §12, grading prediction is a Pro feature; the
// Edge Function layer enforces the freemium gate. Free users
// calling `submitGradingPrediction` get an `ApiForbiddenError`
// (HTTP 403).

import {
  attachActualGradeRequest,
  gradingSubmissionDto,
  paginatedResponseSchema,
  submitGradingPredictionRequest,
  updateGradingSubmissionStatusRequest,
  type AttachActualGradeRequest,
  type GradingSubmissionDto,
  type PaginatedResponse,
  type SubmitGradingPredictionRequest,
  type UpdateGradingSubmissionStatusRequest,
} from '@binderly/api-contracts';

import { validateRequest } from './_validate.js';

import type { HttpClient } from '../client.js';

export interface ListGradingSubmissionsOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface GradingResource {
  readonly listGradingSubmissions: (
    options?: ListGradingSubmissionsOptions,
  ) => Promise<PaginatedResponse<GradingSubmissionDto>>;
  readonly getGradingSubmission: (input: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<GradingSubmissionDto>;
  readonly submitGradingPrediction: (
    input: SubmitGradingPredictionRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<GradingSubmissionDto>;
  readonly updateGradingSubmissionStatus: (input: {
    readonly id: string;
    readonly body: UpdateGradingSubmissionStatusRequest;
    readonly signal?: AbortSignal;
  }) => Promise<GradingSubmissionDto>;
  readonly attachActualGrade: (input: {
    readonly id: string;
    readonly body: AttachActualGradeRequest;
    readonly signal?: AbortSignal;
  }) => Promise<GradingSubmissionDto>;
}

const gradingSubmissionListSchema = paginatedResponseSchema(gradingSubmissionDto);

export function makeGradingResource(http: HttpClient): GradingResource {
  return {
    async listGradingSubmissions(options = {}): Promise<PaginatedResponse<GradingSubmissionDto>> {
      return http.request(
        {
          path: '/v1/me/grading',
          method: 'GET',
          query: { cursor: options.cursor, limit: options.limit },
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        gradingSubmissionListSchema,
      );
    },

    async getGradingSubmission({ id, signal }): Promise<GradingSubmissionDto> {
      return http.request(
        {
          path: `/v1/me/grading/${encodeURIComponent(id)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        gradingSubmissionDto,
      );
    },

    async submitGradingPrediction(input, options = {}): Promise<GradingSubmissionDto> {
      const body = validateRequest(
        submitGradingPredictionRequest,
        input,
        'submitGradingPredictionRequest',
      );
      return http.request(
        {
          path: '/v1/me/grading',
          method: 'POST',
          body,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        gradingSubmissionDto,
      );
    },

    async updateGradingSubmissionStatus({
      id,
      body: bodyInput,
      signal,
    }): Promise<GradingSubmissionDto> {
      const body = validateRequest(
        updateGradingSubmissionStatusRequest,
        bodyInput,
        'updateGradingSubmissionStatusRequest',
      );
      return http.request(
        {
          path: `/v1/me/grading/${encodeURIComponent(id)}/status`,
          method: 'PATCH',
          body,
          ...(signal !== undefined ? { signal } : {}),
        },
        gradingSubmissionDto,
      );
    },

    async attachActualGrade({ id, body: bodyInput, signal }): Promise<GradingSubmissionDto> {
      const body = validateRequest(attachActualGradeRequest, bodyInput, 'attachActualGradeRequest');
      return http.request(
        {
          path: `/v1/me/grading/${encodeURIComponent(id)}/actual`,
          method: 'POST',
          body,
          ...(signal !== undefined ? { signal } : {}),
        },
        gradingSubmissionDto,
      );
    },
  };
}
