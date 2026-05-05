// Profile resource — `/v1/me/profile` reads/updates plus
// `/v1/me/subscription` reads. Split out from `auth.ts` because
// `auth.ts` is the interactive flow surface (sign-in, sign-out,
// OAuth, magic link) while `profile.ts` is data CRUD over the
// signed-in user's `profile` + `subscription` rows.

import {
  profileDto,
  subscriptionDto,
  updateProfileRequest,
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
  };
}
