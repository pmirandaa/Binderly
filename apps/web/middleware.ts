// Next.js middleware skeleton.
//
// T-W-AUTH owns the actual session-refresh / protected-route logic
// — this file just registers the middleware so feature tasks can
// drop their checks in without restructuring the app. For now it
// only adds a request-id header so server logs can correlate with
// the response, matching the convention `@binderly/api-client`
// reads (`x-request-id`).

import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

const REQUEST_ID_HEADER = 'x-request-id';

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming !== null && incoming.length > 0 ? incoming : generateRequestId();
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
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
  // through the middleware so feature tasks can layer auth on top.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
