// Profile resource — `/v1/me/profile` reads/updates plus
// `/v1/me/subscription` reads. Split out from `auth.ts` because
// `auth.ts` is the interactive flow surface (sign-in, sign-out,
// OAuth, magic link) while `profile.ts` is data CRUD over the
// signed-in user's `profile` + `subscription` rows.

import {
  handleAvailabilityResponse,
  profileDto,
  shareableHandleSchema,
  subscriptionDto,
  updateProfileRequest,
  type HandleAvailabilityResponse,
  type ProfileDto,
  type SubscriptionDto,
  type UpdateProfileRequest,
} from '@binderly/api-contracts';

import { validateRequest } from './_validate.js';

import type { HttpClient } from '../client.js';

export interface ProfileResource {
  readonly getMyProfile: (options?: { readonly signal?: AbortSignal }) => Promise<ProfileDto>;
  readonly updateMyProfile: (
    input: UpdateProfileRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ProfileDto>;
  readonly getMySubscription: (options?: {
    readonly signal?: AbortSignal;
  }) => Promise<SubscriptionDto>;
  /**
   * Probe whether a handle is free for the current user to
   * claim. Auth-required (rate-limit budget tied to the caller
   * JWT). Returns the typed response on success; the settings
   * UI uses `available` to gate the save button and `reason` to
   * render the right copy.
   *
   * Server endpoint: `GET /v1/me/handle-available?handle=<value>`.
   * The endpoint ships in the Q-020 follow-up
   * `T-BE-SHAREABLES-HANDLE-CHECK`; until then the client
   * surfaces the request with the same typed contract so the UI
   * is wired-and-ready (404 from the backend short-circuits the
   * UI's "we'll verify on save" degraded path).
   */
  readonly checkHandleAvailability: (input: {
    readonly handle: string;
    readonly signal?: AbortSignal;
  }) => Promise<HandleAvailabilityResponse>;
}

export function makeProfileResource(http: HttpClient): ProfileResource {
  return {
    async getMyProfile(options = {}): Promise<ProfileDto> {
      return http.request(
        {
          path: '/v1/me/profile',
          method: 'GET',
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        profileDto,
      );
    },

    async updateMyProfile(input, options = {}): Promise<ProfileDto> {
      const body = validateRequest(updateProfileRequest, input, 'updateProfileRequest');
      return http.request(
        {
          path: '/v1/me/profile',
          method: 'PATCH',
          body,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        profileDto,
      );
    },

    async getMySubscription(options = {}): Promise<SubscriptionDto> {
      return http.request(
        {
          path: '/v1/me/subscription',
          method: 'GET',
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        subscriptionDto,
      );
    },

    async checkHandleAvailability({ handle, signal }): Promise<HandleAvailabilityResponse> {
      // Pre-validate the handle client-side via the picker
      // schema. Failing here saves a round-trip and is the
      // expected first response for a settings-UI keystroke
      // that hasn't crossed the validity threshold yet.
      const normalised = validateRequest(
        shareableHandleSchema,
        handle,
        'shareableHandleSchema (checkHandleAvailability)',
      );
      return http.request(
        {
          path: '/v1/me/handle-available',
          method: 'GET',
          query: { handle: normalised },
          ...(signal !== undefined ? { signal } : {}),
        },
        handleAvailabilityResponse,
      );
    },
  };
}
