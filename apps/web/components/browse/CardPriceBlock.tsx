'use client';

// Headline current-price block on the card-detail page. Renders
// loading / 404 / error / present states sourced from
// `BrowseApi.getCurrentPrice` (which wraps the V2 endpoint
// shipped by T-BE-EDGE-FUNCTIONS-V2 — PR #68).
//
// The `mv_current_price` v2 trend + freshness columns (migration
// `0028` / #FU-5) are surfaced here (#FU-66 / Q-028): the headline
// arrow + signed 30-day % change reads from the server-bucketed
// `trendDirection` + `trend30dPct` (the ±1% dead-band lives in SQL),
// and a "Last seen" line reads from `lastObservationAt`. The existing
// `freshness` badge stays anchored on `computedAt` (backward-compatible)
// — see Q-028 for the full display-semantics rationale.

import { useEffect, useState } from 'react';

import type { PrintingCurrentPriceDto } from '@binderly/api-contracts';
import {
  formatPrice,
  formatTrendPercent,
  hasRenderableTrend,
  isSupportedCurrency,
  trendArrow,
  trendDirectionLabel,
} from '@binderly/pricing-display';
import { Card, Text, XStack, YStack } from '@binderly/ui';

import {
  formatCurrentPriceComputedAt,
  formatLastSeenAt,
  freshnessLabel,
} from '../../lib/browse/format';

import type { BrowseApi } from '../../lib/browse/api';

export interface CardPriceBlockProps {
  api: BrowseApi;
  printingId: string;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'absent' }
  | { kind: 'present'; price: PrintingCurrentPriceDto }
  | { kind: 'error'; message: string };

export function CardPriceBlock({ api, printingId }: CardPriceBlockProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api
      .getCurrentPrice(printingId, controller.signal)
      .then((price) => {
        if (controller.signal.aborted) return;
        if (price === null) {
          setState({ kind: 'absent' });
          return;
        }
        setState({ kind: 'present', price });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to load pricing data.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, printingId]);

  return (
    <Card variant="outlined" padding="$4" gap="$3" data-testid="card-prices">
      <Text variant="subtitle">Prices</Text>
      <Body state={state} />
    </Card>
  );
}

function Body({ state }: { state: FetchState }): React.ReactNode {
  if (state.kind === 'loading') {
    return (
      <YStack gap="$1" data-testid="card-prices-loading">
        <Text variant="body" tone="muted">
          Loading pricing data…
        </Text>
      </YStack>
    );
  }
  if (state.kind === 'absent') {
    return (
      <YStack gap="$1" data-testid="card-prices-absent" role="status">
        <Text variant="body" tone="muted">
          No pricing data yet. We&apos;ll publish a headline price as soon as
          enough observations land for this printing.
        </Text>
      </YStack>
    );
  }
  if (state.kind === 'error') {
    return (
      <YStack
        gap="$1"
        data-testid="card-prices-error"
        role="alert"
        backgroundColor="$surfaceMuted"
        borderRadius={8}
        padding="$3"
      >
        <Text variant="body" tone="muted">
          Could not load pricing data.
        </Text>
        <Text variant="caption" tone="muted">
          {state.message}
        </Text>
      </YStack>
    );
  }
  return <PresentBody price={state.price} />;
}

function PresentBody({ price }: { price: PrintingCurrentPriceDto }): React.ReactNode {
  const median = parseNumericString(price.medianPrice);
  const low = parseNumericString(price.lowPrice);
  const high = parseNumericString(price.highPrice);
  // A degenerate row (`sampleCount: 0`, all-null prices) is
  // technically possible when the rollup ran but found no
  // observations. Treat that exactly like the absent state so the
  // UI doesn't dangle a "$NaN" chip.
  if (median === null && low === null && high === null) {
    return (
      <YStack gap="$1" data-testid="card-prices-empty-row" role="status">
        <Text variant="body" tone="muted">
          No pricing data yet for this printing.
        </Text>
      </YStack>
    );
  }
  const safe = isSupportedCurrency(price.currency);
  const lastSeen = formatLastSeenAt(price.lastObservationAt);
  return (
    <YStack gap="$2" data-testid="card-prices-present">
      <XStack gap="$3" flexWrap="wrap" alignItems="baseline">
        {median !== null && safe ? (
          <Text variant="title" data-testid="card-prices-median">
            {formatPrice(median, price.currency)}
          </Text>
        ) : null}
        <TrendChip
          direction={price.trendDirection}
          trend30dPct={price.trend30dPct}
        />
        <FreshnessChip freshness={price.freshness} />
      </XStack>
      {low !== null && high !== null && safe ? (
        <Text variant="bodySmall" tone="muted" data-testid="card-prices-range">
          Range {formatPrice(low, price.currency)}–{formatPrice(high, price.currency)}
        </Text>
      ) : null}
      <Text variant="caption" tone="muted" data-testid="card-prices-meta">
        {price.sampleCount} observation{price.sampleCount === 1 ? '' : 's'} · updated{' '}
        {formatCurrentPriceComputedAt(price.computedAt)}
      </Text>
      {lastSeen !== null ? (
        <Text variant="caption" tone="muted" data-testid="card-prices-last-seen">
          Last seen {lastSeen}
        </Text>
      ) : null}
    </YStack>
  );
}

const TREND_TONE = {
  up: 'success',
  down: 'error',
  flat: 'muted',
} as const;

/**
 * Headline 30-day trend: the server-bucketed `trendDirection`
 * (±1% dead-band, computed in `mv_current_price`) renders the arrow
 * + colour, and `trend30dPct` renders the signed % change. Suppressed
 * entirely when the direction is `unknown` / absent (no 30-day
 * reference) or the percentage is unformattable.
 */
function TrendChip({
  direction,
  trend30dPct,
}: {
  direction: PrintingCurrentPriceDto['trendDirection'];
  trend30dPct: PrintingCurrentPriceDto['trend30dPct'];
}): React.ReactNode {
  if (direction === undefined || !hasRenderableTrend(direction)) return null;
  const pct = formatTrendPercent(trend30dPct);
  if (pct === null) return null;
  const tone = TREND_TONE[direction];
  return (
    <XStack
      paddingHorizontal="$2"
      paddingVertical="$1"
      backgroundColor="$surfaceMuted"
      borderRadius={6}
      gap="$1"
      alignItems="baseline"
      data-testid={`card-prices-trend-${direction}`}
      aria-label={`30-day price trend ${trendDirectionLabel(direction)} ${pct}`}
    >
      <Text variant="caption" tone={tone}>
        {trendArrow(direction)} {pct}
      </Text>
      <Text variant="caption" tone="muted">
        30d
      </Text>
    </XStack>
  );
}

function FreshnessChip({
  freshness,
}: {
  freshness: PrintingCurrentPriceDto['freshness'];
}): React.ReactNode {
  return (
    <YStack
      paddingHorizontal="$2"
      paddingVertical="$1"
      backgroundColor="$surfaceMuted"
      borderRadius={6}
      data-testid={`card-prices-freshness-${freshness}`}
    >
      <Text variant="caption" tone="muted">
        {freshnessLabel(freshness)}
      </Text>
    </YStack>
  );
}

/**
 * `mv_current_price` exposes numeric columns as strings on the
 * wire (see `numericString2dpSchema` in `@binderly/api-contracts`).
 * Convert to a finite number for `formatPrice`; nullable + bad
 * inputs return `null` so the caller can skip the chip.
 */
function parseNumericString(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
