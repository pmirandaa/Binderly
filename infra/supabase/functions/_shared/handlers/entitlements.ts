// Handler for `GET /v1/me/entitlements`.
//
// The canonical *read* path for entitlement state. RevenueCat is the
// source of truth (Paddle webhooks feed it on web, the mobile SDK feeds
// it on device); this endpoint reads it server-side and returns the
// unified DTO web + mobile gate on.
//
// Returns `entitlementsDto` (mirror of
// `@binderly/api-contracts/src/entitlements.ts`):
//
//   { tier: 'free' | 'pro',
//     activeFeatures: PaidFeature[],
//     source: 'revenuecat' | 'fallback',
//     checkedAt: string /* ISO-8601 */ }
//
// ── Why this logic is mirrored, not imported ────────────────────────
// The production deploy bundles ONLY the edge-function source + the
// `deno.jsonc` import-map (`zod`, `@supabase/supabase-js`). It cannot
// import workspace packages, so the small RC read + canonical feature
// model from `@binderly/entitlements` is mirrored here — exactly like
// `_shared/contracts.ts` mirrors `@binderly/api-contracts`. The
// `entitlements.test.ts` parity block pins this mirror against the
// canonical PROJECT.md § 16 list so it can't silently drift.
//
// ── Fail-closed / env-degrade posture ───────────────────────────────
// This handler NEVER returns 500 for an entitlement read:
//   - `REVENUECAT_SECRET_API_KEY` unset → free tier, source 'fallback',
//     200, logged warning. (dev / not-yet-provisioned environments.)
//   - RC network error / non-200 / malformed body → free, 'fallback', 200.
//   - A brand-new user with no RC subscriber → RC returns an empty
//     subscriber (200) → free, source 'revenuecat'.
// Auth still fails closed: an anonymous caller gets the standard 401
// from `requireUser`.

import { apiOk } from '../errors.ts';
import { requireUser } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFetch, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

type Tier = 'free' | 'pro';
type EntitlementSource = 'revenuecat' | 'fallback';

/**
 * Canonical pro-only feature surface (PROJECT.md § 16). Mirror of
 * `@binderly/entitlements`'s `ALL_PAID_FEATURES`. Keep in lockstep.
 */
export const PAID_FEATURES = [
  'stack_scanner',
  'grading_prediction',
  'unlimited_custom_collections',
  'save_smart_collections',
  'unlimited_shareables',
  'shareable_themes',
  'pricing_history',
  'export_data',
  'cloud_ai_scan',
] as const;

const PRO_ENTITLEMENT_ID = 'pro';
const REVENUECAT_API_BASE_URL = 'https://api.revenuecat.com';

interface EntitlementsResult {
  readonly tier: Tier;
  readonly activeFeatures: readonly string[];
  readonly source: EntitlementSource;
  readonly checkedAt: string;
}

export async function handleGetMyEntitlements(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  // Auth first — fail closed for anonymous callers (standard 401).
  const session = await requireUser(request, ctx.env, ctx.deps);
  const appUserId = session.user.id;

  const result = await resolveEntitlements(appUserId, ctx);
  // Always 200 — entitlement reads degrade, they never 500.
  return apiOk(request, ctx.cors, ctx.requestId, result);
}

/**
 * Resolve a user's entitlement state, fail-closing to free tier on any
 * problem. Exported for direct unit testing.
 */
export async function resolveEntitlements(
  appUserId: string,
  ctx: HandlerContext,
  now: () => number = Date.now,
): Promise<EntitlementsResult> {
  const checkedAt = new Date(now()).toISOString();
  const apiKey = ctx.env.revenueCatSecretApiKey;

  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    console.warn(
      '[entitlements] REVENUECAT_SECRET_API_KEY is not set — degrading to free tier (fallback).',
    );
    return freeFallback(checkedAt);
  }

  const fetchImpl = ctx.deps?.fetch ?? (globalThis.fetch as EdgeFetch | undefined);
  if (typeof fetchImpl !== 'function') {
    console.warn('[entitlements] fetch unavailable — degrading to free tier (fallback).');
    return freeFallback(checkedAt);
  }

  const baseUrl = trimTrailingSlash(ctx.env.revenueCatApiBaseUrl ?? REVENUECAT_API_BASE_URL);
  const url = `${baseUrl}/v1/subscribers/${encodeURIComponent(appUserId)}`;

  let response: Awaited<ReturnType<EdgeFetch>>;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'X-Platform': 'server',
      },
    });
  } catch (cause) {
    console.warn(`[entitlements] RevenueCat request failed: ${messageOf(cause)} — fallback.`);
    return freeFallback(checkedAt);
  }

  if (!response.ok) {
    console.warn(`[entitlements] RevenueCat returned ${response.status} — fallback.`);
    return freeFallback(checkedAt);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch (cause) {
    console.warn(`[entitlements] RevenueCat body not valid JSON: ${messageOf(cause)} — fallback.`);
    return freeFallback(checkedAt);
  }

  const tier: Tier = isProEntitlementActive(parsed, now()) ? 'pro' : 'free';
  return {
    tier,
    activeFeatures: tier === 'pro' ? [...PAID_FEATURES] : [],
    source: 'revenuecat',
    checkedAt,
  };
}

/**
 * Decide whether the `pro` entitlement is active in a parsed RC
 * subscriber payload. Active iff present AND (`expires_date` null/absent
 * OR strictly-future). Mirror of `@binderly/entitlements`'s
 * `isProEntitlementActive`. Exported for unit testing.
 */
export function isProEntitlementActive(payload: unknown, nowMs: number): boolean {
  const subscriber = getObject(payload, 'subscriber');
  if (subscriber === null) return false;
  const entitlements = getObject(subscriber, 'entitlements');
  if (entitlements === null) return false;
  const pro = getObject(entitlements, PRO_ENTITLEMENT_ID);
  if (pro === null) return false;

  const expiresRaw = pro['expires_date'];
  if (expiresRaw === null || expiresRaw === undefined) return true;
  if (typeof expiresRaw !== 'string') return false;
  const expiresMs = Date.parse(expiresRaw);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs > nowMs;
}

function freeFallback(checkedAt: string): EntitlementsResult {
  return { tier: 'free', activeFeatures: [], source: 'fallback', checkedAt };
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
