// Paddle Billing v2 webhook event mapping.
//
// Single responsibility: take a parsed Paddle webhook payload and
// return what the entitlement layer should do — `grant` or `revoke`
// the active entitlement for a user, or `ignore` (unknown event /
// missing customData / unrecognised price id).
//
// Event verbs we currently handle (per the brief):
//
//   * subscription.created   → grant   (a fresh recurring sub starts pro access)
//   * subscription.activated → grant   (sandbox + production both fire this)
//   * subscription.resumed   → grant   (un-pause re-grants access)
//   * subscription.canceled  → revoke  (user cancels — access ends at period end)
//   * subscription.past_due  → revoke  (payment retry exhausted)
//   * subscription.paused    → revoke  (admin / customer-portal pause)
//   * transaction.completed  → grant   (one-off / lifetime purchase)
//
// Anything else: `kind: 'ignore'` with the verb echoed back so the
// audit log persists exactly what we received.
//
// User identity comes from `customData.userId` — set at checkout
// time by `apps/web/lib/paddle/client.ts`'s `openCheckout()`. If
// it's missing on a webhook (e.g. a user purchased through
// Paddle's customer portal directly), we surface the event as
// `kind: 'ignore'` with `reason: 'missing-userId'` so the
// reconciliation job can flag it for a manual operator pass.
//
// Note: this module is **pure** and side-effect free. No network,
// no DB, no env. Tests drive it with synthetic payloads.

import { resolveEntitlementForPriceId } from './plans';

import type { Plan, PaddlePriceIds } from './plans';

/** Paddle event verbs we know about. Strings on purpose — Paddle
 *  may add new verbs over time; the handler tolerates unknown
 *  values via the `unknown` fallthrough below. */
export type KnownPaddleEventType =
  | 'subscription.created'
  | 'subscription.activated'
  | 'subscription.resumed'
  | 'subscription.canceled'
  | 'subscription.past_due'
  | 'subscription.paused'
  | 'transaction.completed';

const GRANT_EVENT_TYPES: ReadonlySet<string> = new Set<KnownPaddleEventType>([
  'subscription.created',
  'subscription.activated',
  'subscription.resumed',
  'transaction.completed',
]);

const REVOKE_EVENT_TYPES: ReadonlySet<string> = new Set<KnownPaddleEventType>([
  'subscription.canceled',
  'subscription.past_due',
  'subscription.paused',
]);

/**
 * Minimum-viable shape of a parsed Paddle Billing v2 webhook body.
 * We don't depend on every nested field — the Paddle SDK ships its
 * own types; this is the narrowed view our webhook handler reads.
 */
export interface RawPaddleEvent {
  readonly event_id?: string;
  readonly event_type?: string;
  readonly occurred_at?: string;
  readonly data?: RawPaddleEventData;
}

export interface RawPaddleEventData {
  readonly id?: string;
  readonly status?: string;
  readonly custom_data?: Record<string, unknown> | null;
  /** Subscription events; one entry per recurring item. */
  readonly items?: ReadonlyArray<RawPaddleSubscriptionItem>;
  /** Transaction events; the line items live under `details.line_items`. */
  readonly details?: { line_items?: ReadonlyArray<RawPaddleLineItem> };
  /** ISO-8601 expiry (`current_billing_period.ends_at`); optional. */
  readonly current_billing_period?: { ends_at?: string };
  readonly canceled_at?: string;
  readonly paused_at?: string;
}

export interface RawPaddleSubscriptionItem {
  readonly price?: { id?: string };
  readonly status?: string;
}

export interface RawPaddleLineItem {
  readonly price_id?: string;
  readonly price?: { id?: string };
}

export interface MappedEvent {
  readonly eventId: string | null;
  readonly eventType: string;
  readonly occurredAt: string | null;
  readonly action: 'grant' | 'revoke' | 'ignore';
  readonly userId: string | null;
  readonly priceId: string | null;
  readonly entitlementId: string | null;
  readonly plan: Plan | null;
  readonly expiresAt: string | null;
  /** Short reason for the audit log when `action = 'ignore'`. */
  readonly ignoreReason: IgnoreReason | null;
}

export type IgnoreReason =
  | 'unknown-event-type'
  | 'missing-user-id'
  | 'unknown-price-id'
  | 'missing-price-id';

/** UUID v1–v8 lower-case. Paddle's customData is opaque text → we
 *  defensively check the string looks like the Supabase `auth.uid()`
 *  format before forwarding to RevenueCat. Rejecting non-uuids here
 *  makes the webhook more robust to clients that hand-craft
 *  customData in the wrong shape. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapPaddleEvent(event: RawPaddleEvent, prices: PaddlePriceIds): MappedEvent {
  const eventId = optionalString(event.event_id);
  const eventType = optionalString(event.event_type) ?? '';
  const occurredAt = optionalString(event.occurred_at);

  if (!GRANT_EVENT_TYPES.has(eventType) && !REVOKE_EVENT_TYPES.has(eventType)) {
    return baseIgnore(eventId, eventType, occurredAt, 'unknown-event-type');
  }

  const userId = extractUserId(event.data?.custom_data);
  if (userId === null) {
    return baseIgnore(eventId, eventType, occurredAt, 'missing-user-id');
  }

  const priceId = extractPriceId(event);
  if (priceId === null) {
    return baseIgnore(eventId, eventType, occurredAt, 'missing-price-id');
  }

  const resolved = resolveEntitlementForPriceId(priceId, prices);
  if (resolved === null) {
    return {
      eventId,
      eventType,
      occurredAt,
      action: 'ignore',
      userId,
      priceId,
      entitlementId: null,
      plan: null,
      expiresAt: null,
      ignoreReason: 'unknown-price-id',
    };
  }

  const action: 'grant' | 'revoke' = GRANT_EVENT_TYPES.has(eventType) ? 'grant' : 'revoke';
  const expiresAt = optionalString(event.data?.current_billing_period?.ends_at);

  return {
    eventId,
    eventType,
    occurredAt,
    action,
    userId,
    priceId,
    entitlementId: resolved.entitlementId,
    plan: resolved.plan,
    expiresAt,
    ignoreReason: null,
  };
}

function baseIgnore(
  eventId: string | null,
  eventType: string,
  occurredAt: string | null,
  reason: IgnoreReason,
): MappedEvent {
  return {
    eventId,
    eventType,
    occurredAt,
    action: 'ignore',
    userId: null,
    priceId: null,
    entitlementId: null,
    plan: null,
    expiresAt: null,
    ignoreReason: reason,
  };
}

function extractUserId(customData: Record<string, unknown> | null | undefined): string | null {
  if (customData === null || customData === undefined) return null;
  const candidate = customData['userId'];
  if (typeof candidate !== 'string') return null;
  if (!UUID_RE.test(candidate)) return null;
  return candidate.toLowerCase();
}

function extractPriceId(event: RawPaddleEvent): string | null {
  const items = event.data?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const priceId = item.price?.id;
      if (typeof priceId === 'string' && priceId.length > 0) return priceId;
    }
  }
  const lineItems = event.data?.details?.line_items;
  if (Array.isArray(lineItems)) {
    for (const item of lineItems) {
      const priceId =
        typeof item.price_id === 'string' && item.price_id.length > 0
          ? item.price_id
          : typeof item.price?.id === 'string' && item.price.id.length > 0
            ? item.price.id
            : null;
      if (priceId !== null) return priceId;
    }
  }
  return null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const __EVENT_TYPE_SETS_FOR_TEST = {
  grant: GRANT_EVENT_TYPES,
  revoke: REVOKE_EVENT_TYPES,
};
