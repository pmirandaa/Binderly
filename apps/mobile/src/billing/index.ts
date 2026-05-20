// Public barrel for `apps/mobile/src/billing/`.
//
// Downstream feature tasks (T-PB-GATING for the in-screen gates;
// future T-PB-PAYWALL-UI for the upgrade prompt and settings
// surface) import exclusively from here so the module internals
// stay refactorable.
//
// Surface, broken out by acceptance-criterion bucket:
//
//   - Init / bootstrap:
//       initializeBilling, useBillingBootstrap,
//       getBillingAdapter, isBillingConfigured,
//       resetBillingForTesting, setBillingAdapterForTesting
//
//   - Offerings:
//       useOfferings, OFFERINGS_QUERY_KEY
//
//   - Purchase:
//       purchasePackage, usePurchasePackage,
//       writeOptimisticEntitlements, mapRevenueCatErrorToResult
//
//   - Entitlements:
//       useEntitlementsQuery, usePaidFeature,
//       useInvalidateEntitlements, mapCustomerInfoToSnapshot,
//       ENTITLEMENTS_QUERY_KEY, PRO_ENTITLEMENT_ID,
//       ALL_PAID_FEATURES
//
//   - Restore:
//       restorePurchases, useRestorePurchases
//
//   - Types:
//       PurchaseResult + variants + type guards,
//       RestoreResult + variants + type guards,
//       OfferingsSnapshot, EntitlementsSnapshot, Tier,
//       PaidFeature, PurchasesOffering, PurchasesPackage,
//       CustomerInfo, PurchasesEntitlementInfo

export {
  getBillingAdapter,
  getConfiguredAppUserId,
  initializeBilling,
  isBillingConfigured,
  resetBillingForTesting,
  setBillingAdapterForTesting,
  useBillingBootstrap,
} from './init.js';
export type {
  BillingInitOptions,
  BillingPlatform,
  UseBillingBootstrapOptions,
} from './init.js';

export type { PurchasesAdapter, StubPurchasesAdapter } from './sdk.js';
export {
  createEmptyCustomerInfo,
  createRealPurchasesAdapter,
  createStubPurchasesAdapter,
} from './sdk.js';

export { OFFERINGS_QUERY_KEY, useOfferings } from './offerings.js';

export {
  mapRevenueCatErrorToResult,
  purchasePackage,
  usePurchasePackage,
  writeOptimisticEntitlements,
} from './purchase.js';

export {
  ENTITLEMENTS_QUERY_KEY,
  mapCustomerInfoToSnapshot,
  useEntitlementsQuery,
  useInvalidateEntitlements,
  usePaidFeature,
} from './entitlements.js';

export { restorePurchases, useRestorePurchases } from './restore.js';

export {
  ALL_PAID_FEATURES,
  PRO_ENTITLEMENT_ID,
  isPurchaseCancelled,
  isPurchaseNetworkError,
  isPurchasePaymentInvalid,
  isPurchasePending,
  isPurchaseSuccess,
  isPurchaseUnknownError,
  isRestoreError,
  isRestoreSuccess,
} from './types.js';
export type {
  CustomerInfo,
  EntitlementsSnapshot,
  OfferingsSnapshot,
  PaidFeature,
  ProEntitlementId,
  PurchaseCancelled,
  PurchaseNetworkError,
  PurchasePaymentInvalid,
  PurchasePending,
  PurchaseResult,
  PurchaseSuccess,
  PurchaseUnknownError,
  PurchasesEntitlementInfo,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
  RestoreError,
  RestoreResult,
  RestoreSuccess,
  Tier,
} from './types.js';
