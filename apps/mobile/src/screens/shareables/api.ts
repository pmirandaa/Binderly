// Narrow `SettingsApi` surface for the mobile shareables settings
// screen. Structurally identical to the web one
// (`apps/web/app/settings/shareables/api.ts`) so a shared
// component pattern is possible in a follow-up if we want to lift
// `<ShareableRowEditor>` into `@binderly/ui`.
//
// Production wires `binderlyClientToSettingsApi(useApiClient())`
// inside the screen; tests inject a fake via `createFakeSettingsApi`.

import type { BinderlyClient } from '@binderly/api-client';
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
