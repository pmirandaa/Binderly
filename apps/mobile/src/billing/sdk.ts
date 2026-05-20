// Adapter over `react-native-purchases`.
//
// Why an adapter rather than calling `Purchases` directly:
//
//   1. **Dev-mode stub.** When `EXPO_PUBLIC_REVENUECAT_*_KEY` is
//      absent we return a no-op stub so the rest of the module
//      keeps working for contributors without RevenueCat creds.
//      The stub mirrors the adapter contract instead of leaving
//      every consumer to defensive-null-check `Purchases.*`.
//
//   2. **Testability.** The hook tests (`__tests__/*.test.ts`)
//      inject mock adapters via `setBillingAdapterForTesting()`
//      rather than reaching into `vi.mock('react-native-purchases')`
//      from every file. The adapter surface is the minimum subset
//      of RC's static API the rest of the module touches, which
//      keeps the mock shape small and obvious.
//
//   3. **Future swap.** If we ever swap RevenueCat for another
//      provider (we won't, per `PROJECT.md § 3`, but the surface
//      is intentionally generic — `getOfferings`,
//      `purchasePackage`, `getCustomerInfo`, `restorePurchases`,
//      `logIn`, `logOut` — so a future migration is mechanical).
//
// The real adapter lazily imports `react-native-purchases` the
// first time it's instantiated. This is what enforces the
// "configure is never called at module-import time" acceptance
// criterion: importing this file is free; importing
// `react-native-purchases` happens only when the real adapter is
// actually built (i.e. when env keys exist + auth resolves).

// Top-level static import for `react-native-purchases`. This is
// the surface `vi.mock(...)` intercepts in tests (Vitest only
// hooks ESM imports, not `require()`). The native module side
// effects of importing the package are limited to the SDK's
// internal nativeModule registration — `Purchases.configure(...)`
// is still gated to "auth ready" by `init.ts`. The acceptance
// criterion is that `configure` isn't *called* at module-import
// time, which is enforced by `init.ts`'s lazy bootstrap; the
// static import here is just the type carrier.
import RNPurchases from 'react-native-purchases';

import type { CustomerInfo, PurchasesOfferings, PurchasesPackage } from './types.js';

/**
 * Minimal subset of RevenueCat's static `Purchases` API the
 * binderly billing module talks to. Re-implement this if you ever
 * swap providers.
 */
export interface PurchasesAdapter {
  /** Identify a user against RevenueCat. */
  configure(opts: { apiKey: string; appUserID: string | null }): void;
  /**
   * Re-associate the configured client with a new user id (e.g.
   * after a fresh sign-in completes). RC may return a fresh
   * `CustomerInfo` reflecting the new identity.
   */
  logIn(appUserID: string): Promise<{ customerInfo: CustomerInfo; created: boolean }>;
  /**
   * Drop the current user identity and return RC to anonymous
   * mode. Called on sign-out.
   */
  logOut(): Promise<CustomerInfo>;
  /** Fetch all configured offerings + the current selection. */
  getOfferings(): Promise<PurchasesOfferings>;
  /** Fetch the current user's customer info / entitlements. */
  getCustomerInfo(): Promise<CustomerInfo>;
  /**
   * Initiate a purchase for the given package. Resolves with the
   * updated customer info on success; rejects on cancel / error
   * (the rejection shape is RC's native — we map it to
   * `PurchaseResult` variants in `purchase.ts`).
   */
  purchasePackage(
    pkg: PurchasesPackage,
  ): Promise<{ customerInfo: CustomerInfo; productIdentifier: string }>;
  /** Restore previously-made purchases. iOS App Store compliance. */
  restorePurchases(): Promise<CustomerInfo>;
  /**
   * Discriminator: the dev-mode stub returns `false` so callers
   * can branch on the "no SDK configured" state for UI affordances
   * (e.g. hiding paywall CTAs in CI / dev).
   */
  readonly isConfigured: boolean;
}

// ============================================================
// Real adapter — backed by react-native-purchases
// ============================================================

/**
 * Build the real adapter. Lazily imports `react-native-purchases`
 * so a module-graph import of `apps/mobile/src/billing` doesn't
 * pull in the native module under jsdom (tests).
 *
 * The real adapter's `configure(...)` is invoked **once** with the
 * platform's API key — re-invocation is a no-op (RC's
 * `Purchases.configure` is itself idempotent on the same key).
 */
export function createRealPurchasesAdapter(): PurchasesAdapter {
  // `RNPurchases` is the default export of `react-native-purchases`
  // imported statically above. In tests it's replaced by the
  // vi.mock-injected stub before this function ever runs.
  const Purchases = RNPurchases as unknown as PurchasesStaticContract;

  let configured = false;

  return {
    get isConfigured(): boolean {
      return configured;
    },
    configure({ apiKey, appUserID }: { apiKey: string; appUserID: string | null }): void {
      Purchases.configure({ apiKey, appUserID });
      configured = true;
    },
    async logIn(
      appUserID: string,
    ): Promise<{ customerInfo: CustomerInfo; created: boolean }> {
      const result = await Purchases.logIn(appUserID);
      return { customerInfo: result.customerInfo, created: result.created };
    },
    async logOut(): Promise<CustomerInfo> {
      return Purchases.logOut();
    },
    async getOfferings(): Promise<PurchasesOfferings> {
      return Purchases.getOfferings();
    },
    async getCustomerInfo(): Promise<CustomerInfo> {
      return Purchases.getCustomerInfo();
    },
    async purchasePackage(
      pkg: PurchasesPackage,
    ): Promise<{ customerInfo: CustomerInfo; productIdentifier: string }> {
      const result = await Purchases.purchasePackage(pkg);
      return {
        customerInfo: result.customerInfo,
        productIdentifier: result.productIdentifier,
      };
    },
    async restorePurchases(): Promise<CustomerInfo> {
      return Purchases.restorePurchases();
    },
  };
}

/**
 * The subset of `Purchases`'s static surface our real adapter
 * actually calls. Kept as a local interface (instead of leaning on
 * `typeof Purchases`) so we don't widen the typing target every
 * time RevenueCat ships a new static method, and so the mock in
 * the real-adapter test can satisfy this minimal contract directly.
 */
export interface PurchasesStaticContract {
  configure(config: { apiKey: string; appUserID: string | null }): void;
  logIn(appUserID: string): Promise<{ customerInfo: CustomerInfo; created: boolean }>;
  logOut(): Promise<CustomerInfo>;
  getOfferings(): Promise<PurchasesOfferings>;
  getCustomerInfo(): Promise<CustomerInfo>;
  purchasePackage(
    aPackage: PurchasesPackage,
  ): Promise<{ customerInfo: CustomerInfo; productIdentifier: string }>;
  restorePurchases(): Promise<CustomerInfo>;
}

// ============================================================
// Dev-mode stub adapter — no RevenueCat keys configured
// ============================================================

/**
 * Default "free tier, no entitlements, no offerings" `CustomerInfo`.
 * Returned from every stub query so the entitlements derivation +
 * UI gates work uniformly across real / dev modes.
 */
export function createEmptyCustomerInfo(appUserId: string | null = null): CustomerInfo {
  const nowIso = new Date(0).toISOString();
  return {
    entitlements: {
      all: {},
      active: {},
      verification: 'NOT_REQUESTED' as CustomerInfo['entitlements']['verification'],
    },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    latestExpirationDate: null,
    firstSeen: nowIso,
    originalAppUserId: appUserId ?? '$RCAnonymousID:dev-stub',
    requestDate: nowIso,
    allExpirationDates: {},
    allPurchaseDates: {},
    originalApplicationVersion: null,
    originalPurchaseDate: null,
    managementURL: null,
    nonSubscriptionTransactions: [],
    subscriptionsByProductIdentifier: {},
  };
}

/**
 * Adapter for use when RC keys are absent. Records calls so the
 * test suite can assert "we never tried to talk to the real SDK
 * in dev mode" without spying on a network layer.
 */
export interface StubPurchasesAdapter extends PurchasesAdapter {
  /** Test-only: every call against the stub, in order. */
  readonly calls: ReadonlyArray<string>;
}

export function createStubPurchasesAdapter(): StubPurchasesAdapter {
  const calls: string[] = [];
  let appUserId: string | null = null;
  return {
    get isConfigured(): boolean {
      return false;
    },
    get calls(): ReadonlyArray<string> {
      return calls;
    },
    configure({ appUserID }: { apiKey: string; appUserID: string | null }): void {
      calls.push('configure');
      appUserId = appUserID;
    },
    async logIn(
      newAppUserID: string,
    ): Promise<{ customerInfo: CustomerInfo; created: boolean }> {
      calls.push(`logIn:${newAppUserID}`);
      appUserId = newAppUserID;
      return { customerInfo: createEmptyCustomerInfo(appUserId), created: false };
    },
    async logOut(): Promise<CustomerInfo> {
      calls.push('logOut');
      appUserId = null;
      return createEmptyCustomerInfo(null);
    },
    async getOfferings(): Promise<PurchasesOfferings> {
      calls.push('getOfferings');
      return { all: {}, current: null };
    },
    async getCustomerInfo(): Promise<CustomerInfo> {
      calls.push('getCustomerInfo');
      return createEmptyCustomerInfo(appUserId);
    },
    async purchasePackage(
      pkg: PurchasesPackage,
    ): Promise<{ customerInfo: CustomerInfo; productIdentifier: string }> {
      calls.push(`purchasePackage:${pkg.identifier}`);
      // Dev-mode "purchases" never grant entitlements — paywall UI
      // hides itself behind the `current === null` sentinel in
      // `useOfferings()`, so this branch should be unreachable in
      // practice. We surface a typed rejection rather than silently
      // resolving so a coding error trips loudly.
      throw new Error('Billing SDK is not configured (dev-mode stub).');
    },
    async restorePurchases(): Promise<CustomerInfo> {
      calls.push('restorePurchases');
      return createEmptyCustomerInfo(appUserId);
    },
  };
}
