// RevenueCat REST read client — the canonical entitlement *read* path.
//
// RevenueCat is the source of truth for entitlement state. The mobile
// SDK reads it client-side; on the server (the `/v1/me/entitlements`
// edge function) and anywhere else that needs an authoritative answer,
// we read it via RC's REST API:
//
//   GET https://api.revenuecat.com/v1/subscribers/{app_user_id}
//   Authorization: Bearer <REVENUECAT_SECRET_API_KEY>
//
// The response carries `subscriber.entitlements`, a map keyed by
// entitlement identifier. We look for `pro` and treat it as active iff
// it is present AND its `expires_date` is null (lifetime/promotional)
// or in the future. RC strips most expired entitlements server-side,
// but we re-check `expires_date` defensively (clock skew, grace
// periods, promotional grants).
//
// ── Fail-closed design ──────────────────────────────────────────────
// This client NEVER throws. Any failure — missing/empty key, network
// error, non-200 status, unparseable body, unexpected shape — resolves
// to `{ tier: 'free', source: 'fallback', activeFeatures: [], error }`.
// Rationale: an RC outage must degrade to *free* tier, not unlock paid
// features and not crash the request. Paid features are the safe thing
// to withhold; locking a paying user out for a few seconds during an RC
// blip is strictly better than (a) a 500 that breaks the whole app or
// (b) silently granting pro to everyone. A brand-new user with no RC
// subscriber record reads as free for the same reason (RC's GET
// subscriber endpoint lazily returns an empty subscriber, so no
// explicit create step is required — see README § "New users").

import { canUseFeature } from './can.js';
import { ALL_PAID_FEATURES, type EntitlementSource, type PaidFeature, type Tier } from './model.js';

/** Default RevenueCat REST base URL. Overridable for tests / proxies. */
export const REVENUECAT_API_BASE_URL = 'https://api.revenuecat.com';

/** The entitlement key we read. Mirrors `PRO_ENTITLEMENT_ID`. */
const PRO_KEY = 'pro';

/**
 * Minimal `Response` shape this client touches. `globalThis.fetch`'s
 * `Response` satisfies it; tests pass a stub of the same shape. We read
 * the body as text and `JSON.parse` ourselves so a malformed payload is
 * a catchable parse error rather than an unhandled `.json()` reject.
 */
export interface RevenueCatFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/**
 * The `fetch`-like callable this client depends on. Declared locally so
 * the package doesn't depend on `lib.dom` (it runs in Node, RN, and the
 * Deno edge runtime too).
 */
export type RevenueCatFetch = (
  input: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<RevenueCatFetchResponse>;

/** Options for {@link readEntitlement}. */
export interface ReadEntitlementOptions {
  /** RevenueCat **secret** API key. Empty/missing → fail-closed to free. */
  readonly apiKey: string;
  /**
   * The RC `app_user_id`. Per T-PB-REVENUECAT's contract this is the
   * Supabase user id (RC `appUserID` === Supabase `auth.users.id`).
   */
  readonly appUserId: string;
  /** REST base URL. Defaults to {@link REVENUECAT_API_BASE_URL}. */
  readonly baseUrl?: string;
  /** Test seam — defaults to `globalThis.fetch`. */
  readonly fetch?: RevenueCatFetch;
  /** Test seam for "now" — defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Resolved entitlement read. `source` distinguishes an authoritative RC
 * answer from a fail-closed fallback; `error` is populated only on the
 * fallback path (for logging — never surfaced to end users).
 */
export interface EntitlementReadResult {
  readonly tier: Tier;
  readonly activeFeatures: readonly PaidFeature[];
  readonly source: EntitlementSource;
  /** ISO-8601 timestamp of when the read was resolved. */
  readonly checkedAt: string;
  /** Set only when `source === 'fallback'`. */
  readonly error?: string;
}

/**
 * Read a user's entitlement state from RevenueCat. Never throws —
 * resolves to a fail-closed free-tier result on any error.
 */
export async function readEntitlement(
  options: ReadEntitlementOptions,
): Promise<EntitlementReadResult> {
  const now = options.now ?? Date.now;
  const checkedAt = new Date(now()).toISOString();

  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
    return fallback(checkedAt, 'RevenueCat secret API key is not configured.');
  }
  if (typeof options.appUserId !== 'string' || options.appUserId.length === 0) {
    return fallback(checkedAt, 'app_user_id is required to read entitlements.');
  }

  const fetchImpl = options.fetch ?? (globalThis.fetch as RevenueCatFetch | undefined);
  if (typeof fetchImpl !== 'function') {
    return fallback(checkedAt, 'fetch is not available in this runtime.');
  }

  const baseUrl = options.baseUrl ?? REVENUECAT_API_BASE_URL;
  const url = `${trimTrailingSlash(baseUrl)}/v1/subscribers/${encodeURIComponent(options.appUserId)}`;

  let response: RevenueCatFetchResponse;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: 'application/json',
        'X-Platform': 'server',
      },
    });
  } catch (cause) {
    return fallback(checkedAt, `RevenueCat request failed: ${messageOf(cause)}`);
  }

  if (!response.ok) {
    const body = await safeText(response);
    return fallback(
      checkedAt,
      `RevenueCat returned ${response.status}: ${truncate(body, 200)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch (cause) {
    return fallback(checkedAt, `RevenueCat response was not valid JSON: ${messageOf(cause)}`);
  }

  const proActive = isProEntitlementActive(parsed, now());
  const tier: Tier = proActive ? 'pro' : 'free';
  return {
    tier,
    activeFeatures: featuresForTier(tier),
    source: 'revenuecat',
    checkedAt,
  };
}

/**
 * Derive the active feature list for a tier from the canonical model.
 * Pure; exported for the edge function so the DTO's `activeFeatures` is
 * computed from the same source of truth as `canUseFeature`.
 */
export function featuresForTier(tier: Tier): readonly PaidFeature[] {
  return ALL_PAID_FEATURES.filter((feature) => canUseFeature(tier, feature));
}

/**
 * Inspect a parsed RC subscriber payload and decide whether the `pro`
 * entitlement is active. Active iff:
 *   - `subscriber.entitlements.pro` exists, AND
 *   - its `expires_date` is null/absent (lifetime/promo) OR parses to a
 *     timestamp strictly in the future relative to `nowMs`.
 *
 * Defensive against every shape deviation: a non-object payload, a
 * missing `subscriber`/`entitlements`, a non-object entitlement, or an
 * unparseable `expires_date` (treated as expired → not active).
 *
 * Exported for direct unit testing of the parse logic.
 */
export function isProEntitlementActive(payload: unknown, nowMs: number): boolean {
  const subscriber = getObject(payload, 'subscriber');
  if (subscriber === null) return false;
  const entitlements = getObject(subscriber, 'entitlements');
  if (entitlements === null) return false;
  const pro = getObject(entitlements, PRO_KEY);
  if (pro === null) return false;

  const expiresRaw = (pro as Record<string, unknown>)['expires_date'];
  // Lifetime / non-expiring promotional grants carry a null expiry.
  if (expiresRaw === null || expiresRaw === undefined) return true;
  if (typeof expiresRaw !== 'string') return false;
  const expiresMs = Date.parse(expiresRaw);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs > nowMs;
}

// ── internals ──────────────────────────────────────────────────────

function fallback(checkedAt: string, error: string): EntitlementReadResult {
  return {
    tier: 'free',
    activeFeatures: [],
    source: 'fallback',
    checkedAt,
    error,
  };
}

function getObject(value: unknown, key: string): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const child = (value as Record<string, unknown>)[key];
  if (typeof child !== 'object' || child === null) return null;
  return child as Record<string, unknown>;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function safeText(response: RevenueCatFetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable response body>';
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
