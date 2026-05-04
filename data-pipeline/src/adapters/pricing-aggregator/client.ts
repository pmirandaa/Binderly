// `PricingAggregatorClient` — the single fetch surface the runner
// depends on. Two implementations:
//
//   * `MockPricingAggregatorClient` (./mock.ts) — backed by static
//     JSON fixtures. Default code path while
//     `MOCK_PRICING_AGGREGATOR=1` (default ON; see README).
//   * `LiveClientNotConfiguredError`-throwing stub
//     (`createLivePricingAggregatorClient`) — placeholder for the
//     future live-API hookup. Pablo has not approved paid-API
//     spend; the live wiring lands in a follow-up task per the
//     elaborated spec.
//
// Both implementations honor the same `fetchQuotes` contract so
// the runner is identical regardless of which is wired.

import { AdapterError, type AdapterContext } from '../../interfaces/adapter.js';

import type { AggregatorQuote } from './types.js';

/**
 * Filters the runner forwards to the client. All optional —
 * absent filter means "no narrowing". Filters compose; a quote
 * must satisfy every filter to be returned.
 */
export interface FetchQuotesOptions {
  /** Inclusive lower bound on `observedDate` (YYYY-MM-DD). */
  readonly since?: string;
  /** Inclusive upper bound on `observedDate` (YYYY-MM-DD). */
  readonly until?: string;
  /**
   * Allow-list of catalog variant keys to scope the fetch. When
   * supplied, the client returns only quotes attributed to one of
   * these printings. For Cardmarket quotes the match is on
   * `printingVariantKey`; for eBay-sold quotes the client has no
   * way to pre-filter (the listing title hasn't been parsed yet)
   * so it returns them all and lets the runner's resolver decide.
   */
  readonly printings?: ReadonlyArray<string>;
}

export interface PricingAggregatorClient {
  /**
   * Stable vendor tag, lowercased. `'mock'` for the bundled mock;
   * the live client returns the chosen vendor's name. Reflected
   * in `price_observation.source` as `aggregator_<vendor>`.
   */
  readonly vendor: string;

  fetchQuotes(options?: FetchQuotesOptions): Promise<ReadonlyArray<AggregatorQuote>>;
}

// ============================================================
// Live-client placeholder
// ============================================================

/**
 * `LiveClientNotConfiguredError` — surfaced when caller code
 * attempts to use the live aggregator client without an approved
 * vendor wiring. Carries the typed-error shape from
 * `interfaces/adapter.ts` so existing handlers can `instanceof`-
 * check for it.
 */
export class LiveClientNotConfiguredError extends AdapterError {
  override readonly kind = 'permanent' as const;

  constructor(message: string) {
    super(message, { source: 'pricing-aggregator-live' });
  }
}

export interface LivePricingAggregatorClientConfig {
  /** Vendor tag (`'poketrace' | 'pokemonapi' | …`). */
  readonly vendor: string;
  /** Optional shared adapter context (logger, env). */
  readonly context?: AdapterContext;
}

/**
 * Construct a live `PricingAggregatorClient`. Currently a stub
 * that throws `LiveClientNotConfiguredError` on any call —
 * Pablo has not approved paid-API spend, and the choice of
 * vendor + auth wiring is a separate follow-up task. The
 * interface is wired so the swap is drop-in once the follow-up
 * lands.
 */
export function createLivePricingAggregatorClient(
  config: LivePricingAggregatorClientConfig,
): PricingAggregatorClient {
  if (!config.vendor) {
    throw new Error('createLivePricingAggregatorClient: vendor is required (e.g. "poketrace").');
  }
  return {
    vendor: config.vendor,
    async fetchQuotes(): Promise<ReadonlyArray<AggregatorQuote>> {
      throw new LiveClientNotConfiguredError(
        'Live PricingAggregatorClient is not wired. ' +
          'Pablo has not approved paid-API spend during the build phase. ' +
          'Set MOCK_PRICING_AGGREGATOR=1 (default ON) and use ' +
          'MockPricingAggregatorClient instead, or land the ' +
          'T-DL-PRICING-AGGREGATOR-LIVE follow-up task.',
      );
    },
  };
}

/**
 * Read the `MOCK_PRICING_AGGREGATOR` environment flag. Default
 * ON when unset — explicit `'0'` or `'false'` is required to
 * opt out (and currently doing so just lands you on the live
 * stub above, which throws). Exposed as a helper so callers and
 * tests share the same parsing rule.
 */
export function isMockAggregatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['MOCK_PRICING_AGGREGATOR'];
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}
