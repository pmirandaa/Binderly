'use client';

// Headline current-price block on the card-detail page. Renders
// loading / 404 / error / present states sourced from
// `BrowseApi.getCurrentPrice` (which wraps the V2 endpoint
// shipped by T-BE-EDGE-FUNCTIONS-V2 — PR #68). The trends
// columns named in `context/data-model.md § mv_current_price`
// are NOT carried by the V2 DTO yet (see Q-013); the surface
// is forward-compatible if a follow-up adds them.

import { useEffect, useState } from 'react';

import type { PrintingCurrentPriceDto } from '@binderly/api-contracts';
import { formatPrice, isSupportedCurrency } from '@binderly/pricing-display';
import { Card, Text, XStack, YStack } from '@binderly/ui';

import {
  formatCurrentPriceComputedAt,
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
  return (
    <YStack gap="$2" data-testid="card-prices-present">
      <XStack gap="$3" flexWrap="wrap" alignItems="baseline">
        {median !== null && safe ? (
          <Text variant="title" data-testid="card-prices-median">
            {formatPrice(median, price.currency)}
          </Text>
        ) : null}
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
    </YStack>
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
