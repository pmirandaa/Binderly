import { describe, expect, it } from 'vitest';

import {
  createMockPricingAggregatorClient,
  filterQuotes,
  MockPricingAggregatorClient,
} from './mock.js';

import type { AggregatorQuote } from './types.js';

describe('MockPricingAggregatorClient — fixture loading', () => {
  it('loads both fixture files and validates every row', async () => {
    const client = createMockPricingAggregatorClient();
    const all = await client.fetchQuotes();
    expect(all.length).toBeGreaterThan(0);
    // Both kinds represented.
    const kinds = new Set(all.map((q) => q.kind));
    expect(kinds.has('cardmarket_quote')).toBe(true);
    expect(kinds.has('ebay_sold_listing')).toBe(true);
  });

  it('uses the configured vendor tag', () => {
    const client = createMockPricingAggregatorClient({ vendor: 'mock-test' });
    expect(client.vendor).toBe('mock-test');
  });

  it('caches loads across calls', async () => {
    const client = createMockPricingAggregatorClient();
    const a = await client.fetchQuotes();
    const b = await client.fetchQuotes();
    expect(a).toBe(b);
  });
});

describe('MockPricingAggregatorClient — seeded quotes', () => {
  it('uses the seed array verbatim instead of disk fixtures', async () => {
    const seed: AggregatorQuote[] = [
      {
        kind: 'cardmarket_quote',
        vendor: 'mock',
        printingVariantKey: 'en-foo-001-holo',
        market: 'CARDMARKET_EU',
        currency: 'EUR',
        gradeTier: 'RAW_NM',
        price: '1.00',
        observedAt: '2026-04-30T06:00:00Z',
        observedDate: '2026-04-30',
        rawPayload: {},
      },
    ];
    const client = new MockPricingAggregatorClient({ quotes: seed });
    const out = await client.fetchQuotes();
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('cardmarket_quote');
  });
});

describe('filterQuotes', () => {
  const samples: AggregatorQuote[] = [
    {
      kind: 'cardmarket_quote',
      vendor: 'mock',
      printingVariantKey: 'en-a-001-holo',
      market: 'CARDMARKET_EU',
      currency: 'EUR',
      gradeTier: 'RAW_NM',
      price: '1.00',
      observedAt: '2026-04-28T06:00:00Z',
      observedDate: '2026-04-28',
      rawPayload: {},
    },
    {
      kind: 'cardmarket_quote',
      vendor: 'mock',
      printingVariantKey: 'en-b-001-holo',
      market: 'CARDMARKET_EU',
      currency: 'EUR',
      gradeTier: 'RAW_NM',
      price: '2.00',
      observedAt: '2026-04-30T06:00:00Z',
      observedDate: '2026-04-30',
      rawPayload: {},
    },
    {
      kind: 'ebay_sold_listing',
      vendor: 'mock',
      listingId: '99',
      listingTitle: 'Charizard 4/102 Base Set Holo',
      market: 'EBAY_US',
      currency: 'USD',
      gradeTier: 'RAW_NM',
      price: '395.00',
      observedAt: '2026-04-29T06:00:00Z',
      observedDate: '2026-04-29',
      rawPayload: {},
    },
  ];

  it('narrows by since (inclusive)', () => {
    const out = filterQuotes(samples, { since: '2026-04-29' });
    expect(out.map((q) => q.observedDate).sort()).toEqual(['2026-04-29', '2026-04-30']);
  });

  it('narrows by until (inclusive)', () => {
    const out = filterQuotes(samples, { until: '2026-04-29' });
    expect(out.map((q) => q.observedDate).sort()).toEqual(['2026-04-28', '2026-04-29']);
  });

  it('narrows by both since and until', () => {
    const out = filterQuotes(samples, { since: '2026-04-29', until: '2026-04-29' });
    expect(out).toHaveLength(1);
    expect(out[0]?.observedDate).toBe('2026-04-29');
  });

  it('narrows by printings (cardmarket only; ebay passes through)', () => {
    const out = filterQuotes(samples, { printings: ['en-a-001-holo'] });
    // The cardmarket quote for `en-b-...` is filtered out;
    // the ebay quote passes through (the runner's resolver decides).
    expect(out.map((q) => (q.kind === 'cardmarket_quote' ? q.printingVariantKey : q.kind))).toEqual(
      ['en-a-001-holo', 'ebay_sold_listing'],
    );
  });

  it('an empty printings array is treated as no filter', () => {
    const out = filterQuotes(samples, { printings: [] });
    expect(out).toHaveLength(samples.length);
  });
});
