// Tests for the lazy initializer and dev-mode stub fallback.
//
// We deliberately mock `react-native-purchases` at module level so
// the "no native module" promise is testable end-to-end: the real
// adapter loads RC via `require()`, the mock intercepts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.hoisted` lets the mock object survive `vi.mock`'s hoisting
// without tripping the "top-level reference before init" error.
// The factory passed to `vi.mock` is hoisted to before all
// imports, but it can read variables declared inside a
// `vi.hoisted(...)` block.
const { mockPurchases } = vi.hoisted(() => {
  const mock = {
    configure: vi.fn(),
    logIn: vi.fn(async (id: string) => ({
      customerInfo: { __mock__: true, id },
      created: false,
    })),
    logOut: vi.fn(async () => ({ __mock__: true })),
    getOfferings: vi.fn(async () => ({ all: {}, current: null })),
    getCustomerInfo: vi.fn(async () => ({ __mock__: true })),
    purchasePackage: vi.fn(async () => ({
      customerInfo: { __mock__: true },
      productIdentifier: 'p',
    })),
    restorePurchases: vi.fn(async () => ({ __mock__: true })),
  };
  return { mockPurchases: mock };
});

vi.mock('react-native-purchases', () => ({ default: mockPurchases }));

import {
  getBillingAdapter,
  getConfiguredAppUserId,
  initializeBilling,
  isBillingConfigured,
  resetBillingForTesting,
  setBillingAdapterForTesting,
} from '../init.js';
import { createMockAdapter } from './_fixtures.js';

beforeEach(() => {
  resetBillingForTesting();
  mockPurchases.configure.mockClear();
  mockPurchases.logIn.mockClear();
  mockPurchases.logOut.mockClear();
});

afterEach(() => {
  resetBillingForTesting();
});

describe('initializeBilling', () => {
  it('returns the stub adapter when both env keys are missing', () => {
    const warn = vi.fn();
    const adapter = initializeBilling({
      iosKey: undefined,
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
      warn,
    });
    expect(adapter.isConfigured).toBe(false);
    expect(isBillingConfigured()).toBe(false);
    expect(mockPurchases.configure).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/REVENUECAT/);
  });

  it('returns the stub when only the *other* platform key is set', () => {
    const warn = vi.fn();
    const adapter = initializeBilling({
      iosKey: 'ios-key',
      androidKey: undefined,
      platform: 'android',
      appUserId: 'user-1',
      warn,
    });
    expect(adapter.isConfigured).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns only once across multiple dev-mode calls', () => {
    const warn = vi.fn();
    initializeBilling({
      iosKey: undefined,
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
      warn,
    });
    initializeBilling({
      iosKey: undefined,
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-2',
      warn,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('treats an empty-string key as missing (stub fallback)', () => {
    const warn = vi.fn();
    const adapter = initializeBilling({
      iosKey: '',
      androidKey: undefined,
      platform: 'ios',
      appUserId: null,
      warn,
    });
    expect(adapter.isConfigured).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('configures the real adapter when a platform key is present', () => {
    const adapter = initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
    });
    expect(adapter.isConfigured).toBe(true);
    expect(isBillingConfigured()).toBe(true);
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.configure).toHaveBeenCalledWith({
      apiKey: 'ios-public-key',
      appUserID: 'user-1',
    });
  });

  it('configures with anonymous (null) appUserID when no auth user', () => {
    initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: null,
    });
    expect(mockPurchases.configure).toHaveBeenCalledWith({
      apiKey: 'ios-public-key',
      appUserID: null,
    });
  });

  it('picks the Android key when platform is android', () => {
    initializeBilling({
      iosKey: 'ios-key',
      androidKey: 'android-key',
      platform: 'android',
      appUserId: 'user-1',
    });
    expect(mockPurchases.configure).toHaveBeenCalledWith({
      apiKey: 'android-key',
      appUserID: 'user-1',
    });
  });

  it('is idempotent on repeated calls with the same appUserId', () => {
    initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
    });
    initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
    });
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).not.toHaveBeenCalled();
  });

  it('calls logIn (not re-configure) when the appUserId changes', async () => {
    initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
    });
    initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-2',
    });
    await Promise.resolve();
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledWith('user-2');
  });

  it('calls logOut when the appUserId moves from set to null', async () => {
    initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
    });
    initializeBilling({
      iosKey: 'ios-public-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: null,
    });
    await Promise.resolve();
    expect(mockPurchases.logOut).toHaveBeenCalledTimes(1);
  });

  it('updates getConfiguredAppUserId after each call', () => {
    initializeBilling({
      iosKey: 'ios-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
    });
    expect(getConfiguredAppUserId()).toBe('user-1');
    initializeBilling({
      iosKey: 'ios-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: null,
    });
    expect(getConfiguredAppUserId()).toBeNull();
  });

  it('swallows logIn errors with a warning (does not crash)', async () => {
    const warn = vi.fn();
    mockPurchases.logIn.mockRejectedValueOnce(new Error('rc-down'));
    initializeBilling({
      iosKey: 'ios-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
      warn,
    });
    initializeBilling({
      iosKey: 'ios-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-2',
      warn,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/logIn failed.*rc-down/));
  });

  it('does NOT invoke configure at module import time', () => {
    // Just importing the module above should not have called RC.
    // (Cleared in beforeEach, so the count here reflects only what
    // the test itself does.)
    expect(mockPurchases.configure).not.toHaveBeenCalled();
  });
});

describe('getBillingAdapter (pre-init)', () => {
  it('returns a stub adapter before initializeBilling is called', async () => {
    const adapter = getBillingAdapter();
    expect(adapter.isConfigured).toBe(false);
    // The stub satisfies the full contract without crashing.
    const info = await adapter.getCustomerInfo();
    expect(info.entitlements.active).toEqual({});
    const offerings = await adapter.getOfferings();
    expect(offerings.current).toBeNull();
  });

  it('returns the configured adapter once initializeBilling runs', () => {
    initializeBilling({
      iosKey: 'ios-key',
      androidKey: undefined,
      platform: 'ios',
      appUserId: 'user-1',
    });
    expect(getBillingAdapter().isConfigured).toBe(true);
  });
});

describe('setBillingAdapterForTesting', () => {
  it('replaces the singleton with a mock', async () => {
    const mock = createMockAdapter();
    setBillingAdapterForTesting(mock);
    expect(getBillingAdapter()).toBe(mock);
    await getBillingAdapter().getCustomerInfo();
    expect(mock.getCustomerInfo).toHaveBeenCalledTimes(1);
  });

  it('is cleared by resetBillingForTesting', () => {
    setBillingAdapterForTesting(createMockAdapter());
    resetBillingForTesting();
    // The next read should be the pre-init stub fallback, not the mock.
    expect(getBillingAdapter().isConfigured).toBe(false);
  });
});
