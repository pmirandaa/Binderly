// Typed auth-error class for @binderly/auth.
//
// Matches the error-shape convention from `context/conventions.md`
// § "Error handling": internal helpers throw typed errors; top-level
// handlers (Edge Function entry points, Route Handlers) catch and
// translate into the `{ ok: false, error: { code, message } }`
// discriminated union the API surface ships.
//
// We deliberately do NOT re-export Supabase's own `AuthError` class
// here — that's the SDK's internal taxonomy (HTTP status, GoTrue
// codes). Callers that need it should import from
// `@supabase/supabase-js` directly. The `code` field on this class is
// our app-level taxonomy and is stable across SDK upgrades.

/**
 * Stable error codes server-side auth helpers throw. Top-level
 * handlers map these to HTTP status codes and to the discriminated
 * union the API ships:
 *
 *   missing_token       → 401, `{ code: 'unauthenticated' }`
 *   invalid_token       → 401, `{ code: 'unauthenticated' }`
 *   expired_token       → 401, `{ code: 'session_expired' }`
 *   no_profile          → 500, `{ code: 'internal' }` (trigger should
 *                          have created it; if it didn't, that's a
 *                          server-side bug, not a client error)
 *   service_unavailable → 503, `{ code: 'service_unavailable' }`
 *                          (Supabase upstream timeout / 5xx)
 */
export type AuthErrorCode =
  | 'missing_token'
  | 'invalid_token'
  | 'expired_token'
  | 'no_profile'
  | 'service_unavailable';

export interface AuthErrorJSON {
  readonly name: 'AuthError';
  readonly code: AuthErrorCode;
  readonly message: string;
}

/**
 * A typed error class server-side auth helpers throw. Use the
 * `code` field to branch in catch blocks; never inspect `message`
 * to drive control flow (it's human-readable, not a contract).
 *
 * ```ts
 * try {
 *   const session = await requireUser(request, env);
 *   // ...
 * } catch (error) {
 *   if (error instanceof AuthError && error.code === 'expired_token') {
 *     return new Response('refresh', { status: 401 });
 *   }
 *   throw error;
 * }
 * ```
 */
export class AuthError extends Error {
  public override readonly name = 'AuthError';
  public readonly code: AuthErrorCode;

  public constructor(code: AuthErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    // Preserve the V8 stack trace if available; safe no-op elsewhere.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AuthError);
    }
  }

  public toJSON(): AuthErrorJSON {
    return { name: this.name, code: this.code, message: this.message };
  }
}

/** Narrow `unknown` to {@link AuthError}; the Node-y `instanceof` works across realms here too. */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
