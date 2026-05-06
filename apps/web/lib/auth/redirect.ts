// Tiny URL helpers for the `/auth/sign-in?next=…` round-trip.
//
// Three concerns live here so the rest of the auth surface
// (sign-in page, callback page, ProtectedRoute, middleware)
// can call into one consistent shape:
//
//   - `safeNext`: harden against open-redirect inputs. Anything
//     that's not an in-app absolute path falls back to the
//     home route (`/`).
//   - `extractNext`: pull `?next=` off a URLSearchParams instance
//     and run it through `safeNext`.
//   - `buildSignInUrl`: produce `/auth/sign-in?next=<encoded>`
//     for callers that want to redirect (middleware,
//     `<ProtectedRoute>`).

export const SIGN_IN_PATH = '/auth/sign-in';
export const DEFAULT_POST_AUTH_PATH = '/';

/**
 * Sanitise a `next` value to a safe in-app path. Returns
 * {@link DEFAULT_POST_AUTH_PATH} when:
 *   - the value is missing or empty
 *   - the value is not a string
 *   - the value is an absolute URL (`http://`, `https://`,
 *     `//host`) — open-redirect guard
 *   - the value contains a backslash, control char, or
 *     newline (defence-in-depth against tricky encodings)
 *
 * The returned path always starts with a single `/`.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return DEFAULT_POST_AUTH_PATH;
  }
  if (/[\r\n\t]/.test(value)) return DEFAULT_POST_AUTH_PATH;
  if (value.includes('\\')) return DEFAULT_POST_AUTH_PATH;
  // Reject protocol-relative (`//host`) and absolute (`https://`) URLs.
  if (value.startsWith('//')) return DEFAULT_POST_AUTH_PATH;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return DEFAULT_POST_AUTH_PATH;
  if (!value.startsWith('/')) return DEFAULT_POST_AUTH_PATH;
  return value;
}

/**
 * Extract a sanitised `next` value from a `URLSearchParams`-like
 * object. Returns {@link DEFAULT_POST_AUTH_PATH} when the param
 * is missing or fails {@link safeNext}.
 */
export function extractNext(
  searchParams: { get: (key: string) => string | null } | null | undefined,
): string {
  if (searchParams === null || searchParams === undefined) {
    return DEFAULT_POST_AUTH_PATH;
  }
  return safeNext(searchParams.get('next'));
}

/**
 * Build a sign-in URL that preserves the destination the user
 * was trying to reach. Caller is responsible for treating the
 * return value as relative — both Next's `router.replace` and
 * the middleware's `NextResponse.redirect(new URL(..., origin))`
 * accept relative paths.
 */
export function buildSignInUrl(next: string | null | undefined): string {
  const safe = safeNext(next);
  if (safe === DEFAULT_POST_AUTH_PATH) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(safe)}`;
}
