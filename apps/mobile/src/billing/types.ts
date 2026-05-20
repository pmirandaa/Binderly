// Strict billing types for the mobile module.
//
// We re-export the RevenueCat `PurchasesOffering` / `PurchasesPackage`
// / `CustomerInfo` / `PurchasesEntitlementInfo` shapes as the
// canonical contract feature screens consume — they're already
// strict and serialisable. Around those, we layer a few binderly-
// owned types:
//
//   - `Tier`: the derived `'free' | 'pro'` flag that downstream
//     gates read.
//   - `PaidFeature`: the v1 named-feature surface T-PB-GATING will
//     thread through `usePaidFeature(feature)`.
//   - `PurchaseResult`: discriminated union returned from
//     `purchasePackage(pkg)`, splitting RevenueCat's error/cancel
//     branches into JS-friendly variants.
//   - `EntitlementsSnapshot`: the `useEntitlementsQuery()` payload.
//   - `OfferingsSnapshot`: the `useOfferings()` payload (always
//     present so callers can branch on `current === null` as a
//     dev-mode sentinel without juggling Query loading flags).
//
// Keeping these here (rather than scattered across `init.ts` /
// `entitlements.ts` / `purchase.ts`) makes the public contract
// one-file-grep-able for T-PB-PADDLE and T-PB-ENTITLEMENTS
// reviewers.

import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';

export type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
};

// ============================================================
// Entitlement identifier contract
// ============================================================
//
// RevenueCat's "entitlement" abstraction is the cross-store, cross-
// platform identifier we key on. Per `rules/10-paywall-billing.md`
// we use the string `'pro'`.
//
// **CONTRACT FOR T-PB-PADDLE (parallel worker):** Paddle's
// webhook-side grant logic on web must grant the same RC
// entitlement identifier when a Paddle subscription is created /
// renewed (RC's Paddle integration handles this automatically when
// the Paddle products are mapped to the `pro` entitlement in the
// RevenueCat dashboard). Both T-PB-PADDLE and the future
// T-PB-ENTITLEMENTS service read this same string.

/** The RevenueCat entitlement identifier that unlocks all paid features. */
export const PRO_ENTITLEMENT_ID = 'pro' as const;
export type ProEntitlementId = typeof PRO_ENTITLEMENT_ID;

// ============================================================
// Derived tier + paid-feature surface
// ============================================================

/** Pricing tier derived from active RevenueCat entitlements. */
export type Tier = 'free' | 'pro';

/**
 * Names of paid features `usePaidFeature(...)` exposes. Initial v1
 * surface drawn from `PROJECT.md § 16` (Freemium plan). Adding a
 * new feature here is a strict-type widening, so T-PB-GATING gets
 * a compile error on unknown features rather than silently
 * granting them.
 */
export type PaidFeature =
  | 'unlimited_custom_collections'
  | 'unlimited_shareables'
  | 'stack_scanner'
  | 'grading_prediction'
  | 'pricing_graphs'
  | 'export_csv'
  | 'remove_branding'
  | 'cloud_ai_scan_fallback';

/** Allow `PaidFeature` consumers to enumerate every paid surface. */
export const ALL_PAID_FEATURES: readonly PaidFeature[] = [
  'unlimited_custom_collections',
  'unlimited_shareables',
  'stack_scanner',
  'grading_prediction',
  'pricing_graphs',
  'export_csv',
  'remove_branding',
  'cloud_ai_scan_fallback',
] as const;

// ============================================================
// Hook payloads
// ============================================================

export interface EntitlementsSnapshot {
  /**
   * Map of every entitlement RevenueCat currently considers active
   * for this user, keyed by entitlement identifier. Empty when the
   * user is on the free tier.
   */
  readonly activeEntitlements: Readonly<Record<string, PurchasesEntitlementInfo>>;
  /** Derived `'free' | 'pro'` flag. */
  readonly tier: Tier;
  /**
   * The full RevenueCat `CustomerInfo` blob the snapshot was
   * derived from, or `null` in dev-mode (no SDK configured).
   * Surfaced for advanced consumers (T-PB-ENTITLEMENTS) that need
   * `originalAppUserId`, `latestExpirationDate`, etc.
   */
  readonly customerInfo: CustomerInfo | null;
}

/**
 * `useOfferings()` payload. `current === null` is the dev-mode
 * sentinel (no RC keys configured); paywall UIs should hide
 * themselves in that branch.
 */
export interface OfferingsSnapshot {
  /** Current offering RC selected for the user, or `null` in dev-mode. */
  readonly current: PurchasesOffering | null;
  /** Every configured offering keyed by identifier (empty in dev-mode). */
  readonly all: Readonly<Record<string, PurchasesOffering>>;
}

// ============================================================
// Purchase result discriminated union
// ============================================================

/** Successful purchase — the user now holds `entitlementId`. */
export interface PurchaseSuccess {
  readonly kind: 'success';
  /** The RC entitlement id that became active (e.g. `'pro'`). */
  readonly entitlementId: string;
  /** The product id the user actually bought. */
  readonly productIdentifier: string;
  /** Full updated customer info — feeds the entitlements cache. */
  readonly customerInfo: CustomerInfo;
}

/** User explicitly cancelled the native purchase sheet. Not an error. */
export interface PurchaseCancelled {
  readonly kind: 'cancelled';
}

/**
 * Google Play "payment pending" — purchase will be confirmed via a
 * separate flow (e.g. cash deposit). Treat as not-yet-active.
 */
export interface PurchasePending {
  readonly kind: 'payment_pending';
  readonly message: string;
}

/**
 * Receipt was malformed / payment rejected / fraud detected. UI
 * should ask the user to try a different payment method.
 */
export interface PurchasePaymentInvalid {
  readonly kind: 'payment_invalid';
  readonly message: string;
}

/** Transient network failure. Caller can retry. */
export interface PurchaseNetworkError {
  readonly kind: 'network_error';
  readonly message: string;
}

/** Anything else: store outage, config error, unknown SDK error. */
export interface PurchaseUnknownError {
  readonly kind: 'error';
  readonly message: string;
}

export type PurchaseResult =
  | PurchaseSuccess
  | PurchaseCancelled
  | PurchasePending
  | PurchasePaymentInvalid
  | PurchaseNetworkError
  | PurchaseUnknownError;

// ============================================================
// Type guards (so feature screens read cleanly)
// ============================================================

export function isPurchaseSuccess(result: PurchaseResult): result is PurchaseSuccess {
  return result.kind === 'success';
}
export function isPurchaseCancelled(result: PurchaseResult): result is PurchaseCancelled {
  return result.kind === 'cancelled';
}
export function isPurchasePending(result: PurchaseResult): result is PurchasePending {
  return result.kind === 'payment_pending';
}
export function isPurchasePaymentInvalid(
  result: PurchaseResult,
): result is PurchasePaymentInvalid {
  return result.kind === 'payment_invalid';
}
export function isPurchaseNetworkError(
  result: PurchaseResult,
): result is PurchaseNetworkError {
  return result.kind === 'network_error';
}
export function isPurchaseUnknownError(
  result: PurchaseResult,
): result is PurchaseUnknownError {
  return result.kind === 'error';
}

// ============================================================
// Restore result
// ============================================================

export interface RestoreSuccess {
  readonly kind: 'success';
  readonly tier: Tier;
  readonly customerInfo: CustomerInfo;
}

export interface RestoreError {
  readonly kind: 'error';
  readonly message: string;
}

export type RestoreResult = RestoreSuccess | RestoreError;

export function isRestoreSuccess(result: RestoreResult): result is RestoreSuccess {
  return result.kind === 'success';
}
export function isRestoreError(result: RestoreResult): result is RestoreError {
  return result.kind === 'error';
}
