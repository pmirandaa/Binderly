'use client';

// `/collection/sets/[id]` per-set drill-down — header with
// progress bars (Set %, Master %, All Pokémon %) + an Owned /
// Missing tab pair.
//
// Tab state is mirrored to the URL via Next's `useRouter().replace`
// + `useSearchParams`. The brief allows either query-string OR
// local state; we picked the query string so a deep-link to
// `/collection/sets/abc?tab=missing` reproducibly opens the
// Missing tab — and it's the same pattern T-W-BROWSE uses for the
// `?next=` round-trip.
//
// 404 is signalled by `onNotFound()` — the route file wraps that
// in `next/navigation`'s `notFound()`. Keeping the navigation
// concern in the route file lets the view stay framework-light
// (tests don't have to mock `notFound()`), exactly mirroring
// T-W-BROWSE's `SetView`.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ApiNotFoundError } from '@binderly/api-client';
import type {
  CardWithPrintingsDto,
  CollectionItemDto,
  PrintingDto,
} from '@binderly/api-contracts';
import {
  computeCompletion,
  type ComputeCompletionResult,
} from '@binderly/set-completion';
import { Button, Card, Text, XStack, YStack } from '@binderly/ui';

import { ProgressBar } from './ProgressBar';
import {
  formatReleaseDate,
  languageLabel,
  printingDisplayName,
} from '../../lib/browse/format';
import {
  ownedPrintingIds,
  type CollectionApi,
  type SetContents,
} from '../../lib/collection/api';
import {
  conditionLabel,
  formatOwnedCount,
  languageBadge,
} from '../../lib/collection/format';
import { PrintingThumbnail } from '../browse/PrintingThumbnail';
import { PageLoading } from '../loading/PageLoading';

export type CollectionSetTab = 'owned' | 'missing';

export interface CollectionSetViewProps {
  api: CollectionApi;
  setId: string;
  /**
   * Optional initial tab. When omitted we read `?tab=` from the
   * URL via `useSearchParams`. Tests pass an explicit value so
   * they don't have to wire `useSearchParams`.
   */
  initialTab?: CollectionSetTab;
  /** Same router-coupling escape hatch tests use. */
  onTabChange?: (tab: CollectionSetTab) => void;
  /** Called when the set id doesn't exist — route wraps `notFound()`. */
  onNotFound?: () => void;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      data: SetContents;
      ownedItems: CollectionItemDto[];
      completion: ComputeCompletionResult;
      allPokemonPct: number;
    }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export function CollectionSetView(props: CollectionSetViewProps): React.ReactNode {
  const { api, setId, initialTab, onTabChange, onNotFound } = props;
  const router = useRouter();
  const searchParams = useSearchParams();

  // Parse `?tab=` once per render — `null` when the param is
  // absent OR set to a value we don't recognise. The presence
  // signal is what lets `initialTab` win in tests: we only sync
  // URL → state when an explicit URL value disagrees with local
  // state. Otherwise an unset URL would always reset back to the
  // 'owned' default and clobber the prop-driven initial tab.
  const rawTab = searchParams?.get('tab') ?? null;
  const urlTab = parseTabOrNull(rawTab);
  const [tab, setTab] = useState<CollectionSetTab>(initialTab ?? urlTab ?? 'owned');

  // Keep local tab in sync with the URL when it changes externally
  // (e.g. browser back/forward). We only react when the parsed URL
  // value is present AND disagrees with local state — avoids
  // infinite loops with the router.replace below.
  useEffect(() => {
    if (urlTab !== null && urlTab !== tab) setTab(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    // Three reads in parallel: this set's contents, the user's
    // owned items, and the catalog roster needed for the global
    // All Pokémon % computation. The roster fetch is by far the
    // most expensive call so the cheaper ones don't gate it.
    Promise.all([
      api.listSetContents(setId, controller.signal),
      api.listOwnedItems(controller.signal),
      api.catalogRoster(controller.signal),
    ])
      .then(([data, ownedItems, roster]) => {
        if (controller.signal.aborted) return;
        const ownedIds = ownedPrintingIds(ownedItems);
        const completion = computeCompletion({
          cards: roster.cards,
          printings: roster.printings,
          ownedPrintingIds: ownedIds,
          sets: [setId],
        });
        // The global all-pokemon % is the same regardless of
        // which set we asked for. We surface it alongside the per-
        // set bars per the brief.
        setState({
          kind: 'ready',
          data,
          ownedItems,
          completion,
          allPokemonPct: completion.global.allPokemonPct,
        });
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
            : 'Failed to load this set.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, setId]);

  function handleTabChange(next: CollectionSetTab): void {
    if (next === tab) return;
    setTab(next);
    onTabChange?.(next);
    // Mirror to the URL so deep-links work and back/forward feels
    // right. `router.replace` (not push) keeps the back button
    // pointed at the previous page, not the previous tab.
    try {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('tab', next);
      router.replace(`?${params.toString()}`);
    } catch {
      // Routers in test environments may throw on `replace` — the
      // local state update is the source of truth either way.
    }
  }

  if (state.kind === 'not-found') {
    // Defer to the route's `notFound()` if the wrapper provided
    // one; otherwise render an inline error so tests don't have
    // to mock the framework boundary.
    if (onNotFound !== undefined) onNotFound();
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="collection-set-page"
      >
        <Breadcrumb />
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="collection-set-error"
        >
          <Text variant="subtitle">Set not found</Text>
          <Text variant="body" tone="muted">
            We couldn&apos;t find that set in the catalog.
          </Text>
        </YStack>
      </YStack>
    );
  }

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="collection-set-page"
      >
        <Breadcrumb />
        <PageLoading label="Loading set…" />
      </YStack>
    );
  }

  if (state.kind === 'error') {
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="collection-set-page"
      >
        <Breadcrumb />
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="collection-set-error"
        >
          <Text variant="subtitle">Could not load this set</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { data, ownedItems, completion, allPokemonPct } = state;
  const { set, cards } = data;

  const ownedItemsByPrintingId = new Map<string, CollectionItemDto>();
  for (const item of ownedItems) ownedItemsByPrintingId.set(item.printingId, item);

  // `completion.perSet` was pinned to this set id only, so it has
  // exactly one entry. We render its math against the header bars.
  const setRow = completion.perSet[0]!;

  const ownedPrintings: Array<{ printing: PrintingDto; card: CardWithPrintingsDto; item: CollectionItemDto }> = [];
  const missingPrintings: Array<{ printing: PrintingDto; card: CardWithPrintingsDto }> = [];
  for (const card of cards) {
    for (const printing of card.printings) {
      const item = ownedItemsByPrintingId.get(printing.id);
      if (item !== undefined) {
        ownedPrintings.push({ printing, card, item });
      } else {
        missingPrintings.push({ printing, card });
      }
    }
  }

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="collection-set-page"
    >
      <Breadcrumb />

      <YStack gap="$2" data-testid="collection-set-header">
        <Text variant="title" data-testid="collection-set-header-name">
          {set.name}
        </Text>
        <Text variant="body" tone="muted" data-testid="collection-set-header-meta">
          {formatReleaseDate(set.releaseDate)} · {languageLabel(set.language)}
        </Text>
      </YStack>

      <Card
        variant="outlined"
        padding="$5"
        gap="$3"
        data-testid="collection-set-progress"
      >
        <ProgressBar
          label="Set"
          value={setRow.setPct}
          countLabel={formatOwnedCount(setRow.ownedNumbered, setRow.totalNumbered)}
          tone="set"
          size="lg"
          testId="collection-set-progress-set"
        />
        <ProgressBar
          label="Master"
          value={setRow.masterPct}
          countLabel={formatOwnedCount(setRow.ownedMaster, setRow.totalMaster)}
          tone="master"
          size="lg"
          testId="collection-set-progress-master"
        />
        <ProgressBar
          label="All Pokémon"
          value={allPokemonPct}
          tone="global"
          size="lg"
          testId="collection-set-progress-all-pokemon"
        />
      </Card>

      <XStack
        gap="$2"
        role="tablist"
        aria-label="Collection set tabs"
        data-testid="collection-set-tabs"
      >
        <Button
          label={`Owned (${ownedPrintings.length})`}
          variant={tab === 'owned' ? 'primary' : 'ghost'}
          size="sm"
          onPress={() => handleTabChange('owned')}
          data-testid="collection-set-tab-owned"
          aria-pressed={tab === 'owned'}
        />
        <Button
          label={`Missing (${missingPrintings.length})`}
          variant={tab === 'missing' ? 'primary' : 'ghost'}
          size="sm"
          onPress={() => handleTabChange('missing')}
          data-testid="collection-set-tab-missing"
          aria-pressed={tab === 'missing'}
        />
      </XStack>

      {tab === 'owned' ? (
        <YStack gap="$3" data-testid="collection-set-owned-panel" role="tabpanel">
          {ownedPrintings.length === 0 ? (
            <YStack
              padding="$5"
              gap="$2"
              backgroundColor="$surfaceMuted"
              borderRadius={12}
              data-testid="collection-set-owned-empty"
            >
              <Text variant="subtitle">No owned printings yet</Text>
              <Text variant="body" tone="muted">
                Add printings from this set to fill up your progress.
              </Text>
            </YStack>
          ) : (
            <XStack flexWrap="wrap" gap="$4" data-testid="collection-set-owned-grid">
              {ownedPrintings.map(({ printing, card, item }) => (
                <YStack key={printing.id} width={200} flexBasis={200} gap="$1">
                  <PrintingThumbnail
                    href={`/cards/${encodeURIComponent(printing.id)}`}
                    cardName={card.name}
                    cardNumber={card.number}
                    variantLabel={printing.variantClass
                      .replace(/_/g, ' ')
                      .toLowerCase()}
                    imageUrl={printing.imageSmallUrl}
                    altText={printingDisplayName({
                      cardName: card.name,
                      cardNumber: card.number,
                      variantClass: printing.variantClass,
                    })}
                  />
                  <XStack
                    gap="$2"
                    flexWrap="wrap"
                    data-testid="collection-set-owned-badges"
                  >
                    <Badge testId="collection-set-owned-condition">
                      {conditionLabel(item.condition)}
                    </Badge>
                    <Badge testId="collection-set-owned-language">
                      {languageBadge(card.language)}
                    </Badge>
                  </XStack>
                </YStack>
              ))}
            </XStack>
          )}
        </YStack>
      ) : (
        <YStack
          gap="$3"
          data-testid="collection-set-missing-panel"
          role="tabpanel"
        >
          {missingPrintings.length === 0 ? (
            <YStack
              padding="$5"
              gap="$2"
              backgroundColor="$surfaceMuted"
              borderRadius={12}
              data-testid="collection-set-missing-empty"
            >
              <Text variant="subtitle">Nothing missing</Text>
              <Text variant="body" tone="muted">
                You own every printing in this set. Congratulations!
              </Text>
            </YStack>
          ) : (
            <XStack
              flexWrap="wrap"
              gap="$4"
              data-testid="collection-set-missing-grid"
            >
              {missingPrintings.map(({ printing, card }) => (
                <YStack key={printing.id} width={200} flexBasis={200}>
                  <PrintingThumbnail
                    href={`/cards/${encodeURIComponent(printing.id)}`}
                    cardName={card.name}
                    cardNumber={card.number}
                    variantLabel={printing.variantClass
                      .replace(/_/g, ' ')
                      .toLowerCase()}
                    imageUrl={printing.imageSmallUrl}
                    altText={printingDisplayName({
                      cardName: card.name,
                      cardNumber: card.number,
                      variantClass: printing.variantClass,
                    })}
                  />
                </YStack>
              ))}
            </XStack>
          )}
        </YStack>
      )}

      <YStack
        padding="$3"
        gap="$1"
        backgroundColor="$surfaceMuted"
        borderRadius={8}
        data-testid="collection-set-value-placeholder"
      >
        <Text variant="caption" tone="muted">
          Total value coming soon.
        </Text>
      </YStack>
    </YStack>
  );
}

function parseTabOrNull(raw: string | null | undefined): CollectionSetTab | null {
  if (raw === 'missing') return 'missing';
  if (raw === 'owned') return 'owned';
  return null;
}

function Breadcrumb(): React.ReactNode {
  return (
    <Link
      href="/collection"
      style={{ textDecoration: 'none' }}
      data-testid="collection-set-back-link"
    >
      <Text variant="bodySmall" tone="primary">
        ← Back to collection
      </Text>
    </Link>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  testId?: string;
}

function Badge({ children, testId }: BadgeProps): React.ReactNode {
  return (
    <YStack
      paddingHorizontal="$2"
      paddingVertical="$1"
      backgroundColor="$surfaceMuted"
      borderRadius={6}
      data-testid={testId}
    >
      <Text variant="caption" tone="muted">
        {children}
      </Text>
    </YStack>
  );
}
