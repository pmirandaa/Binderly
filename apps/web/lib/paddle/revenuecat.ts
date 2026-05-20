// RevenueCat REST forwarder.
//
// Per the task brief, Option (a): the Paddle webhook handler calls
// RevenueCat's REST API directly to grant or revoke entitlements
// rather than relying on Paddle ↔ RevenueCat's native integration.
//
// Why direct REST: it's more reliable + we get a per-event audit
// trail in `paddle_webhook_log`. The native integration is a
// follow-on enable-via-env-flag (out-of-scope here).
//
// REST endpoints (RevenueCat v1 REST):
//
//   * Grant promotional entitlement:
//       POST /v1/subscribers/{app_user_id}/entitlements/{entitlement_id}/promotional
//       Body: { duration: 'lifetime' | 'three_year' | 'monthly' | ... }
//       (We use `duration: 'monthly' | 'yearly'` derived from the Paddle
//        plan interval, falling back to `lifetime` for transaction events.)
//   * Revoke promotional entitlements:
//       POST /v1/subscribers/{app_user_id}/subscriptions/{product_id}/revoke
//       — requires a product id. For our use-case we use the simpler
//       `POST /v1/subscribers/{app_user_id}/entitlements/{entitlement_id}/revoke_promotionals`
//       which revokes all promotional entitlements with that id.
//
// All calls: `Authorization: Bearer <REVENUECAT_API_KEY>` and
// `X-Platform: paddle` so RC's UI groups our events under Paddle.
//
// `forwardEntitlement` returns a discriminated union — never throws.
// The webhook handler treats `kind: 'error'` as "log + retry later"
// and still returns 200 to Paddle.

import type { Plan } from './plans';

export type RevenueCatFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface RevenueCatForwardDeps {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Test seam — defaults to global `fetch`. */
  readonly fetch?: RevenueCatFetch;
  /** Test seam — defaults to `Date.now()`. */
  readonly now?: () => number;
}

export interface RevenueCatGrantInput {
  readonly action: 'grant';
  readonly userId: string;
  readonly entitlementId: string;
  readonly plan: Plan;
}

export interface RevenueCatRevokeInput {
  readonly action: 'revoke';
  readonly userId: string;
  readonly entitlementId: string;
}

export type RevenueCatForwardInput = RevenueCatGrantInput | RevenueCatRevokeInput;

export type RevenueCatForwardResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'unconfigured' }
  | {
      readonly kind: 'error';
      readonly status: number | null;
      readonly message: string;
      readonly retryable: boolean;
    };

const PLAN_INTERVAL_TO_DURATION: Record<string, 'monthly' | 'yearly' | 'lifetime'> = {
  monthly: 'monthly',
  annual: 'yearly',
};

/**
 * Forward a Paddle webhook event to RevenueCat as an entitlement
 * grant or revoke. Returns a discriminated result; never throws.
 *
 * `kind: 'unconfigured'` short-circuits when the RC API key is
 * missing — the webhook handler logs `processed: false` + `retry:
 * true` and waits for env to be set in production.
 */
export async function forwardEntitlement(
  input: RevenueCatForwardInput,
  deps: RevenueCatForwardDeps,
): Promise<RevenueCatForwardResult> {
  if (deps.apiKey.length === 0) {
    return { kind: 'unconfigured' };
  }
  const fetchImpl = deps.fetch ?? (globalThis.fetch as RevenueCatFetch | undefined);
  if (typeof fetchImpl !== 'function') {
    return { kind: 'error', status: null, message: 'fetch is not available', retryable: true };
  }

  const url = buildUrl(deps.baseUrl, input);
  const body = buildBody(input);

  let response: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${deps.apiKey}`,
        'X-Platform': 'paddle',
        'X-Is-Sandbox': 'false',
      },
      body,
    });
  } catch (error) {
    return {
      kind: 'error',
      status: null,
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }

  if (response.ok) return { kind: 'ok' };

  const message = await safeText(response);
  // 4xx (except 429) are permanent — bad request, not transient.
  // 429 + 5xx are transient.
  const retryable = response.status === 429 || response.status >= 500;
  return { kind: 'error', status: response.status, message, retryable };
}

function buildUrl(baseUrl: string, input: RevenueCatForwardInput): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const userId = encodeURIComponent(input.userId);
  const entitlementId = encodeURIComponent(input.entitlementId);
  if (input.action === 'grant') {
    return `${trimmed}/v1/subscribers/${userId}/entitlements/${entitlementId}/promotional`;
  }
  return `${trimmed}/v1/subscribers/${userId}/entitlements/${entitlementId}/revoke_promotionals`;
}

function buildBody(input: RevenueCatForwardInput): string {
  if (input.action === 'revoke') {
    return JSON.stringify({});
  }
  const duration = PLAN_INTERVAL_TO_DURATION[input.plan.interval] ?? 'lifetime';
  return JSON.stringify({ duration });
}

async function safeText(response: { text: () => Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable response body>';
  }
}
