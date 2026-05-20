// Settings-UI narrow API surface.
//
// The settings view + per-row editor program against this interface
// rather than the full `BinderlyClient` so tests can inject a fake
// (see `fixtures.ts`). Production wires `binderlyClientToSettingsApi`
// inside a `useEffect` in `ShareablesSettingsRoute` so the env-load
// branch never runs during `next build` (matches T-W-COLLECTION).
//
// The interface intentionally surfaces the pieces of the existing
// `@binderly/api-client` resources (profile + shareables) the settings
// surface needs — it does NOT introduce a fictional unified resource
// because the merged shape splits owner identity (profile) from
// per-page config (shareable). See open-questions.md § Q-020.

import type {
  BinderlyClient,
} from '@binderly/api-client';
import type {
  CreateShareableRequest,
  HandleAvailabilityResponse,
  ProfileDto,
  ShareableDto,
  SubscriptionDto,
  UpdateProfileRequest,
  UpdateShareableRequest,
} from '@binderly/api-contracts';

export interface SettingsApi {
  readonly getMyProfile: (signal?: AbortSignal) => Promise<ProfileDto>;
  readonly updateMyProfile: (
    patch: UpdateProfileRequest,
    signal?: AbortSignal,
  ) => Promise<ProfileDto>;
  readonly getMySubscription: (signal?: AbortSignal) => Promise<SubscriptionDto>;
  readonly listShareables: (signal?: AbortSignal) => Promise<readonly ShareableDto[]>;
  readonly createShareable: (
    input: CreateShareableRequest,
    signal?: AbortSignal,
  ) => Promise<ShareableDto>;
  readonly updateShareable: (
    id: string,
    patch: UpdateShareableRequest,
    signal?: AbortSignal,
  ) => Promise<ShareableDto>;
  readonly deleteShareable: (id: string, signal?: AbortSignal) => Promise<void>;
  readonly checkHandleAvailability: (
    handle: string,
    signal?: AbortSignal,
  ) => Promise<HandleAvailabilityResponse>;
}

/**
 * Adapt a `BinderlyClient` into the narrow `SettingsApi`. Pure
 * projection: every method forwards to the underlying typed
 * resource. The api-client owns request validation, error
 * mapping, and `AbortSignal` propagation; this adapter just
 * unifies the call surface.
 */
export function binderlyClientToSettingsApi(client: BinderlyClient): SettingsApi {
  return {
    getMyProfile: (signal) =>
      client.profile.getMyProfile(signal !== undefined ? { signal } : undefined),
    updateMyProfile: (patch, signal) =>
      client.profile.updateMyProfile(patch, signal !== undefined ? { signal } : undefined),
    getMySubscription: (signal) =>
      client.profile.getMySubscription(signal !== undefined ? { signal } : undefined),
    listShareables: (signal) =>
      client.shareables.listShareables(signal !== undefined ? { signal } : undefined),
    createShareable: (input, signal) =>
      client.shareables.createShareable(input, signal !== undefined ? { signal } : undefined),
    updateShareable: (id, patch, signal) =>
      client.shareables.updateShareable({
        id,
        patch,
        ...(signal !== undefined ? { signal } : {}),
      }),
    deleteShareable: (id, signal) =>
      client.shareables.deleteShareable({ id, ...(signal !== undefined ? { signal } : {}) }),
    checkHandleAvailability: (handle, signal) =>
      client.profile.checkHandleAvailability({
        handle,
        ...(signal !== undefined ? { signal } : {}),
      }),
  };
}
