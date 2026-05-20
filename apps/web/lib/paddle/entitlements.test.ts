import { describe, expect, it, vi } from 'vitest';

import { ApiNetworkError, ApiNotFoundError, ApiUnauthorizedError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type { SubscriptionDto } from '@binderly/api-contracts';

import { DEFAULT_FREE_SNAPSHOT, readEntitlement } from './entitlements';

interface ProfileMock {
  getMySubscription: ReturnType<typeof vi.fn>;
  getMyProfile: ReturnType<typeof vi.fn>;
  updateMyProfile: ReturnType<typeof vi.fn>;
}

function makeClient(profile: ProfileMock): BinderlyClient {
  return { profile } as unknown as BinderlyClient;
}

function emptyProfile(impl: ProfileMock['getMySubscription']): ProfileMock {
  return {
    getMySubscription: impl,
    getMyProfile: vi.fn(),
    updateMyProfile: vi.fn(),
  };
}

const FREE_DTO: SubscriptionDto = {
  userId: '11111111-2222-3333-4444-555555555555',
  tier: 'free',
  source: null,
  externalCustomerId: null,
  expiresAt: null,
  lastEventAt: null,
};

const PRO_DTO: SubscriptionDto = {
  userId: '11111111-2222-3333-4444-555555555555',
  tier: 'pro',
  source: 'paddle',
  externalCustomerId: 'ctm_123',
  expiresAt: '2027-01-01T00:00:00.000Z',
  lastEventAt: '2026-05-20T12:00:00.000Z',
};

describe('readEntitlement', () => {
  it('returns the dto fields plus authoritative=true on success', async () => {
    const profile = emptyProfile(vi.fn().mockResolvedValue(PRO_DTO));
    const result = await readEntitlement(makeClient(profile));
    expect(result.tier).toBe('pro');
    expect(result.source).toBe('paddle');
    expect(result.externalCustomerId).toBe('ctm_123');
    expect(result.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    expect(result.authoritative).toBe(true);
  });

  it('returns the dto fields for a free user', async () => {
    const profile = emptyProfile(vi.fn().mockResolvedValue(FREE_DTO));
    const result = await readEntitlement(makeClient(profile));
    expect(result.tier).toBe('free');
    expect(result.authoritative).toBe(true);
  });

  it('degrades to default free snapshot on 404 (endpoint not deployed)', async () => {
    const profile = emptyProfile(
      vi.fn().mockRejectedValue(new ApiNotFoundError('not found', { status: 404 })),
    );
    const result = await readEntitlement(makeClient(profile));
    expect(result).toEqual(DEFAULT_FREE_SNAPSHOT);
    expect(result.authoritative).toBe(false);
  });

  it('degrades to default free snapshot on unknown errors', async () => {
    const profile = emptyProfile(vi.fn().mockRejectedValue(new Error('boom')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await readEntitlement(makeClient(profile));
    expect(result).toEqual(DEFAULT_FREE_SNAPSHOT);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rethrows ApiUnauthorizedError so the caller can prompt re-sign-in', async () => {
    const profile = emptyProfile(
      vi.fn().mockRejectedValue(new ApiUnauthorizedError('expired', { status: 401 })),
    );
    await expect(readEntitlement(makeClient(profile))).rejects.toBeInstanceOf(
      ApiUnauthorizedError,
    );
  });

  it('rethrows ApiNetworkError so the caller can show a retry banner', async () => {
    const profile = emptyProfile(vi.fn().mockRejectedValue(new ApiNetworkError('offline')));
    await expect(readEntitlement(makeClient(profile))).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it('rethrows AbortError so route navigation cancels cleanly', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const profile = emptyProfile(vi.fn().mockRejectedValue(abort));
    await expect(readEntitlement(makeClient(profile))).rejects.toBe(abort);
  });

  it('passes through the AbortSignal to the api-client call', async () => {
    const getMySubscription = vi.fn().mockResolvedValue(FREE_DTO);
    const profile = emptyProfile(getMySubscription);
    const controller = new AbortController();
    await readEntitlement(makeClient(profile), { signal: controller.signal });
    expect(getMySubscription).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('omits signal from options when not provided', async () => {
    const getMySubscription = vi.fn().mockResolvedValue(FREE_DTO);
    const profile = emptyProfile(getMySubscription);
    await readEntitlement(makeClient(profile));
    const callArg = getMySubscription.mock.calls[0]?.[0] as { signal?: AbortSignal } | undefined;
    expect(callArg).not.toHaveProperty('signal');
  });
});
