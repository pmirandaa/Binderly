'use client';

// Public shareable surface — read-only snapshot of a user's
// collection rendered for an anonymous visitor at
// `/c/[handle]/[slug]`. No auth gate, no edit affordance.
//
// Mirrors T-W-COLLECTION's `<CollectionView>` shape (header +
// progress + grid) but everything is keyed off a single
// `PublicSharePayload` so SSR + OG-image renders agree on the
// exact same numbers. The `ShareApi` prop is the injectable
// seam; tests pass a fake, the production page wires
// `apiToShareApi(getApiClient())` lazily in
// `<ShareableRoute>`.
//
// Why a `'use client'` component and not a true server
// component: T-W-BROWSE / T-W-COLLECTION established that the
// page entry-points stay `force-dynamic` server components that
// render a thin client wrapper. That keeps `next build` from
// dereferencing `getApiClient()` at static-prerender time. The
// shareable surface still gets server-side OG meta via
// `generateMetadata()` and a separate `opengraph-image.tsx`
// route — both of which DO run server-side at request time.

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button, Card, Text, XStack, YStack } from '@binderly/ui';

import { MemberTile } from './MemberTile';
import {
  formatCardTally,
  formatLastUpdated,
  formatOwnedShort,
  formatPercent,
  publicShareUrl,
} from '../../lib/share/format';
import { PageLoading } from '../loading/PageLoading';

import type { PublicSharePayload, ShareApi } from '../../lib/share/api';

export interface ShareableViewProps {
  api: ShareApi;
  handle: string;
  slug: string;
  /**
   * Test seam: when the api returns `null` the view calls
   * `onNotFound()` (if provided) so the page can route to
   * `notFound()`. In tests we assert this prop is invoked
   * exactly once.
   */
  onNotFound?: () => void;
  /**
   * Optional override for the "last updated" relative-time
   * computation so deterministic snapshot-style tests don't
   * drift with wall-clock.
   */
  now?: Date;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: PublicSharePayload }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export function ShareableView({
  api,
  handle,
  slug,
  onNotFound,
  now,
}: ShareableViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api
      .getPublicSharePayload({ handle, slug, signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (payload === null) {
          setState({ kind: 'not-found' });
          return;
        }
        setState({ kind: 'ready', payload });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Could not load this shareable.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, handle, slug]);

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="share-page"
      >
        <PageLoading label="Loading shareable…" />
      </YStack>
    );
  }

  if (state.kind === 'not-found') {
    // The page's server component calls `notFound()` when it can;
    // when the api throws 404 client-side (or the view is mounted
    // standalone in tests) we surface the empty state inline.
    if (onNotFound !== undefined) onNotFound();
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="share-page"
      >
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="share-not-found"
          role="alert"
        >
          <Text variant="subtitle">Shareable not found</Text>
          <Text variant="body" tone="muted">
            This shareable doesn&apos;t exist — or the owner unpublished it.
          </Text>
          <Link href="/" style={{ textDecoration: 'none' }} data-testid="share-not-found-home">
            <Text variant="bodySmall" tone="primary">
              ← Back to Binderly
            </Text>
          </Link>
        </YStack>
      </YStack>
    );
  }

  if (state.kind === 'error') {
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="share-page"
      >
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="share-error"
          role="alert"
        >
          <Text variant="subtitle">Could not load this shareable</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { payload } = state;
  const { owner, counts, members, collectionTitle, description, lastUpdatedAt } = payload;
  const ownerLabel = owner.displayName ?? `@${owner.handle}`;
  const hasCounts = counts.catalogTotal > 0;

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="share-page"
    >
      <YStack gap="$2" data-testid="share-header">
        <Text variant="caption" tone="muted" data-testid="share-header-owner">
          {ownerLabel} · @{owner.handle}
        </Text>
        <Text variant="title" data-testid="share-header-title">
          {collectionTitle}
        </Text>
        {description !== null ? (
          <Text variant="body" tone="muted" data-testid="share-header-description">
            {description}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted" data-testid="share-header-updated">
          Last updated {formatLastUpdated(lastUpdatedAt, now)}
        </Text>
      </YStack>

      <Card
        variant="outlined"
        padding="$5"
        gap="$3"
        data-testid="share-summary"
      >
        <Text variant="subtitle">Collection snapshot</Text>
        {hasCounts ? (
          <XStack gap="$5" flexWrap="wrap">
            <SummaryStat
              label="Cards owned"
              value={formatCardTally(counts.ownedUnique, counts.catalogTotal)}
              testId="share-summary-tally"
            />
            <SummaryStat
              label="Completion"
              value={formatPercent(counts.completionPct)}
              testId="share-summary-completion"
            />
            {counts.ownedTotalQuantity !== counts.ownedUnique ? (
              <SummaryStat
                label="Total copies"
                value={String(counts.ownedTotalQuantity)}
                testId="share-summary-quantity"
              />
            ) : null}
          </XStack>
        ) : (
          <Text variant="body" tone="muted" data-testid="share-summary-empty">
            {formatOwnedShort(counts.ownedUnique)}
          </Text>
        )}
      </Card>

      <YStack gap="$4" data-testid="share-member-grid">
        <Text variant="subtitle">
          Cards in this shareable ({members.length})
        </Text>
        {members.length === 0 ? (
          <YStack
            padding="$5"
            gap="$2"
            backgroundColor="$surfaceMuted"
            borderRadius={12}
            data-testid="share-member-empty"
          >
            <Text variant="body" tone="muted">
              The owner hasn&apos;t added any cards to this shareable yet.
            </Text>
          </YStack>
        ) : (
          <XStack
            gap="$3"
            flexWrap="wrap"
            data-testid="share-member-list"
          >
            {members.map((member) => (
              <YStack
                key={member.printingId}
                width={180}
                data-testid="share-member-cell"
              >
                <MemberTile member={member} />
              </YStack>
            ))}
          </XStack>
        )}
      </YStack>

      <Card
        variant="outlined"
        padding="$4"
        gap="$2"
        data-testid="share-footer"
      >
        <Text variant="bodySmall" tone="muted" data-testid="share-footer-url">
          {publicShareUrl(handle, slug)}
        </Text>
        <XStack gap="$3" alignItems="center" flexWrap="wrap">
          <Text variant="body" tone="muted">
            Powered by Binderly — your collection, your way.
          </Text>
          <Link
            href="/auth/sign-in?signup=1"
            style={{ textDecoration: 'none' }}
            data-testid="share-signup-link"
          >
            <Button
              label="Sign up free →"
              aria-label="Sign up free to build your own shareable"
              data-testid="share-signup-button"
            />
          </Link>
        </XStack>
      </Card>
    </YStack>
  );
}

interface SummaryStatProps {
  label: string;
  value: string;
  testId: string;
}

function SummaryStat({ label, value, testId }: SummaryStatProps): React.ReactNode {
  return (
    <YStack gap="$1" data-testid={testId}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="subtitle">{value}</Text>
    </YStack>
  );
}
