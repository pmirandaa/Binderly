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

import {
  ALL_PAID_FEATURES,
  PRO_ENTITLEMENT_ID,
  type PaidFeature,
  type ProEntitlementId,
  type Tier,
} from '@binderly/entitlements';

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
// Entitlement identifier contract + paid-feature surface
// ============================================================
//
// MIGRATED (T-PB-GATING): the canonical entitlement id, tier, and the
// paid-feature surface now live in `@binderly/entitlements` (the single
// source of truth, derived from PROJECT.md § 16). This module re-exports
// them so existing billing imports (`./types.js` consumers) keep working
// while there is exactly one definition across web, mobile, and the edge
// runtime.
//
// The mobile union was previously an 8-entry list with different names; it
// is now the canonical 9-entry union. Rename map (see the package README):
//   pricing_graphs          → pricing_history
//   export_csv              → export_data
//   remove_branding         → shareable_themes
//   cloud_ai_scan_fallback  → cloud_ai_scan
//   (new)                   → save_smart_collections
//
// **CONTRACT FOR T-PB-PADDLE / T-PB-ENTITLEMENTS:** the RC entitlement
// identifier remains the literal `'pro'` (`PRO_ENTITLEMENT_ID`).
export { ALL_PAID_FEATURES, PRO_ENTITLEMENT_ID };
export type { PaidFeature, ProEntitlementId, Tier };

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
