'use client';

// Per-printing detail view. URL is `/cards/[id]` (named "cards"
// because users think of them as cards, but `[id]` is a printing
// UUID so a single page can render set / card / variant context
// in one fetch via `getPrinting()`).
//
// Sections (per the T-W-BROWSE brief):
//   - Hero image + metadata (set, number, rarity, illustrator, language, variant).
//   - Prices placeholder (wired by T-SP-PRICING-DISPLAY).
//   - "Add to collection" disabled button with sign-in tooltip
//     (wired by T-W-COLLECTION).

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiNotFoundError } from '@binderly/api-client';
import type { PrintingWithContextDto } from '@binderly/api-contracts';
import { Button, Card, Text, XStack, YStack } from '@binderly/ui';

import { formatReleaseDate, languageLabel, rarityLabel } from '../../lib/browse/format';
import { BuyCta } from '../buy-cta';
import { PageLoading } from '../loading/PageLoading';

import type { BrowseApi } from '../../lib/browse/api';

export interface CardViewProps {
  api: BrowseApi;
  printingId: string;
  onNotFound?: () => void;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: PrintingWithContextDto }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

const ADD_TO_COLLECTION_TOOLTIP = 'Sign in to track your collection';

export function CardView({ api, printingId, onNotFound }: CardViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api
      .getPrintingDetail(printingId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ApiNotFoundError) {
          setState({ kind: 'not-found' });
          return;
        }
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to load this card.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, printingId]);

  if (state.kind === 'not-found') {
    // See SetView.tsx — `notFound()` must run during render.
    if (onNotFound !== undefined) onNotFound();
    return (
      <YStack padding="$6" gap="$4" maxWidth={1200} marginHorizontal="auto" data-testid="card-page">
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="card-error"
          role="alert"
        >
          <Text variant="subtitle">Card not found</Text>
          <Text variant="body" tone="muted">
            We couldn&apos;t find that card in the catalog.
          </Text>
        </YStack>
      </YStack>
    );
  }

  if (state.kind === 'loading') {
    return (
      <YStack padding="$6" gap="$4" maxWidth={1200} marginHorizontal="auto" data-testid="card-page">
        <PageLoading label="Loading card…" />
      </YStack>
    );
  }

  if (state.kind === 'error') {
    return (
      <YStack padding="$6" gap="$4" maxWidth={1200} marginHorizontal="auto" data-testid="card-page">
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="card-error"
          role="alert"
        >
          <Text variant="subtitle">Could not load this card</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { data } = state;
  const { card, set } = data;
  const heroImage = data.imageLargeUrl ?? data.imageSmallUrl;
  const variantLabel = data.variantClass.replace(/_/g, ' ').toLowerCase();

  return (
    <YStack padding="$6" gap="$5" maxWidth={1200} marginHorizontal="auto" data-testid="card-page">
      <Link
        href={`/sets/${encodeURIComponent(set.id)}`}
        style={{ textDecoration: 'none' }}
        data-testid="card-back-link"
      >
        <Text variant="bodySmall" tone="primary">
          ← Back to {set.name}
        </Text>
      </Link>

      <XStack gap="$5" flexWrap="wrap" alignItems="flex-start">
        <YStack
          flexBasis={360}
          width={360}
          maxWidth="100%"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          padding="$3"
          alignItems="center"
          justifyContent="center"
          minHeight={400}
          data-testid="card-hero"
        >
          {heroImage !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroImage}
              alt={`${card.name} #${card.number}`}
              style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }}
              data-testid="card-hero-image"
            />
          ) : (
            <Text variant="body" tone="muted" data-testid="card-hero-fallback">
              Image not available
            </Text>
          )}
        </YStack>

        <YStack flex={1} minWidth={280} gap="$4">
          <YStack gap="$1" data-testid="card-meta">
            <Text variant="title" data-testid="card-meta-name">
              {card.name}
            </Text>
            <Text variant="bodySmall" tone="muted" data-testid="card-meta-subtitle">
              #{card.number} · {set.name}
            </Text>
          </YStack>

          <YStack gap="$2" data-testid="card-meta-grid">
            <MetaRow label="Set" value={set.name} />
            <MetaRow label="Number" value={card.number} />
            <MetaRow label="Variant" value={variantLabel} />
            <MetaRow label="Rarity" value={rarityLabel(card.rarity)} />
            <MetaRow label="Illustrator" value={card.illustrator ?? 'Unknown'} />
            <MetaRow label="Language" value={languageLabel(card.language)} />
            <MetaRow label="Released" value={formatReleaseDate(set.releaseDate)} />
          </YStack>

          <Card variant="outlined" padding="$4" gap="$2" data-testid="card-prices-placeholder">
            <Text variant="subtitle">Prices</Text>
            <Text variant="body" tone="muted">
              Pricing graphs land with the pricing-display package. We&apos;ll surface current
              market prices, grade-tier breakouts, and history here once that work merges.
            </Text>
          </Card>

          <Card variant="outlined" padding="$4" gap="$3" data-testid="card-buy">
            <Text variant="subtitle">Buy</Text>
            <Text variant="body" tone="muted">
              Open this card on TCGplayer. Binderly earns a small affiliate commission on purchases
              — see our pricing &amp; disclosure footer.
            </Text>
            <BuyCta
              card={{
                cardName: card.name,
                setName: set.name,
                number: card.number,
              }}
            />
          </Card>

          <Card variant="outlined" padding="$4" gap="$3" data-testid="card-add-placeholder">
            <Text variant="subtitle">Add to collection</Text>
            <Text variant="body" tone="muted">
              Tracking lands with the collection task. For now, sign in and head to your collection
              to add cards manually or via the scanner on mobile.
            </Text>
            <span title={ADD_TO_COLLECTION_TOOLTIP} data-testid="card-add-tooltip">
              <Button
                label="Add to collection"
                disabled
                data-testid="card-add-button"
                aria-label={ADD_TO_COLLECTION_TOOLTIP}
              />
            </span>
          </Card>
        </YStack>
      </XStack>
    </YStack>
  );
}

function MetaRow({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <XStack gap="$3" data-testid={`card-meta-row-${label.toLowerCase()}`}>
      <Text variant="label" tone="muted" minWidth={100}>
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </XStack>
  );
}
