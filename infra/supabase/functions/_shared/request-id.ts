// Request-ID propagation for the Binderly Edge Functions.
//
// Every request that arrives gets a stable identifier that:
//
//   - Is read from the inbound `x-request-id` header when the caller
//     supplies one (typical of api-client → CDN → Edge Function chains
//     where an upstream proxy already minted one).
//   - Is generated server-side via `crypto.randomUUID()` when the
//     header is absent (the api-client doesn't currently mint one for
//     itself, so the Edge Function is usually the origin).
//
// The id is echoed back on every response (success OR error) and is
// included in every log line the function emits, so a single curl /
// browser network-tab observation gives the on-call enough breadcrumb
// to grep the logs.
//
// We intentionally do NOT validate the inbound header against a UUID
// shape — the contract is "opaque correlation id, treat as a string".
// If a caller sends a 200-character message there, we truncate at the
// boundary so a malicious header can't grow the response payload.

const HEADER_NAME = 'x-request-id';
const MAX_LENGTH = 128;

/**
 * Resolve (or mint) the request id for an incoming `Request`. The
 * returned value is suitable for both logging and `Response` header
 * propagation.
 */
export function resolveRequestId(request: Request): string {
  const inbound = request.headers.get(HEADER_NAME);
  if (typeof inbound === 'string' && inbound.length > 0) {
    return inbound.slice(0, MAX_LENGTH);
  }
  return generateRequestId();
}

/**
 * Mint a fresh request id. Exposed for callers that don't have a
 * `Request` in hand (cron jobs, follow-up RPC writes from the same
 * function invocation that want a child id).
 */
export function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Last-resort fallback for runtimes without WebCrypto. Edge Runtime
  // and Node 22 both expose `globalThis.crypto.randomUUID`, so this
  // path is purely defensive.
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Header name constant — exported so test code and CORS layer can
 * reference it without re-declaring the literal.
 */
export const REQUEST_ID_HEADER = HEADER_NAME;
