import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAUTH_CALLBACK_PATH,
  OAUTH_PROVIDERS,
  extractAuthCodeFromUrl,
  extractAuthErrorFromUrl,
  getOAuthRedirectUrl,
  signInWithOAuthProvider,
} from './oauth';

import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(),
  WebBrowserResultType: {
    CANCEL: 'cancel',
    DISMISS: 'dismiss',
    OPENED: 'opened',
    LOCKED: 'locked',
  },
}));

function buildSupabaseMock(
  signInResult: { data?: { url?: string }; error?: { message: string } | null } = {
    data: { url: 'https://provider.example/oauth?state=abc' },
    error: null,
  },
) {
  const signInWithOAuth = vi.fn(async () => signInResult);
  const supabase = {
    auth: { signInWithOAuth },
  } as unknown as SupabaseClient;
  return { supabase, signInWithOAuth };
}

describe('OAUTH_PROVIDERS / OAUTH_CALLBACK_PATH', () => {
  it('exposes the three provider literals the api-client supports', () => {
    expect(OAUTH_PROVIDERS).toEqual(['google', 'apple', 'discord']);
  });
  it('points at /auth/callback as the deep-link path', () => {
    expect(OAUTH_CALLBACK_PATH).toBe('auth/callback');
  });
});

describe('getOAuthRedirectUrl', () => {
  it('builds a binderly:// URL for the auth/callback path by default', () => {
    expect(getOAuthRedirectUrl()).toBe('binderly://auth/callback');
    expect(Linking.createURL).toHaveBeenCalledWith('auth/callback');
  });
  it('honours a custom path argument', () => {
    expect(getOAuthRedirectUrl('custom/path')).toBe('binderly://custom/path');
  });
});

describe('extractAuthCodeFromUrl', () => {
  it('parses the code from the canonical query string', () => {
    expect(extractAuthCodeFromUrl('binderly://auth/callback?code=abc123')).toBe('abc123');
  });
  it('parses the code when nested behind other params', () => {
    expect(extractAuthCodeFromUrl('binderly://auth/callback?state=xyz&code=abc123&extra=1')).toBe(
      'abc123',
    );
  });
  it('parses the code from a URL fragment', () => {
    expect(extractAuthCodeFromUrl('binderly://auth/callback#code=abc123')).toBe('abc123');
  });
  it('decodes URL-encoded code values', () => {
    expect(extractAuthCodeFromUrl('binderly://auth/callback?code=ab%20cd')).toBe('ab cd');
  });
  it('returns null when the URL has no code param', () => {
    expect(extractAuthCodeFromUrl('binderly://auth/callback?state=xyz')).toBeNull();
  });
  it('returns null for an empty / non-string input', () => {
    expect(extractAuthCodeFromUrl('')).toBeNull();
    expect(extractAuthCodeFromUrl(undefined as unknown as string)).toBeNull();
  });
});

describe('extractAuthErrorFromUrl', () => {
  it('prefers error_description over error', () => {
    expect(
      extractAuthErrorFromUrl(
        'binderly://auth/callback?error=access_denied&error_description=Nope',
      ),
    ).toBe('Nope');
  });
  it('decodes plus-as-space in the description', () => {
    expect(
      extractAuthErrorFromUrl('binderly://auth/callback?error_description=Could+not+verify'),
    ).toBe('Could not verify');
  });
  it('falls back to the error code when no description is present', () => {
    expect(extractAuthErrorFromUrl('binderly://auth/callback?error=access_denied')).toBe(
      'access_denied',
    );
  });
  it('returns null when the URL has no error params', () => {
    expect(extractAuthErrorFromUrl('binderly://auth/callback?code=abc')).toBeNull();
  });
});

describe('signInWithOAuthProvider', () => {
  beforeEach(() => {
    vi.mocked(WebBrowser.openAuthSessionAsync).mockReset();
  });

  it('passes the provider + redirect to supabase.auth.signInWithOAuth', async () => {
    const { supabase, signInWithOAuth } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({
      type: 'success',
      url: 'binderly://auth/callback?code=abc',
    });
    await signInWithOAuthProvider(supabase, 'google');
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'binderly://auth/callback',
        skipBrowserRedirect: true,
      },
    });
  });

  it('opens the returned URL in WebBrowser.openAuthSessionAsync', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({
      type: 'success',
      url: 'binderly://auth/callback?code=abc',
    });
    await signInWithOAuthProvider(supabase, 'discord');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://provider.example/oauth?state=abc',
      'binderly://auth/callback',
    );
  });

  it('returns success when the browser reports a redirect', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({
      type: 'success',
      url: 'binderly://auth/callback?code=abc',
    });
    const result = await signInWithOAuthProvider(supabase, 'google');
    expect(result).toEqual({
      type: 'success',
      url: 'binderly://auth/callback?code=abc',
    });
  });

  it('returns cancel when the user dismisses the browser sheet', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({ type: 'cancel' } as Awaited<
      ReturnType<typeof WebBrowser.openAuthSessionAsync>
    >);
    const result = await signInWithOAuthProvider(supabase, 'google');
    expect(result).toEqual({ type: 'cancel' });
  });

  it('returns dismiss when the browser is dismissed programmatically', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({ type: 'dismiss' } as Awaited<
      ReturnType<typeof WebBrowser.openAuthSessionAsync>
    >);
    const result = await signInWithOAuthProvider(supabase, 'discord');
    expect(result).toEqual({ type: 'dismiss' });
  });

  it('returns error when supabase rejects the request', async () => {
    const { supabase } = buildSupabaseMock({ error: { message: 'provider misconfigured' } });
    const result = await signInWithOAuthProvider(supabase, 'apple');
    expect(result).toEqual({ type: 'error', message: 'provider misconfigured' });
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('returns error when supabase succeeds but no URL is returned', async () => {
    const { supabase } = buildSupabaseMock({ data: { url: undefined }, error: null });
    const result = await signInWithOAuthProvider(supabase, 'google');
    expect(result.type).toBe('error');
  });

  it('returns error when WebBrowser throws', async () => {
    const { supabase } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockRejectedValueOnce(new Error('boom'));
    const result = await signInWithOAuthProvider(supabase, 'google');
    expect(result).toEqual({ type: 'error', message: 'boom' });
  });

  it('honours a custom redirectUrl override', async () => {
    const { supabase, signInWithOAuth } = buildSupabaseMock();
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({
      type: 'success',
      url: 'custom://callback?code=abc',
    });
    await signInWithOAuthProvider(supabase, 'google', { redirectUrl: 'custom://callback' });
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'custom://callback', skipBrowserRedirect: true },
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://provider.example/oauth?state=abc',
      'custom://callback',
    );
  });
});
