// `<PriceBlock>` — card-detail headline price (T-M-API-V2-WIRING).
//
// Replaces the `<CardScreen>` "Prices coming soon" placeholder.
// Composes:
//
//   - `useCurrentPriceQuery({ printingId })` — the V2
//     `/v1/printings/:id/current-price` endpoint via
//     `@binderly/api-client`'s `pricing.getPrintingCurrentPrice`.
//   - `@binderly/pricing-display`'s `formatPrice` — pure
//     Intl-backed currency formatter the package vends.
//
// Four render states (parent brief calls for loading + 404 +
// error explicitly):
//
//   - loading: spinner row.
//   - no-data: 404 collapsed into `data: null` (D3 in the task
//     brief). Renders "No price data yet" copy.
//   - error: retry affordance + the underlying error message.
//   - success: median price as the headline + range chips
//     (low / high) when present + a freshness badge.
//
// All amounts arrive as `numeric(12,2)` strings on the wire (per
// the Drizzle posture in `mv_current_price`); we parse to a
// `Number` exactly once here. `formatPrice` throws on
// non-finite inputs, so the parse step short-circuits to the
// no-data state defensively if the wire delivers a malformed
// string (shouldn't happen with `numericString2dpSchema`, but
// keeps the render path defensively flat).

import { type ReactNode } from 'react';

import type {
  PrintingCurrentPriceDto,
  PrintingCurrentPriceFreshness,
} from '@binderly/api-contracts';
import {
  formatPrice,
  isSupportedCurrency,
  type SupportedCurrency,
} from '@binderly/pricing-display';
import { Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { useCurrentPriceQuery } from '../../lib/pricing/index.js';

export interface PriceBlockProps {
  readonly printingId: string | undefined;
  readonly testID?: string;
}

export function PriceBlock(props: PriceBlockProps): ReactNode {
  const testID = props.testID ?? 'card-prices';
  const priceQuery = useCurrentPriceQuery({ printingId: props.printingId });

  if (props.printingId === undefined) {
    return <PriceBlockNoData testID={testID} reason="missing-printing" />;
  }

  if (priceQuery.isLoading) {
    return <PriceBlockLoading testID={testID} />;
  }

  if (priceQuery.isError) {
    return (
      <PriceBlockError
        testID={testID}
        message={priceQuery.error?.message ?? 'Failed to load price.'}
        onRetry={() => {
          void priceQuery.refetch();
        }}
      />
    );
  }

  if (priceQuery.data === null || priceQuery.data === undefined) {
    return <PriceBlockNoData testID={testID} reason="missing-row" />;
  }

  return <PriceBlockReady testID={testID} price={priceQuery.data} />;
}

// ============================================================
// Sub-states
// ============================================================

interface PriceBlockReadyProps {
  readonly price: PrintingCurrentPriceDto;
  readonly testID: string;
}

function PriceBlockReady(props: PriceBlockReadyProps): ReactNode {
  const { price, testID } = props;
  const currency = price.currency;
  const formattedMedian = formatAmount(price.medianPrice, currency);
  const formattedLow = formatAmount(price.lowPrice, currency);
  const formattedHigh = formatAmount(price.highPrice, currency);

  // No median ⇒ the row exists (the endpoint replied 200) but
  // every aggregate column is null because the rollup job emitted
  // a "no samples this window" placeholder. Surface that as the
  // no-data branch so the user sees consistent copy.
  if (formattedMedian === null) {
    return <PriceBlockNoData testID={testID} reason="no-samples" />;
  }

  return (
    <Card variant="outlined" gap="$2" testID={testID}>
      <XStack justifyContent="space-between" alignItems="baseline">
        <Text variant="label" tone="default">
          Prices
        </Text>
        <FreshnessBadge freshness={price.freshness} testID={`${testID}-freshness`} />
      </XStack>
      <XStack justifyContent="space-between" alignItems="baseline" gap="$3">
        <YStack gap="$1">
          <Text variant="caption" tone="muted">
            Median ({price.gradeTier} · {price.market})
          </Text>
          <Text variant="title" tone="default" testID={`${testID}-median`}>
            {formattedMedian}
          </Text>
        </YStack>
        <YStack gap="$1" alignItems="flex-end">
          <Text variant="caption" tone="muted">
            Range
          </Text>
          <Text variant="caption" tone="default" testID={`${testID}-range`}>
            {formattedLow !== null && formattedHigh !== null
              ? `${formattedLow} – ${formattedHigh}`
              : '—'}
          </Text>
        </YStack>
      </XStack>
      <Text variant="caption" tone="muted" testID={`${testID}-samples`}>
        Based on {price.sampleCount} sample{price.sampleCount === 1 ? '' : 's'}
      </Text>
    </Card>
  );
}

interface PriceBlockLoadingProps {
  readonly testID: string;
}

function PriceBlockLoading(props: PriceBlockLoadingProps): ReactNode {
  return (
    <Card variant="outlined" gap="$2" testID={props.testID}>
      <Text variant="label" tone="default">
        Prices
      </Text>
      <XStack gap="$2" alignItems="center" testID={`${props.testID}-loading`}>
        <Spinner size="sm" />
        <Text variant="caption" tone="muted">
          Loading price…
        </Text>
      </XStack>
    </Card>
  );
}

interface PriceBlockNoDataProps {
  readonly testID: string;
  readonly reason: 'missing-printing' | 'missing-row' | 'no-samples';
}

function PriceBlockNoData(props: PriceBlockNoDataProps): ReactNode {
  return (
    <Card variant="outlined" gap="$2" testID={props.testID}>
      <Text variant="label" tone="default">
        Prices
      </Text>
      <Text variant="caption" tone="muted" testID={`${props.testID}-no-data`}>
        {explainNoData(props.reason)}
      </Text>
    </Card>
  );
}

interface PriceBlockErrorProps {
  readonly testID: string;
  readonly message: string;
  readonly onRetry: () => void;
}

function PriceBlockError(props: PriceBlockErrorProps): ReactNode {
  return (
    <Card variant="outlined" gap="$2" testID={props.testID}>
      <Text variant="label" tone="default">
        Prices
      </Text>
      <Text variant="caption" tone="error" testID={`${props.testID}-error`}>
        {props.message}
      </Text>
      <XStack
        role="button"
        aria-label="Retry price load"
        accessibilityLabel="Retry price load"
        onPress={props.onRetry}
        paddingHorizontal="$3"
        paddingVertical="$1"
        borderRadius={8}
        borderWidth={1}
        borderColor="$border"
        alignSelf="flex-start"
        cursor="pointer"
        testID={`${props.testID}-retry`}
      >
        <Text variant="caption" tone="default">
          Retry
        </Text>
      </XStack>
    </Card>
  );
}

interface FreshnessBadgeProps {
  readonly freshness: PrintingCurrentPriceFreshness;
  readonly testID: string;
}

function FreshnessBadge(props: FreshnessBadgeProps): ReactNode {
  const label = freshnessLabel(props.freshness);
  const tone = props.freshness === 'fresh' ? 'default' : 'muted';
  return (
    <Text variant="caption" tone={tone} testID={props.testID}>
      {label}
    </Text>
  );
}

// ============================================================
// Helpers
// ============================================================

/**
 * Parse a `numericString2dpSchema` wire value (e.g. `'12.50'`)
 * into a localized currency string. Returns `null` for `null`
 * inputs, malformed strings, or unsupported currency codes —
 * the caller's no-data branch handles the render.
 *
 * `formatPrice` throws on `NaN` / invalid currency so we
 * pre-check; the result is a deterministic `string | null`.
 */
function formatAmount(amount: string | null, currency: string): string | null {
  if (amount === null) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  if (!isSupportedCurrency(currency)) return null;
  return formatPrice(value, currency as SupportedCurrency);
}

function freshnessLabel(freshness: PrintingCurrentPriceFreshness): string {
  switch (freshness) {
    case 'fresh':
      return 'Fresh';
    case 'stale':
      return 'Stale (7-30d)';
    case 'stale_old':
      return 'Stale (30d+)';
  }
}

function explainNoData(
  reason: 'missing-printing' | 'missing-row' | 'no-samples',
): string {
  switch (reason) {
    case 'missing-printing':
      return 'No printing selected.';
    case 'missing-row':
      return 'No price data yet for this printing.';
    case 'no-samples':
      return 'No samples in the current pricing window.';
  }
}
