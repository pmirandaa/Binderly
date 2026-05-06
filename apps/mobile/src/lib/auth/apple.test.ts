import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppleAuthAvailable, signInWithApple } from './apple';

import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: vi.fn(),
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(),
}));

function buildSupabaseMock() {
  const signInWithIdToken = vi.fn(async () => ({ data: { session: {} }, error: null }));
  const signInWithOAuth = vi.fn(async () => ({
    data: { url: 'https://provider/oauth' },
    error: null,
  }));
  const supabase = {
    auth: { signInWithIdToken, signInWithOAuth },
  } as unknown as SupabaseClient;
  return { supabase, signInWithIdToken, signInWithOAuth };
}

describe('isAppleAuthAvailable', () => {
  beforeEach(() => {
    vi.mocked(AppleAuthentication.isAvailableAsync).mockReset();
  });
  it('returns the SDK result when it resolves', async () => {
    vi.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValueOnce(true);
    expect(await isAppleAuthAvailable()).toBe(true);
  });
  it('returns false when the SDK throws', async () => {
    vi.mocked(AppleAuthentication.isAvailableAsync).mockRejectedValueOnce(new Error('nope'));
    expect(await isAppleAuthAvailable()).toBe(false);
  });
});

describe('signInWithApple — native path', () => {
  beforeEach(() => {
    vi.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
    vi.mocked(AppleAuthentication.signInAsync).mockReset();
  });

  it('requests FULL_NAME + EMAIL scopes', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({
      identityToken: 'apple-jwt',
      authorizationCode: 'auth-code',
      user: 'apple-user-1',
      state: null,
      fullName: null,
      email: null,
      realUserStatus: 0,
    } as Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>);
    await signInWithApple(supabase);
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  });

  it('hands the identityToken to supabase.auth.signInWithIdToken', async () => {
    const { supabase, signInWithIdToken } = buildSupabaseMock();
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({
      identityToken: 'apple-jwt',
      authorizationCode: 'auth-code',
      user: 'apple-user-1',
      state: null,
      fullName: null,
      email: null,
      realUserStatus: 0,
    } as Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>);
    const result = await signInWithApple(supabase);
    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-jwt',
    });
    expect(result).toEqual({ type: 'success' });
  });

  it('returns cancel when the SDK throws ERR_REQUEST_CANCELED', async () => {
    const { supabase, signInWithIdToken } = buildSupabaseMock();
    const cancellation = Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
    vi.mocked(AppleAuthentication.signInAsync).mockRejectedValueOnce(cancellation);
    const result = await signInWithApple(supabase);
    expect(result).toEqual({ type: 'cancel' });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it('returns error when the SDK throws a non-cancel error', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(AppleAuthentication.signInAsync).mockRejectedValueOnce(new Error('keychain busted'));
    const result = await signInWithApple(supabase);
    expect(result).toEqual({ type: 'error', message: 'keychain busted' });
  });

  it('returns error when Apple omits the identityToken', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({
      identityToken: null,
      authorizationCode: null,
      user: 'apple-user-1',
      state: null,
      fullName: null,
      email: null,
      realUserStatus: 0,
    } as Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>);
    const result = await signInWithApple(supabase);
    expect(result.type).toBe('error');
  });

  it('returns error when Supabase rejects the id-token exchange', async () => {
    const supabase = {
      auth: {
        signInWithIdToken: vi.fn(async () => ({ data: null, error: { message: 'invalid token' } })),
      },
    } as unknown as SupabaseClient;
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({
      identityToken: 'apple-jwt',
      authorizationCode: 'auth-code',
      user: 'apple-user-1',
      state: null,
      fullName: null,
      email: null,
      realUserStatus: 0,
    } as Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>);
    const result = await signInWithApple(supabase);
    expect(result).toEqual({ type: 'error', message: 'invalid token' });
  });
});

describe('signInWithApple — OAuth fallback path (Apple unavailable)', () => {
  beforeEach(() => {
    vi.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(false);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockReset();
  });

  it('falls back to the OAuth round-trip when isAvailable returns false', async () => {
    const { supabase, signInWithOAuth } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({
      type: 'success',
      url: 'binderly://auth/callback?code=abc',
    });
    const result = await signInWithApple(supabase);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: { redirectTo: 'binderly://auth/callback', skipBrowserRedirect: true },
    });
    expect(result).toEqual({ type: 'success' });
  });

  it('maps OAuth cancel to cancel', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({ type: 'cancel' } as Awaited<
      ReturnType<typeof WebBrowser.openAuthSessionAsync>
    >);
    const result = await signInWithApple(supabase);
    expect(result).toEqual({ type: 'cancel' });
  });
});
