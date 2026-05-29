// Test fixtures for the settings UI. The factory below builds a
// `SettingsApi` backed by configurable in-memory state so tests
// can drive happy paths + error branches without touching a
// real api-client.
//
// Production code never imports from this file — it lives in
// `app/` so vitest can find it under `apps/web/vitest.config.ts`,
// but it is not part of the route tree.

import type {
  CreateShareableRequest,
  HandleAvailabilityResponse,
  ProfileDto,
  ShareableDto,
  SubscriptionDto,
  UpdateProfileRequest,
  UpdateShareableRequest,
} from '@binderly/api-contracts';

import type { SettingsApi } from './api';

const NOW = '2026-05-20T00:00:00Z';
const USER_ID = '11111111-2222-4222-8222-111111111111';
const SHAREABLE_ID = '22222222-3333-4333-8333-222222222222';

export const FAKE_PROFILE: ProfileDto = {
  userId: USER_ID,
  handle: 'pablo',
  displayName: 'Pablo',
  avatarUrl: null,
  bio: null,
  socialLinks: [],
  preferences: {},
  createdAt: NOW,
  updatedAt: NOW,
};

export const FAKE_SUBSCRIPTION: SubscriptionDto = {
  userId: USER_ID,
  tier: 'free',
  source: null,
  externalCustomerId: null,
  expiresAt: null,
  lastEventAt: null,
};

export const FAKE_SHAREABLE: ShareableDto = {
  id: SHAREABLE_ID,
  userId: USER_ID,
  slug: 'my-binder',
  target: { kind: 'full' },
  theme: 'default',
  isActive: true,
  showValues: false,
  showMissing: true,
  showPhotos: false,
  createdAt: NOW,
  updatedAt: NOW,
};

export interface FakeSettingsApi extends SettingsApi {
  readonly state: {
    profile: ProfileDto;
    subscription: SubscriptionDto;
    shareables: ShareableDto[];
  };
  setHandleTaken: (handle: string) => void;
  setProfileError: (err: Error | null) => void;
  setUpdateShareableError: (err: Error | null) => void;
  setCreateShareableError: (err: Error | null) => void;
  setDeleteShareableError: (err: Error | null) => void;
  setHandleAvailabilityError: (err: Error | null) => void;
}

export interface FakeSettingsApiOptions {
  readonly profile?: ProfileDto;
  readonly subscription?: SubscriptionDto;
  readonly shareables?: readonly ShareableDto[];
}

/**
 * Build a `SettingsApi` whose state is mutable from tests via
 * the returned `state` handle. Errors injected via `setXxxError`
 * surface the next time the relevant method is called.
 */
export function createFakeSettingsApi(options: FakeSettingsApiOptions = {}): FakeSettingsApi {
  const state = {
    profile: { ...(options.profile ?? FAKE_PROFILE) },
    subscription: { ...(options.subscription ?? FAKE_SUBSCRIPTION) },
    shareables: [...(options.shareables ?? [FAKE_SHAREABLE])],
  };

  const takenHandles = new Set<string>();
  let profileError: Error | null = null;
  let updateShareableError: Error | null = null;
  let createShareableError: Error | null = null;
  let deleteShareableError: Error | null = null;
  let handleAvailabilityError: Error | null = null;

  const api: SettingsApi = {
    async getMyProfile() {
      return { ...state.profile };
    },
    async updateMyProfile(patch: UpdateProfileRequest) {
      if (profileError !== null) throw profileError;
      const next: ProfileDto = {
        ...state.profile,
        ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName ?? null } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio ?? null } : {}),
        ...(patch.socialLinks !== undefined ? { socialLinks: [...patch.socialLinks] } : {}),
        updatedAt: new Date().toISOString(),
      };
      state.profile = next;
      return { ...next };
    },
    async getMySubscription() {
      return { ...state.subscription };
    },
    async listShareables() {
      return state.shareables.map((s) => ({ ...s }));
    },
    async createShareable(input: CreateShareableRequest) {
      if (createShareableError !== null) throw createShareableError;
      const created: ShareableDto = {
        id: `new-${Date.now().toString(36)}`,
        userId: state.profile.userId,
        slug: input.slug,
        target: input.target,
        theme: input.theme ?? 'default',
        isActive: input.isActive ?? true,
        showValues: input.showValues ?? false,
        showMissing: input.showMissing ?? true,
        showPhotos: input.showPhotos ?? false,
        createdAt: NOW,
        updatedAt: NOW,
      };
      state.shareables.push(created);
      return { ...created };
    },
    async updateShareable(id: string, patch: UpdateShareableRequest) {
      if (updateShareableError !== null) throw updateShareableError;
      const idx = state.shareables.findIndex((s) => s.id === id);
      if (idx === -1) throw new Error(`Shareable ${id} not found in fake api`);
      const merged: ShareableDto = {
        ...state.shareables[idx]!,
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(patch.showValues !== undefined ? { showValues: patch.showValues } : {}),
        ...(patch.showMissing !== undefined ? { showMissing: patch.showMissing } : {}),
        ...(patch.showPhotos !== undefined ? { showPhotos: patch.showPhotos } : {}),
        updatedAt: new Date().toISOString(),
      };
      state.shareables[idx] = merged;
      return { ...merged };
    },
    async deleteShareable(id: string) {
      if (deleteShareableError !== null) throw deleteShareableError;
      state.shareables = state.shareables.filter((s) => s.id !== id);
    },
    async checkHandleAvailability(handle: string): Promise<HandleAvailabilityResponse> {
      if (handleAvailabilityError !== null) throw handleAvailabilityError;
      const lowered = handle.toLowerCase();
      if (lowered === state.profile.handle.toLowerCase()) {
        return { handle: lowered, available: true };
      }
      if (takenHandles.has(lowered)) {
        return { handle: lowered, available: false, reason: 'taken' };
      }
      return { handle: lowered, available: true };
    },
  };

  return {
    ...api,
    state,
    setHandleTaken(handle: string) {
      takenHandles.add(handle.toLowerCase());
    },
    setProfileError(err: Error | null) {
      profileError = err;
    },
    setUpdateShareableError(err: Error | null) {
      updateShareableError = err;
    },
    setCreateShareableError(err: Error | null) {
      createShareableError = err;
    },
    setDeleteShareableError(err: Error | null) {
      deleteShareableError = err;
    },
    setHandleAvailabilityError(err: Error | null) {
      handleAvailabilityError = err;
    },
  };
}
