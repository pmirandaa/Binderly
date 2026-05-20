import { describe, expect, it } from 'vitest';

import { mapPaddleEvent, type RawPaddleEvent } from './events';

import type { PaddlePriceIds } from './plans';

const VALID_USER_ID = '11111111-2222-3333-4444-555555555555';
const PRICES: PaddlePriceIds = { monthly: 'pri_monthly', annual: 'pri_annual' };

function makeSubscriptionEvent(eventType: string, priceId = 'pri_monthly'): RawPaddleEvent {
  return {
    event_id: 'evt_test',
    event_type: eventType,
    occurred_at: '2026-05-20T12:00:00Z',
    data: {
      id: 'sub_123',
      status: 'active',
      custom_data: { userId: VALID_USER_ID },
      items: [{ price: { id: priceId } }],
      current_billing_period: { ends_at: '2026-06-20T12:00:00Z' },
    },
  };
}

describe('mapPaddleEvent — unknown event types', () => {
  it('ignores events the handler does not know about', () => {
    const result = mapPaddleEvent({ event_id: 'evt_x', event_type: 'wibble.wobble' }, PRICES);
    expect(result.action).toBe('ignore');
    expect(result.ignoreReason).toBe('unknown-event-type');
    expect(result.eventType).toBe('wibble.wobble');
  });
});

describe('mapPaddleEvent — grant events', () => {
  for (const eventType of [
    'subscription.created',
    'subscription.activated',
    'subscription.resumed',
    'transaction.completed',
  ] as const) {
    it(`maps ${eventType} → grant on the matching price id`, () => {
      const event =
        eventType === 'transaction.completed'
          ? {
              event_id: 'evt_t',
              event_type: eventType,
              occurred_at: '2026-05-20T12:00:00Z',
              data: {
                id: 'txn_999',
                custom_data: { userId: VALID_USER_ID },
                details: { line_items: [{ price_id: 'pri_annual' }] },
              },
            }
          : makeSubscriptionEvent(eventType);

      const result = mapPaddleEvent(event, PRICES);
      expect(result.action).toBe('grant');
      expect(result.userId).toBe(VALID_USER_ID);
      expect(result.entitlementId).toBe('pro');
      expect(result.priceId).not.toBeNull();
      expect(result.ignoreReason).toBeNull();
    });
  }
});

describe('mapPaddleEvent — revoke events', () => {
  for (const eventType of [
    'subscription.canceled',
    'subscription.past_due',
    'subscription.paused',
  ] as const) {
    it(`maps ${eventType} → revoke`, () => {
      const result = mapPaddleEvent(makeSubscriptionEvent(eventType), PRICES);
      expect(result.action).toBe('revoke');
      expect(result.userId).toBe(VALID_USER_ID);
      expect(result.entitlementId).toBe('pro');
    });
  }
});

describe('mapPaddleEvent — missing customData.userId', () => {
  it('ignores grant events without a userId', () => {
    const event: RawPaddleEvent = {
      event_id: 'evt_no_user',
      event_type: 'subscription.created',
      data: {
        items: [{ price: { id: 'pri_monthly' } }],
      },
    };
    const result = mapPaddleEvent(event, PRICES);
    expect(result.action).toBe('ignore');
    expect(result.ignoreReason).toBe('missing-user-id');
  });

  it('ignores when customData is null', () => {
    const event: RawPaddleEvent = {
      event_id: 'evt_null_cd',
      event_type: 'subscription.created',
      data: {
        custom_data: null,
        items: [{ price: { id: 'pri_monthly' } }],
      },
    };
    const result = mapPaddleEvent(event, PRICES);
    expect(result.action).toBe('ignore');
    expect(result.ignoreReason).toBe('missing-user-id');
  });

  it('ignores when userId is not a UUID', () => {
    const event: RawPaddleEvent = {
      event_id: 'evt_bad_user',
      event_type: 'subscription.created',
      data: {
        custom_data: { userId: 'not-a-uuid' },
        items: [{ price: { id: 'pri_monthly' } }],
      },
    };
    const result = mapPaddleEvent(event, PRICES);
    expect(result.action).toBe('ignore');
    expect(result.ignoreReason).toBe('missing-user-id');
  });

  it('lowercases UUIDs for stable downstream matching', () => {
    const upper = VALID_USER_ID.toUpperCase();
    const event: RawPaddleEvent = {
      event_id: 'evt_upper',
      event_type: 'subscription.created',
      data: {
        custom_data: { userId: upper },
        items: [{ price: { id: 'pri_monthly' } }],
      },
    };
    const result = mapPaddleEvent(event, PRICES);
    expect(result.userId).toBe(VALID_USER_ID);
  });
});

describe('mapPaddleEvent — price id resolution', () => {
  it('ignores grants when no price id can be extracted', () => {
    const event: RawPaddleEvent = {
      event_id: 'evt_no_price',
      event_type: 'subscription.created',
      data: { custom_data: { userId: VALID_USER_ID } },
    };
    const result = mapPaddleEvent(event, PRICES);
    expect(result.action).toBe('ignore');
    expect(result.ignoreReason).toBe('missing-price-id');
  });

  it('ignores grants whose price id is not in the env-configured plans', () => {
    const event = makeSubscriptionEvent('subscription.created', 'pri_unknown_xxx');
    const result = mapPaddleEvent(event, PRICES);
    expect(result.action).toBe('ignore');
    expect(result.ignoreReason).toBe('unknown-price-id');
    expect(result.priceId).toBe('pri_unknown_xxx');
  });

  it('reads transaction.completed price ids from details.line_items[].price.id when price_id is absent', () => {
    const event: RawPaddleEvent = {
      event_id: 'evt_txn',
      event_type: 'transaction.completed',
      data: {
        custom_data: { userId: VALID_USER_ID },
        details: { line_items: [{ price: { id: 'pri_annual' } }] },
      },
    };
    const result = mapPaddleEvent(event, PRICES);
    expect(result.action).toBe('grant');
    expect(result.priceId).toBe('pri_annual');
  });
});

describe('mapPaddleEvent — basic carry-through fields', () => {
  it('preserves event_id, event_type, occurred_at, expires_at on grant', () => {
    const event = makeSubscriptionEvent('subscription.created');
    const result = mapPaddleEvent(event, PRICES);
    expect(result.eventId).toBe('evt_test');
    expect(result.eventType).toBe('subscription.created');
    expect(result.occurredAt).toBe('2026-05-20T12:00:00Z');
    expect(result.expiresAt).toBe('2026-06-20T12:00:00Z');
  });

  it('returns null occurredAt + expiresAt when missing', () => {
    const event: RawPaddleEvent = {
      event_id: 'evt_nodates',
      event_type: 'subscription.canceled',
      data: {
        custom_data: { userId: VALID_USER_ID },
        items: [{ price: { id: 'pri_monthly' } }],
      },
    };
    const result = mapPaddleEvent(event, PRICES);
    expect(result.occurredAt).toBeNull();
    expect(result.expiresAt).toBeNull();
  });
});
