// Auth resource — interactive sign-in flows + session reads.
//
// The api-client diverges from "thin HTTP wrapper" here on
// purpose: sign-in flows are stateful (PKCE pairs, OAuth
// redirects, cookie persistence) and the Supabase JS SDK
// already owns them well. Re-implementing them would mean
// re-implementing PKCE, the OAuth2 redirect dance, and the
// magic-link OTP flow. Instead we delegate to a `SupabaseClient`
// instance.
//
// Two construction modes:
//
//   1. The caller supplies their own `SupabaseClient` to
//      `createClient({ supabaseAuth: ... })`. This is the
//      preferred path for browser / mobile apps that already
//      have a session listener wired into their state store —
//      sharing the SDK instance keeps the api-client and the
//      app reading from the same persisted session.
//   2. The caller does NOT supply one. The auth resource
//      lazily builds its own with browser-friendly defaults
//      (`persistSession: true`, `autoRefreshToken: true`,
//      `detectSessionInUrl: true`). For server-side callers
//      this fallback is wrong; server-side callers should
//      always pass their own SDK instance with persistence
//      disabled (or just not call the auth resource at all).
//
// Errors from the SDK wrap in `ApiAuthError`. The session
// shape returned to callers is the api-contracts `sessionDto`
// (the public-safe subset of the SDK's `Session`).

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

import { sessionDto, userDto, type SessionDto, type UserDto } from '@binderly/api-contracts';

import { ApiAuthError } from '../error.js';

export interface SignInWithOAuthOptions {
  readonly provider: 'google' | 'apple' | 'discord';
  /** Where to land after the OAuth round-trip (e.g. `https://app.binderly.app/auth/callback`). */
  readonly redirectTo?: string;
  /** Optional scopes (defaults to provider defaults). */
  readonly scopes?: string;
}

export interface SignInWithOAuthResult {
  /** The provider-hosted authorization URL the caller should redirect the user to. */
  readonly url: string;
}

export interface SignInWithMagicLinkOptions {
  readonly email: string;
  /** Where to land after the user clicks the link in their inbox. */
  readonly redirectTo?: string;
  /** Whether to create a new user if the email is unknown. Defaults to `true`. */
  readonly shouldCreateUser?: boolean;
}

export interface AuthResource {
  /**
   * Start an OAuth round-trip. Returns the authorization URL the
   * caller should redirect the browser to. After the provider
   * redirects back to `redirectTo`, the caller invokes
   * {@link AuthResource.exchangeCodeForSession} with the `code`
   * query param.
   */
  readonly signInWithOAuth: (options: SignInWithOAuthOptions) => Promise<SignInWithOAuthResult>;

  /**
   * Send a magic-link / OTP email. The user clicks the link, the
   * browser arrives at `redirectTo`, and the SDK's
   * `detectSessionInUrl` flag (when enabled on the supplied
   * client) auto-establishes the session.
   */
  readonly signInWithMagicLink: (options: SignInWithMagicLinkOptions) => Promise<void>;

  /**
   * Complete a PKCE-flow sign-in by exchanging the OAuth `code`
   * query param for an active session. Returns the resulting
   * `SessionDto`.
   */
  readonly exchangeCodeForSession: (input: { readonly code: string }) => Promise<SessionDto>;

  /**
   * Sign out the current user — clears the persisted session
   * (when `persistSession: true` on the underlying client) and
   * notifies any registered `onAuthStateChange` listeners.
   */
  readonly signOut: () => Promise<void>;

  /**
   * Read the current session (or `null` if signed out). Returns
   * the public-safe `SessionDto` shape.
   */
  readonly getSession: () => Promise<SessionDto | null>;

  /**
   * Read the current user (or `null` if signed out). Returns
   * the public-safe `UserDto` shape.
   */
  readonly getCurrentUser: () => Promise<UserDto | null>;

  /**
   * Escape hatch: the underlying `SupabaseClient` for callers
   * that need an SDK feature this resource doesn't surface
   * (e.g. `onAuthStateChange`).
   */
  readonly raw: () => SupabaseClient;
}

export interface AuthResourceConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Pre-built supabase client; if omitted, one is built lazily on first use. */
  readonly supabaseAuth?: SupabaseClient;
}

export function makeAuthResource(config: AuthResourceConfig): AuthResource {
  let client: SupabaseClient | undefined = config.supabaseAuth;

  function getClient(): SupabaseClient {
    if (client === undefined) {
      client = createSupabaseClient(config.baseUrl, config.apiKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return client;
  }

  return {
    async signInWithOAuth({ provider, redirectTo, scopes }): Promise<SignInWithOAuthResult> {
      const sb = getClient();
      const sdkOptions: { redirectTo?: string; scopes?: string } = {};
      if (redirectTo !== undefined) sdkOptions.redirectTo = redirectTo;
      if (scopes !== undefined) sdkOptions.scopes = scopes;
      const { data, error } = await sb.auth.signInWithOAuth({
        provider,
        options: sdkOptions,
      });
      if (error !== null) {
        throw wrapSdkError(error.message ?? 'Sign-in via OAuth failed.', error);
      }
      if (data?.url === undefined || data.url === null) {
        throw new ApiAuthError('OAuth response did not include a redirect URL.');
      }
      return { url: data.url };
    },

    async signInWithMagicLink({ email, redirectTo, shouldCreateUser }): Promise<void> {
      const sb = getClient();
      const sdkOptions: { emailRedirectTo?: string; shouldCreateUser?: boolean } = {};
      if (redirectTo !== undefined) sdkOptions.emailRedirectTo = redirectTo;
      if (shouldCreateUser !== undefined) sdkOptions.shouldCreateUser = shouldCreateUser;
      const { error } = await sb.auth.signInWithOtp({ email, options: sdkOptions });
      if (error !== null) {
        throw wrapSdkError(error.message ?? 'Magic-link sign-in failed.', error);
      }
    },

    async exchangeCodeForSession({ code }): Promise<SessionDto> {
      const sb = getClient();
      const { data, error } = await sb.auth.exchangeCodeForSession(code);
      if (error !== null) {
        throw wrapSdkError(error.message ?? 'OAuth code exchange failed.', error);
      }
      const session = data?.session;
      if (session === null || session === undefined) {
        throw new ApiAuthError('Code exchange succeeded but no session was returned.');
      }
      return parseSession(session);
    },

    async signOut(): Promise<void> {
      const sb = getClient();
      const { error } = await sb.auth.signOut();
      if (error !== null) {
        throw wrapSdkError(error.message ?? 'Sign-out failed.', error);
      }
    },

    async getSession(): Promise<SessionDto | null> {
      const sb = getClient();
      const { data, error } = await sb.auth.getSession();
      if (error !== null) {
        throw wrapSdkError(error.message ?? 'getSession failed.', error);
      }
      const session = data?.session;
      if (session === null || session === undefined) return null;
      return parseSession(session);
    },

    async getCurrentUser(): Promise<UserDto | null> {
      const sb = getClient();
      const { data, error } = await sb.auth.getUser();
      if (error !== null) {
        // The SDK returns an error (not null + null) when there is
        // no logged-in user. Treat the canonical "no session" case
        // as `null` rather than as a thrown error.
        if (/session/i.test(error.message ?? '') || /not logged/i.test(error.message ?? '')) {
          return null;
        }
        throw wrapSdkError(error.message ?? 'getUser failed.', error);
      }
      const user = data?.user;
      if (user === null || user === undefined) return null;
      const candidate = {
        id: user.id,
        email: typeof user.email === 'string' ? user.email : null,
        createdAt: user.created_at,
      };
      const parsed = userDto.safeParse(candidate);
      if (!parsed.success) {
        throw new ApiAuthError(
          `Supabase user payload failed userDto validation: ${parsed.error.message}`,
          { cause: parsed.error },
        );
      }
      return parsed.data;
    },

    raw(): SupabaseClient {
      return getClient();
    },
  };
}

interface SessionLike {
  readonly user: { readonly id: string };
  readonly expires_at?: number;
}

function parseSession(session: SessionLike): SessionDto {
  if (session.expires_at === undefined) {
    throw new ApiAuthError('Supabase session is missing expires_at.');
  }
  const expiresAtIso = new Date(session.expires_at * 1000).toISOString();
  const candidate = {
    userId: session.user.id,
    expiresAt: expiresAtIso,
  };
  const parsed = sessionDto.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiAuthError(
      `Supabase session payload failed sessionDto validation: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function wrapSdkError(message: string, cause: unknown): ApiAuthError {
  return new ApiAuthError(message, { cause });
}
