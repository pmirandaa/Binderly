// Paddle Billing v2 webhook signature verification.
//
// Paddle attaches a `Paddle-Signature` header to every webhook
// delivery. Format:
//
//   ts=1671552777;h1=eb4d0dc8853be92b7f...64db151
//
// The signature is HMAC-SHA256(secret, `${ts}:${rawBody}`) hex-
// encoded. Verification has three steps:
//
//   1. Parse the header into `{ ts, h1 }`.
//   2. Recompute the HMAC over `${ts}:${rawBody}` using
//      `PADDLE_WEBHOOK_SECRET` (server-only env var).
//   3. Compare with `crypto.timingSafeEqual` to avoid timing
//      attacks.
//
// We additionally enforce a configurable timestamp tolerance (5
// minutes by default) so a delayed/replayed webhook doesn't
// process. Paddle Classic uses an entirely different (RSA) scheme
// — this module is intentionally Billing-v2-only; if a Classic
// webhook lands the verification fails closed and the route
// returns 401.
//
// Reference: https://developer.paddle.com/webhooks/about/signature-verification

import { createHmac, timingSafeEqual } from 'node:crypto';

export const PADDLE_SIGNATURE_HEADER = 'paddle-signature';

/** Default tolerance window: 5 minutes either side of `now`. */
export const DEFAULT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export type SignatureFailureReason =
  | 'missing-header'
  | 'malformed-header'
  | 'missing-secret'
  | 'mismatch'
  | 'replay';

export type SignatureVerification =
  | { readonly ok: true; readonly ts: number }
  | { readonly ok: false; readonly reason: SignatureFailureReason };

export interface VerifyPaddleSignatureOptions {
  /**
   * Tolerance window in milliseconds. Requests older than `now -
   * tolerance` or further in the future than `now + tolerance` are
   * rejected as `replay`. Set to `Infinity` to disable (test only).
   */
  readonly toleranceMs?: number;
  /** Test seam — defaults to `Date.now()`. */
  readonly now?: () => number;
}

/**
 * Parse a Paddle signature header into its `{ ts, h1 }` parts.
 * Exported separately so tests can drive the parser directly.
 *
 * Returns `null` for any malformed input.
 */
export function parsePaddleSignatureHeader(header: string): { ts: string; h1: string } | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  const parts = header.split(';');
  let ts: string | null = null;
  let h1: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1') h1 = value;
  }
  if (ts === null || ts.length === 0) return null;
  if (h1 === null || h1.length === 0) return null;
  // Paddle's `ts` is unix seconds; require digits-only.
  if (!/^\d+$/.test(ts)) return null;
  // h1 is hex-encoded SHA-256, so 64 hex chars.
  if (!/^[0-9a-f]{64}$/i.test(h1)) return null;
  return { ts, h1 };
}

/**
 * Verify a Paddle Billing v2 webhook signature. Returns a
 * discriminated union the caller pattern-matches on.
 *
 * `rawBody` MUST be the unmodified bytes Paddle sent — the App
 * Router caller reads `await request.text()` and forwards the
 * string. JSON.parse → JSON.stringify is NOT byte-identical and
 * will fail.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | null | undefined,
  options: VerifyPaddleSignatureOptions = {},
): SignatureVerification {
  if (typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, reason: 'missing-secret' };
  }
  if (typeof header !== 'string' || header.length === 0) {
    return { ok: false, reason: 'missing-header' };
  }

  const parsed = parsePaddleSignatureHeader(header);
  if (parsed === null) {
    return { ok: false, reason: 'malformed-header' };
  }

  const tolerance = options.toleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS;
  const now = (options.now ?? Date.now)();
  const tsMs = Number.parseInt(parsed.ts, 10) * 1000;
  if (Number.isNaN(tsMs)) {
    return { ok: false, reason: 'malformed-header' };
  }
  if (tolerance !== Infinity && Math.abs(now - tsMs) > tolerance) {
    return { ok: false, reason: 'replay' };
  }

  const signedPayload = `${parsed.ts}:${rawBody}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  // Length-pad before timingSafeEqual: it throws when the buffers
  // differ in length and a tampered header could otherwise
  // short-circuit.
  if (expected.length !== parsed.h1.length) {
    return { ok: false, reason: 'mismatch' };
  }
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(parsed.h1.toLowerCase(), 'utf8');
  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, ts: tsMs };
}

/**
 * Test helper — sign a payload with the same scheme Paddle uses.
 * Lets the webhook tests build a valid `Paddle-Signature` header
 * against a synthetic body without copy-pasting hex.
 */
export function signPaddlePayloadForTest(
  rawBody: string,
  secret: string,
  tsSeconds: number,
): string {
  const signed = `${tsSeconds}:${rawBody}`;
  const h1 = createHmac('sha256', secret).update(signed).digest('hex');
  return `ts=${tsSeconds};h1=${h1}`;
}
