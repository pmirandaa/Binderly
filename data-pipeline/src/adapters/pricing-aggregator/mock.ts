// `MockPricingAggregatorClient` — the default code path during the
// build phase, before paid-API spend is approved.
//
// Backed by static JSON fixtures under `./fixtures/`:
//   - `cardmarket-quotes.json`   (Cardmarket trends / quotes)
//   - `ebay-sold-listings.json`  (aggregator-passthrough eBay
//                                 sold listings)
//
// The mock validates each fixture row against
// `aggregatorQuoteSchema` so a typo in the JSON surfaces at module
// load time, not in production. Filtering applies the runner's
// `since` / `until` / `printings` semantics so tests exercise the
// same code paths the live client will.
//
// The mock is deterministic: same inputs (and same fixture
// content) → same output, every call.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type FetchQuotesOptions, type PricingAggregatorClient } from './client.js';
import { aggregatorQuoteSchema, type AggregatorQuote } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default fixtures directory — `./fixtures/` next to this module. */
export const MOCK_FIXTURES_DIR = path.join(__dirname, 'fixtures');

/**
 * Vendor tag that lands in `price_observation.source` as
 * `aggregator_mock`. Pinned as a constant so tests and runtime
 * agree.
 */
export const MOCK_PRICING_AGGREGATOR_VENDOR = 'mock' as const;

export interface MockPricingAggregatorClientConfig {
  /**
   * Optional override of the fixtures directory. Tests can point
   * to a custom directory to exercise edge cases (empty file,
   * malformed row, etc.). Defaults to `MOCK_FIXTURES_DIR`.
   */
  readonly fixturesDir?: string;
  /**
   * Optional override of the in-memory quote set. Tests that want
   * to bypass the JSON loader entirely can pass a literal array
   * — useful for asserting the runner's behaviour with a curated
   * minimal input.
   */
  readonly quotes?: ReadonlyArray<AggregatorQuote>;
  /**
   * Vendor tag to surface on the client. Defaults to `'mock'`.
   * Tests can override to assert the runner threads the vendor
   * tag through to `price_observation.source`.
   */
  readonly vendor?: string;
}

/**
 * Construct a `MockPricingAggregatorClient`. Loading is lazy: the
 * fixtures are read on the first `fetchQuotes` call and cached
 * thereafter. Fast for the test suite (every test re-reads from
 * the cache).
 */
export class MockPricingAggregatorClient implements PricingAggregatorClient {
  readonly vendor: string;
  private readonly fixturesDir: string;
  private readonly seedQuotes: ReadonlyArray<AggregatorQuote> | null;
  private cache: ReadonlyArray<AggregatorQuote> | null;

  constructor(config: MockPricingAggregatorClientConfig = {}) {
    this.vendor = config.vendor ?? MOCK_PRICING_AGGREGATOR_VENDOR;
    this.fixturesDir = config.fixturesDir ?? MOCK_FIXTURES_DIR;
    this.seedQuotes = config.quotes ?? null;
    this.cache = null;
  }

  async fetchQuotes(options: FetchQuotesOptions = {}): Promise<ReadonlyArray<AggregatorQuote>> {
    const all = await this.loadAll();
    return filterQuotes(all, options);
  }

  private async loadAll(): Promise<ReadonlyArray<AggregatorQuote>> {
    if (this.cache !== null) return this.cache;
    if (this.seedQuotes !== null) {
      this.cache = this.seedQuotes.map((q) => aggregatorQuoteSchema.parse(q));
      return this.cache;
    }
    const files = ['cardmarket-quotes.json', 'ebay-sold-listings.json'];
    const collected: AggregatorQuote[] = [];
    for (const filename of files) {
      const fullPath = path.join(this.fixturesDir, filename);
      const raw = await fs.readFile(fullPath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (cause) {
        throw new Error(`MockPricingAggregatorClient: ${filename} is not valid JSON`, { cause });
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`MockPricingAggregatorClient: ${filename} must be a JSON array of quotes`);
      }
      for (const [index, row] of parsed.entries()) {
        const result = aggregatorQuoteSchema.safeParse(row);
        if (!result.success) {
          throw new Error(
            `MockPricingAggregatorClient: ${filename}[${index}] failed schema validation: ` +
              JSON.stringify(result.error.issues),
          );
        }
        collected.push(result.data);
      }
    }
    this.cache = collected;
    return this.cache;
  }
}

/**
 * Apply the runner's filter semantics. Pure helper, exported so
 * tests can exercise the filter logic in isolation.
 */
export function filterQuotes(
  quotes: ReadonlyArray<AggregatorQuote>,
  options: FetchQuotesOptions,
): ReadonlyArray<AggregatorQuote> {
  let out: ReadonlyArray<AggregatorQuote> = quotes;
  if (options.since) {
    const since = options.since;
    out = out.filter((q) => q.observedDate >= since);
  }
  if (options.until) {
    const until = options.until;
    out = out.filter((q) => q.observedDate <= until);
  }
  if (options.printings && options.printings.length > 0) {
    const allow = new Set(options.printings);
    out = out.filter((q) => {
      // Cardmarket quotes carry a printing key; eBay sold-listing
      // quotes don't (the listing title hasn't been parsed yet) —
      // pass them through and let the runner's resolver decide.
      if (q.kind === 'cardmarket_quote') return allow.has(q.printingVariantKey);
      return true;
    });
  }
  return out;
}

/**
 * Convenience constructor — returns a fresh
 * `MockPricingAggregatorClient` with the shipped fixtures. Used by
 * tests and by any caller that wants the default mock without
 * configuration knobs.
 */
export function createMockPricingAggregatorClient(
  config: MockPricingAggregatorClientConfig = {},
): MockPricingAggregatorClient {
  return new MockPricingAggregatorClient(config);
}
