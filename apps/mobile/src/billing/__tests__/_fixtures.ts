// Test fixtures + mock-adapter helpers shared by every billing
// `__tests__/*.test.ts` file.
//
// Why split this out:
//   - The CustomerInfo + Offering shapes RC exports are wide;
//     constructing them inline per test would drown the test files
//     in noise.
//   - The mock adapter has knobs every test file pokes (force a
//     specific `getCustomerInfo` payload, throw a tagged error
//     from `purchasePackage`, etc.) — keeping the knobs in one
//     place avoids three subtly different mock shapes.
//
// None of these helpers run as tests themselves (no `describe`).

import { vi, type Mock } from 'vitest';

import {
  createEmptyCustomerInfo,
  type CustomerInfo,
  type PurchasesAdapter,
  type PurchasesEntitlementInfo,
  type PurchasesOffering,
  type PurchasesOfferings,
  type PurchasesPackage,
} from '../index.js';

// ============================================================
// CustomerInfo builders
// ============================================================

/**
 * Build a `PurchasesEntitlementInfo` with sensible defaults.
 * Tests override only the fields they care about (typically
 * `identifier`, `isActive`, `expirationDateMillis`).
 */
export function makeEntitlement(
  overrides: Partial<PurchasesEntitlementInfo> = {},
): PurchasesEntitlementInfo {
  const base: PurchasesEntitlementInfo = {
    identifier: 'pro',
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    latestPurchaseDate: '2026-01-01T00:00:00Z',
    latestPurchaseDateMillis: Date.UTC(2026, 0, 1),
    originalPurchaseDate: '2026-01-01T00:00:00Z',
    originalPurchaseDateMillis: Date.UTC(2026, 0, 1),
    // Far-future expiry so the "ignore expired" filter doesn't
    // strip the entitlement on default fixtures.
    expirationDate: '2099-01-01T00:00:00Z',
    expirationDateMillis: Date.UTC(2099, 0, 1),
    store: 'APP_STORE',
    productIdentifier: 'binderly_pro_monthly',
    productPlanIdentifier: null,
    isSandbox: false,
    unsubscribeDetectedAt: null,
    unsubscribeDetectedAtMillis: null,
    billingIssueDetectedAt: null,
    billingIssueDetectedAtMillis: null,
    ownershipType: 'PURCHASED',
    verification: 'NOT_REQUESTED' as PurchasesEntitlementInfo['verification'],
  };
  return { ...base, ...overrides };
}

/**
 * Build a CustomerInfo carrying the given active entitlements.
 * The `entitlements.all` map mirrors `active` plus any explicit
 * `inactive` overrides.
 */
export function makeCustomerInfo(opts: {
  active?: ReadonlyArray<PurchasesEntitlementInfo>;
  inactive?: ReadonlyArray<PurchasesEntitlementInfo>;
  appUserId?: string;
} = {}): CustomerInfo {
  const empty = createEmptyCustomerInfo(opts.appUserId ?? 'test-user');
  const activeMap: Record<string, PurchasesEntitlementInfo> = {};
  const allMap: Record<string, PurchasesEntitlementInfo> = {};
  for (const info of opts.active ?? []) {
    activeMap[info.identifier] = info;
    allMap[info.identifier] = info;
  }
  for (const info of opts.inactive ?? []) {
    allMap[info.identifier] = info;
  }
  return {
    ...empty,
    entitlements: {
      all: allMap,
      active: activeMap,
      verification: empty.entitlements.verification,
    },
  };
}

// ============================================================
// Offering builders
// ============================================================

export function makePackage(overrides: Partial<PurchasesPackage> = {}): PurchasesPackage {
  const base: PurchasesPackage = {
    identifier: 'monthly',
    packageType:
      'MONTHLY' as unknown as PurchasesPackage['packageType'],
    product: {
      identifier: 'binderly_pro_monthly',
      description: 'Binderly Pro — monthly',
      title: 'Binderly Pro',
      price: 4.99,
      priceString: '$4.99',
      pricePerWeek: null,
      pricePerMonth: 4.99,
      pricePerYear: null,
      pricePerWeekString: null,
      pricePerMonthString: '$4.99',
      pricePerYearString: null,
      currencyCode: 'USD',
      introPrice: null,
      discounts: null,
      productCategory: null,
      productType:
        'AUTO_RENEWABLE_SUBSCRIPTION' as unknown as PurchasesPackage['product']['productType'],
      subscriptionPeriod: 'P1M',
      defaultOption: null,
      subscriptionOptions: null,
      presentedOfferingIdentifier: 'default',
      presentedOfferingContext: {
        offeringIdentifier: 'default',
        placementIdentifier: null,
        targetingContext: null,
      },
    },
    offeringIdentifier: 'default',
    presentedOfferingContext: {
      offeringIdentifier: 'default',
      placementIdentifier: null,
      targetingContext: null,
    },
    webCheckoutUrl: null,
  };
  return { ...base, ...overrides };
}

export function makeOffering(overrides: Partial<PurchasesOffering> = {}): PurchasesOffering {
  const monthly = makePackage({ identifier: 'monthly' });
  const annual = makePackage({
    identifier: 'annual',
    packageType: 'ANNUAL' as unknown as PurchasesPackage['packageType'],
    product: {
      ...monthly.product,
      identifier: 'binderly_pro_annual',
      title: 'Binderly Pro (annual)',
      price: 49.99,
      priceString: '$49.99',
      pricePerYear: 49.99,
      pricePerYearString: '$49.99',
      subscriptionPeriod: 'P1Y',
    },
  });
  const base: PurchasesOffering = {
    identifier: 'default',
    serverDescription: 'Default Binderly offering',
    metadata: {},
    availablePackages: [monthly, annual],
    lifetime: null,
    annual,
    sixMonth: null,
    threeMonth: null,
    twoMonth: null,
    monthly,
    weekly: null,
    webCheckoutUrl: null,
  };
  return { ...base, ...overrides };
}

export function makeOfferings(
  overrides: Partial<PurchasesOfferings> = {},
): PurchasesOfferings {
  const offering = makeOffering();
  return {
    all: { default: offering },
    current: offering,
    ...overrides,
  };
}

// ============================================================
// Mock adapter
// ============================================================

/**
 * Mock adapter — each `PurchasesAdapter` method is exposed as a
 * vitest `Mock` so tests can directly call
 * `mockAdapter.getCustomerInfo.mockRejectedValue(...)` etc. without
 * casting through `PurchasesAdapter`'s plain function types.
 */
export interface MockPurchasesAdapter extends PurchasesAdapter {
  readonly calls: ReadonlyArray<string>;
  configure: Mock<PurchasesAdapter['configure']>;
  logIn: Mock<PurchasesAdapter['logIn']>;
  logOut: Mock<PurchasesAdapter['logOut']>;
  getOfferings: Mock<PurchasesAdapter['getOfferings']>;
  getCustomerInfo: Mock<PurchasesAdapter['getCustomerInfo']>;
  purchasePackage: Mock<PurchasesAdapter['purchasePackage']>;
  restorePurchases: Mock<PurchasesAdapter['restorePurchases']>;
  /** Force the next (or all) `getCustomerInfo()` to return this. */
  setCustomerInfo(info: CustomerInfo): void;
  /** Force the next (or all) `getOfferings()` to return this. */
  setOfferings(offerings: PurchasesOfferings): void;
  /** Throw this from the next `purchasePackage()` call. */
  setPurchaseError(err: unknown): void;
  /** Force the next `purchasePackage()` to resolve with this. */
  setPurchaseSuccess(result: { customerInfo: CustomerInfo; productIdentifier: string }): void;
  /** Force `restorePurchases()` to throw. */
  setRestoreError(err: unknown): void;
  /** Re-flip configured to false (simulates dev-mode adapter). */
  forceUnconfigured(): void;
}

export function createMockAdapter(): MockPurchasesAdapter {
  const calls: string[] = [];
  let customerInfo: CustomerInfo = createEmptyCustomerInfo('test-user');
  let offerings: PurchasesOfferings = { all: {}, current: null };
  let purchaseError: unknown | null = null;
  let purchaseSuccess: { customerInfo: CustomerInfo; productIdentifier: string } | null = null;
  let restoreError: unknown | null = null;
  let configured = true;

  const adapter: MockPurchasesAdapter = {
    get isConfigured(): boolean {
      return configured;
    },
    get calls(): ReadonlyArray<string> {
      return calls;
    },
    configure: vi.fn((opts: { apiKey: string; appUserID: string | null }) => {
      calls.push(`configure:${opts.apiKey}:${opts.appUserID ?? 'null'}`);
    }),
    logIn: vi.fn(async (appUserID: string) => {
      calls.push(`logIn:${appUserID}`);
      return { customerInfo, created: false };
    }),
    logOut: vi.fn(async () => {
      calls.push('logOut');
      return customerInfo;
    }),
    getOfferings: vi.fn(async () => {
      calls.push('getOfferings');
      return offerings;
    }),
    getCustomerInfo: vi.fn(async () => {
      calls.push('getCustomerInfo');
      return customerInfo;
    }),
    purchasePackage: vi.fn(async (pkg: PurchasesPackage) => {
      calls.push(`purchasePackage:${pkg.identifier}`);
      if (purchaseError !== null) {
        const toThrow = purchaseError;
        purchaseError = null;
        throw toThrow;
      }
      if (purchaseSuccess !== null) {
        const result = purchaseSuccess;
        purchaseSuccess = null;
        return result;
      }
      return { customerInfo, productIdentifier: pkg.product.identifier };
    }),
    restorePurchases: vi.fn(async () => {
      calls.push('restorePurchases');
      if (restoreError !== null) {
        const toThrow = restoreError;
        restoreError = null;
        throw toThrow;
      }
      return customerInfo;
    }),
    setCustomerInfo(info: CustomerInfo): void {
      customerInfo = info;
    },
    setOfferings(value: PurchasesOfferings): void {
      offerings = value;
    },
    setPurchaseError(err: unknown): void {
      purchaseError = err;
    },
    setPurchaseSuccess(result: { customerInfo: CustomerInfo; productIdentifier: string }): void {
      purchaseSuccess = result;
    },
    setRestoreError(err: unknown): void {
      restoreError = err;
    },
    forceUnconfigured(): void {
      configured = false;
    },
  };
  return adapter;
}
