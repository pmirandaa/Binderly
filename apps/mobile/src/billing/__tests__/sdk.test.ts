// Direct tests for the stub adapter + the empty CustomerInfo
// builder. The real-adapter path is exercised end-to-end by
// `init.test.ts`'s vi.mock for `react-native-purchases`.

import { describe, expect, it } from 'vitest';

import { createEmptyCustomerInfo, createStubPurchasesAdapter } from '../sdk.js';
import { makePackage } from './_fixtures.js';

describe('createEmptyCustomerInfo', () => {
  it('reports no entitlements and the dev anonymous user id', () => {
    const info = createEmptyCustomerInfo();
    expect(info.entitlements.active).toEqual({});
    expect(info.entitlements.all).toEqual({});
    expect(info.activeSubscriptions).toEqual([]);
    expect(info.originalAppUserId).toBe('$RCAnonymousID:dev-stub');
    expect(info.latestExpirationDate).toBeNull();
  });

  it('preserves a passed-in appUserId', () => {
    const info = createEmptyCustomerInfo('user-42');
    expect(info.originalAppUserId).toBe('user-42');
  });
});

describe('createStubPurchasesAdapter', () => {
  it('reports isConfigured === false', () => {
    const adapter = createStubPurchasesAdapter();
    expect(adapter.isConfigured).toBe(false);
  });

  it('records every call in order', async () => {
    const adapter = createStubPurchasesAdapter();
    adapter.configure({ apiKey: 'dev-stub', appUserID: 'u' });
    await adapter.logIn('u2');
    await adapter.getCustomerInfo();
    await adapter.getOfferings();
    await adapter.restorePurchases();
    await adapter.logOut();
    expect(adapter.calls).toEqual([
      'configure',
      'logIn:u2',
      'getCustomerInfo',
      'getOfferings',
      'restorePurchases',
      'logOut',
    ]);
  });

  it('getOfferings always resolves to the null-current sentinel', async () => {
    const adapter = createStubPurchasesAdapter();
    const offerings = await adapter.getOfferings();
    expect(offerings.current).toBeNull();
    expect(offerings.all).toEqual({});
  });

  it('getCustomerInfo reflects the most recent logIn', async () => {
    const adapter = createStubPurchasesAdapter();
    await adapter.logIn('user-7');
    const info = await adapter.getCustomerInfo();
    expect(info.originalAppUserId).toBe('user-7');
  });

  it('logOut clears the appUserId back to anonymous', async () => {
    const adapter = createStubPurchasesAdapter();
    await adapter.logIn('user-7');
    await adapter.logOut();
    const info = await adapter.getCustomerInfo();
    expect(info.originalAppUserId).toBe('$RCAnonymousID:dev-stub');
  });

  it('purchasePackage rejects with a typed error in stub mode', async () => {
    const adapter = createStubPurchasesAdapter();
    await expect(adapter.purchasePackage(makePackage())).rejects.toThrow(
      /not configured/,
    );
  });
});
