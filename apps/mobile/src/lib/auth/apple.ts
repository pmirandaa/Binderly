// Apple Sign-In wrapper.
//
// Apple Store policy requires apps that ship any third-party social
// auth (Google, Facebook, Discord, …) to also offer Apple Sign-In
// on iOS. We use the native `expo-apple-authentication` flow when
// it's available (iOS 13+), and fall back to the OAuth round-trip
// (`signInWithOAuthProvider(supabase, 'apple')`) on every other
// platform.
//
// The native flow returns an OIDC `identityToken` we hand to
// Supabase via `supabase.auth.signInWithIdToken({ provider: 'apple',
// token })`. That bypasses the OAuth redirect dance entirely on
// iOS — the system sheet collects the credential, the JS layer
// finishes the sign-in in one server round-trip.
//
// Lazy-init: every Apple module call lives inside an exported
// async function. The module evaluates without touching the native
// bridge.

import * as AppleAuthentication from 'expo-apple-authentication';

import { signInWithOAuthProvider, type OAuthSignInResult } from './oauth.js';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Outcome of {@link signInWithApple}. Mirrors the OAuth result
 * shape so the calling screen can branch identically across
 * providers.
 */
export type AppleSignInResult =
  | { readonly type: 'success' }
  | { readonly type: 'cancel' }
  | { readonly type: 'error'; readonly message: string };

/**
 * Resolves to `true` when the device supports the native Apple
 * Sign-In flow (iOS 13+). Android / web always resolve `false`,
 * which is the signal callers use to fall back to the OAuth
 * round-trip.
 *
 * Wrapped in a try/catch so the simulator / web jsdom path can't
 * throw a hard error past the call site.
 */
export async function isAppleAuthAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Drive the full Apple Sign-In flow. On iOS we use the native
 * sheet + `signInWithIdToken`; on every other platform we fall
 * back to the OAuth redirect flow.
 *
 * The Apple Store rule requires us to *show* the button on iOS
 * even when the SDK reports unavailable (older devices), so the
 * caller renders the button unconditionally and lets this function
 * decide which code path runs.
 */
export async function signInWithApple(supabase: SupabaseClient): Promise<AppleSignInResult> {
  if (await isAppleAuthAvailable()) {
    return signInWithAppleNative(supabase);
  }
  return mapOAuthResult(await signInWithOAuthProvider(supabase, 'apple'));
}

async function signInWithAppleNative(supabase: SupabaseClient): Promise<AppleSignInResult> {
  let credential: Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (cause) {
    if (isUserCancellation(cause)) return { type: 'cancel' };
    const message = cause instanceof Error ? cause.message : String(cause);
    return { type: 'error', message };
  }

  if (typeof credential.identityToken !== 'string' || credential.identityToken.length === 0) {
    return {
      type: 'error',
      message: 'Apple did not return an identity token for this sign-in.',
    };
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error !== null) {
    return { type: 'error', message: error.message };
  }
  return { type: 'success' };
}

function mapOAuthResult(result: OAuthSignInResult): AppleSignInResult {
  if (result.type === 'success') return { type: 'success' };
  if (result.type === 'cancel' || result.type === 'dismiss') return { type: 'cancel' };
  return { type: 'error', message: result.message };
}

/**
 * Apple's SDK signals "user cancelled" via either an Error code
 * (`ERR_REQUEST_CANCELED`) or the legacy `1001`/`code: 'ERR_CANCELED'`
 * shape depending on platform. Treat any of those as a soft cancel
 * so the caller can suppress the error toast.
 */
function isUserCancellation(cause: unknown): boolean {
  if (cause === null || typeof cause !== 'object') return false;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  return /CANCEL/i.test(code);
}
