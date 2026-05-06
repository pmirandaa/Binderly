// OAuth provider helpers for the mobile sign-in flow.
//
// The Supabase JS SDK's web-flavoured `signInWithOAuth` returns a
// provider URL and assumes the browser will redirect there + back
// itself. On mobile we have to drive that round-trip explicitly:
//
//   1. Ask Supabase for the provider's authorization URL via
//      `supabase.auth.signInWithOAuth({ provider, options: {
//      redirectTo, skipBrowserRedirect: true } })`.
//   2. Open that URL in an `ASWebAuthenticationSession` (iOS) /
//      Custom Tab (Android) via `WebBrowser.openAuthSessionAsync`,
//      passing the `binderly://auth/callback` deep link as the
//      expected return URL.
//   3. When the system browser redirects back to that deep link,
//      the OS routes it to our `app/auth/callback.tsx` route. The
//      callback screen then exchanges the `code` query param for a
//      session via `supabase.auth.exchangeCodeForSession(code)`.
//
// This module owns step 1 + 2. Step 3 lives in `CallbackScreen`.
//
// Lazy-init discipline: every Expo / Supabase call is performed
// inside an exported async function. No top-level `import.meta` /
// `process.env` reads, no module-evaluation side effects. Mirrors
// the lazy posture of `<AuthProvider>`.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The OAuth providers we support. Pinned to the three that
 * `packages/api-client/src/resources/auth.ts` enumerates so the
 * client- and server-side surfaces stay in lock-step.
 */
export const OAUTH_PROVIDERS = ['google', 'apple', 'discord'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Default deep-link path the callback route handles. */
export const OAUTH_CALLBACK_PATH = 'auth/callback';

/**
 * Outcome of {@link signInWithOAuthProvider}. The native browser
 * dance is opaque from the JS side — it either redirected back to
 * our deep link (`success`), the user dismissed the sheet
 * (`cancel`), or something else went wrong (`error`).
 */
export type OAuthSignInResult =
  | { readonly type: 'success'; readonly url: string }
  | { readonly type: 'cancel' }
  | { readonly type: 'dismiss' }
  | { readonly type: 'error'; readonly message: string };

/**
 * Build the deep-link URL the OAuth provider should redirect back
 * to after authentication. Defaults to `binderly://auth/callback`
 * (the scheme is registered in `app.json`). Tests override this
 * via the optional `path` argument.
 */
export function getOAuthRedirectUrl(path: string = OAUTH_CALLBACK_PATH): string {
  return Linking.createURL(path);
}

/**
 * Drive the full OAuth round-trip for `provider`.
 *
 * Implementation mirrors the patterns from the Supabase docs for
 * RN apps: ask for a provider URL with `skipBrowserRedirect: true`,
 * hand the URL to `expo-web-browser`'s `openAuthSessionAsync`,
 * which blocks until the system browser redirects back to the
 * supplied deep link or the user dismisses the sheet.
 *
 * The returned shape is intentionally narrow — the caller (the
 * sign-in screen) decides how to surface each outcome to the user.
 * The actual session exchange happens in `CallbackScreen`, not
 * here, so this function never persists state.
 */
export async function signInWithOAuthProvider(
  supabase: SupabaseClient,
  provider: OAuthProvider,
  options: { readonly redirectUrl?: string } = {},
): Promise<OAuthSignInResult> {
  const redirectUrl = options.redirectUrl ?? getOAuthRedirectUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true,
    },
  });

  if (error !== null) {
    return { type: 'error', message: error.message };
  }
  const authUrl = data?.url;
  if (typeof authUrl !== 'string' || authUrl.length === 0) {
    return {
      type: 'error',
      message: 'Supabase did not return an OAuth URL for this provider.',
    };
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === 'success') {
      return { type: 'success', url: result.url };
    }
    if (result.type === 'cancel') return { type: 'cancel' };
    if (result.type === 'dismiss') return { type: 'dismiss' };
    return { type: 'error', message: `Unexpected browser result: ${result.type}` };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { type: 'error', message };
  }
}

/**
 * Pull the `code` query param off a deep-link URL. Returns `null`
 * if the URL is malformed or has no `code` param. Used by
 * `CallbackScreen` to drive `supabase.auth.exchangeCodeForSession`.
 *
 * We accept either the canonical deep link (`binderly://auth/callback?code=...`)
 * or a typical OAuth fragment URL (`binderly://auth/callback#code=...`)
 * — Supabase's PKCE flow uses the query string, but provider quirks
 * occasionally land tokens in the fragment.
 */
export function extractAuthCodeFromUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const queryMatch = /[?&]code=([^&#]+)/.exec(url);
  if (queryMatch) return decodeURIComponent(queryMatch[1] ?? '');
  const fragmentMatch = /[#&]code=([^&]+)/.exec(url);
  if (fragmentMatch) return decodeURIComponent(fragmentMatch[1] ?? '');
  return null;
}

/**
 * Pull the `error_description` (or `error`) param off a deep-link
 * URL. Supabase's hosted error pages redirect back with
 * `?error=<code>&error_description=<message>` so the caller can
 * surface a user-readable failure reason.
 */
export function extractAuthErrorFromUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const descMatch = /[?&]error_description=([^&#]+)/.exec(url);
  if (descMatch) return decodeURIComponent((descMatch[1] ?? '').replace(/\+/g, ' '));
  const errMatch = /[?&]error=([^&#]+)/.exec(url);
  if (errMatch) return decodeURIComponent(errMatch[1] ?? '');
  return null;
}
