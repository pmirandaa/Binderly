// Next.js middleware.
//
// Layered behaviour:
//   1. Best-effort auth gate: if the request is for a route in
//      PROTECTED_PREFIXES and the browser does NOT carry a
//      Supabase auth cookie, respond with a 307 redirect to
//      `/auth/sign-in?next=<original>`.
//   2. Always: stamp / preserve `x-request-id` so server logs
//      correlate with `@binderly/api-client` calls.
//
// This is **defence in depth**, not a definitive auth check.
// The Supabase JS singleton persists sessions to localStorage
// by default, which is invisible to edge middleware. The
// definitive gate is the `<ProtectedRoute>` wrapper that runs
// in the browser. The middleware just avoids the worst-case
// flash-of-protected-content for users who arrived without
// any session cookie at all (`@supabase/ssr`-cookie consumers
// or future cookie-only flows).

import { NextResponse } from 'next/server';

import { buildSignInUrl } from './lib/auth/redirect';

import type { NextRequest } from 'next/server';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Path prefixes that require an authenticated session. Keep
 * this list short: only routes that have no useful anonymous
 * surface should appear here. Public routes (browse, sets,
 * shareables) stay open.
 */
export const PROTECTED_PREFIXES: readonly string[] = ['/collection', '/profile'] as const;

/** Cookie-name regex matching `@supabase/ssr` and the SDK's
 * cookie-storage adapter (`sb-<project-ref>-auth-token`). */
const SUPABASE_AUTH_COOKIE_RE = /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i;

export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl?.pathname ?? '';
  const search = request.nextUrl?.search ?? '';
  const isProtected = isProtectedPath(pathname);
  const hasSession = hasSupabaseAuthCookie(request);

  if (isProtected && !hasSession) {
    const next = `${pathname}${search}`;
    const target = buildSignInUrl(next);
    const url = request.nextUrl?.clone() ?? new URL(target, 'http://localhost');
    url.pathname = '/auth/sign-in';
    url.search = '';
    if (target.includes('?')) {
      const query = target.split('?')[1] ?? '';
      url.search = query.length > 0 ? `?${query}` : '';
    }
    const response = NextResponse.redirect(url, 307);
    stampRequestId(request, response);
    return response;
  }

  const response = NextResponse.next();
  stampRequestId(request, response);
  return response;
}

function isProtectedPath(pathname: string): boolean {
  if (pathname === '') return false;
  for (const prefix of PROTECTED_PREFIXES) {
    if (pathname === prefix) return true;
    if (pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  const cookies = request.cookies;
  if (cookies === undefined) return false;
  // `getAll()` is the modern API; iterate to find a Supabase
  // auth-token cookie. Tolerant of cookie chunking (`-auth-token.0`,
  // `-auth-token.1`, …) used by `@supabase/ssr` for large
  // sessions.
  if (typeof (cookies as { getAll?: () => Array<{ name: string }> }).getAll === 'function') {
    const all = (cookies as { getAll: () => Array<{ name: string }> }).getAll();
    return all.some((c) => SUPABASE_AUTH_COOKIE_RE.test(c.name));
  }
  return false;
}

function stampRequestId(request: NextRequest, response: NextResponse): void {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming !== null && incoming.length > 0 ? incoming : generateRequestId();
  response.headers.set(REQUEST_ID_HEADER, requestId);
}

function generateRequestId(): string {
  // crypto.randomUUID is available in the Edge runtime + modern
  // browsers + Node 19+. Fall back to a timestamp+rand string if
  // missing (very old runtimes).
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID !== undefined) return cryptoRef.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const config = {
  // Skip Next.js internals + static assets; everything else flows
  // through the middleware.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
