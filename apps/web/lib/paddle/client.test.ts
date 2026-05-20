import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetPaddleCacheForTests, openCheckout } from './client';

import type { Paddle, CheckoutOpenOptions } from '@paddle/paddle-js';

interface CapturedCheckout {
  options: CheckoutOpenOptions;
}

function makePaddleStub(): { paddle: Paddle; calls: CapturedCheckout[] } {
  const calls: CapturedCheckout[] = [];
  const paddle = {
    Checkout: {
      open: vi.fn((options: CheckoutOpenOptions) => {
        calls.push({ options });
      }),
      updateCheckout: vi.fn(),
      updateItems: vi.fn(),
      close: vi.fn(),
    },
  } as unknown as Paddle;
  return { paddle, calls };
}

describe('openCheckout', () => {
  beforeEach(() => {
    __resetPaddleCacheForTests();
  });

  it('opens the overlay with priceId + customData.userId', () => {
    const { paddle, calls } = makePaddleStub();
    openCheckout(paddle, {
      priceId: 'pri_monthly',
      userId: '11111111-2222-3333-4444-555555555555',
    });
    expect(calls).toHaveLength(1);
    const opts = calls[0]!.options;
    expect(opts.items).toEqual([{ priceId: 'pri_monthly', quantity: 1 }]);
    expect(opts.customData).toMatchObject({
      userId: '11111111-2222-3333-4444-555555555555',
      source: 'binderly-web',
    });
  });

  it('sets the success URL on settings when provided', () => {
    const { paddle, calls } = makePaddleStub();
    openCheckout(paddle, {
      priceId: 'pri_monthly',
      userId: 'u1',
      successUrl: 'https://binderly.app/billing?status=ok',
    });
    expect(calls[0]!.options.settings?.successUrl).toBe(
      'https://binderly.app/billing?status=ok',
    );
  });

  it('omits settings entirely when successUrl is undefined', () => {
    const { paddle, calls } = makePaddleStub();
    openCheckout(paddle, { priceId: 'pri_monthly', userId: 'u1' });
    expect(calls[0]!.options.settings).toBeUndefined();
  });

  it('merges extraCustomData onto customData', () => {
    const { paddle, calls } = makePaddleStub();
    openCheckout(paddle, {
      priceId: 'pri_annual',
      userId: 'u1',
      extraCustomData: { campaign: 'spring-sale' },
    });
    expect(calls[0]!.options.customData).toMatchObject({
      userId: 'u1',
      source: 'binderly-web',
      campaign: 'spring-sale',
    });
  });

  it('throws when priceId is empty', () => {
    const { paddle } = makePaddleStub();
    expect(() => openCheckout(paddle, { priceId: '', userId: 'u1' })).toThrowError(
      /priceId is required/,
    );
  });

  it('throws when userId is empty', () => {
    const { paddle } = makePaddleStub();
    expect(() => openCheckout(paddle, { priceId: 'pri', userId: '' })).toThrowError(
      /userId is required/,
    );
  });
});
