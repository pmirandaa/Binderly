'use client';

// `/collection` home — global completion badge + list of sets the
// user has at least one owned printing in, sorted by completion %
// descending then release_date descending.
//
// Mirrors T-W-BROWSE's `BrowseView` pattern: takes the narrow
// `CollectionApi` (the read surface from `lib/collection/api.ts`)
// so tests can render this view directly with a fake api-client
// and skip the `getApiClient()` singleton entirely. The route
// component (`CollectionRoute`) is responsible for wiring the real
// api-client at runtime.
//
// Math: completion numbers come from the server via
// `client.collection.getCompletion()` (T-BE-EDGE-FUNCTIONS-V2,
// PR #68). The iter-17 on-device `computeCompletion()` fanout
// over `catalogRoster()` is gone — the server now returns the
// global tally + per-set rows directly in O(1) client round
// trips. See `open-questions.md` § Q-013 for the server-side
// stop-gap that hides behind this contract.

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { CompletionDto, SetDto } from '@binderly/api-contracts';
import { Button, Card, Text, XStack, YStack } from '@binderly/ui';

import { ProgressBar } from './ProgressBar';
import { formatReleaseDate } from '../../lib/browse/format';
import type { CollectionApi } from '../../lib/collection/api';
import {
  formatGlobalCount,
  formatOwnedCount,
  sortByCompletionThenRelease,
} from '../../lib/collection/format';
import { PageLoading } from '../loading/PageLoading';

export interface CollectionViewProps {
  api: CollectionApi;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      sets: SetDto[];
      completion: CompletionDto;
    }
  | { kind: 'error'; message: string };

export function CollectionView({ api }: CollectionViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    // Two parallel reads:
    //   1. the set catalog (public — supplies releaseDate +
    //      cover metadata the completion DTO doesn't carry)
    //   2. server-side completion (authed — returns global +
    //      per-set numbers directly)
    Promise.all([
      api.listAllSets(controller.signal),
      api.getCompletion(controller.signal),
    ])
      .then(([sets, completion]) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', sets, completion });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to load your collection.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api]);

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="collection-page"
      >
        <PageLoading label="Loading your collection…" />
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
        data-testid="collection-page"
      >
        <Text variant="title">Your collection</Text>
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="collection-error"
        >
          <Text variant="subtitle">Could not load your collection</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { sets, completion } = state;

  // Per-set rows: server returns one entry per set the user has at
  // least one owned printing in. We re-filter defensively (the
  // backend brief promises this filter; the client doesn't trust
  // it blindly).
  const perSetById = new Map<string, CompletionDto['perSet'][number]>();
  for (const row of completion.perSet) perSetById.set(row.setId, row);

  const setsWithOwned = sets.filter((s) => {
    const row = perSetById.get(s.id);
    return row !== undefined && row.ownedNumbered > 0;
  });

  const rows = setsWithOwned.map((set) => {
    const row = perSetById.get(set.id)!;
    return {
      set,
      row,
      completionPct: row.setPct,
      releaseDate: set.releaseDate,
      setId: set.id,
    };
  });
  const sortedRows = sortByCompletionThenRelease(rows);

  const global = completion.global;
  const isEmpty = global.uniqueCardsOwned === 0;

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="collection-page"
    >
      <YStack gap="$2">
        <Text variant="title">Your collection</Text>
        <Text variant="body" tone="muted">
          Track set progress, master sets, and your global All Pokémon %.
        </Text>
      </YStack>

      <Card
        variant="outlined"
        padding="$5"
        gap="$4"
        data-testid="collection-global-badge"
      >
        <YStack gap="$1">
          <Text variant="subtitle">Global completion</Text>
          <Text variant="caption" tone="muted">
            Across every set in the catalog.
          </Text>
        </YStack>
        <YStack gap="$3">
          <ProgressBar
            label="All Pokémon"
            value={global.allPokemonPct}
            countLabel={formatGlobalCount(
              global.uniqueCardsOwned,
              global.uniqueCardsTotal,
            )}
            tone="global"
            size="lg"
            testId="global-all-pokemon"
          />
          <ProgressBar
            label="Master"
            value={global.masterPct}
            countLabel={formatGlobalCount(global.masterOwned, global.masterTotal)}
            tone="master"
            size="lg"
            testId="global-master"
          />
        </YStack>
      </Card>

      {isEmpty ? (
        <YStack
          padding="$6"
          gap="$3"
          alignItems="center"
          data-testid="collection-empty"
        >
          <Text variant="subtitle">Your collection is empty</Text>
          <Text variant="body" tone="muted">
            Start by browsing the catalog and adding the printings you own.
          </Text>
          <Link
            href="/browse"
            style={{ textDecoration: 'none' }}
            data-testid="collection-empty-browse-link"
          >
            <Button label="Browse the catalog →" aria-label="Browse the catalog" />
          </Link>
        </YStack>
      ) : (
        <YStack gap="$4" data-testid="collection-set-list">
          <Text variant="subtitle">
            Sets you&apos;ve started ({sortedRows.length})
          </Text>
          {sortedRows.length === 0 ? (
            <YStack
              padding="$5"
              gap="$2"
              backgroundColor="$surfaceMuted"
              borderRadius={12}
              data-testid="collection-no-set-rows"
            >
              <Text variant="body" tone="muted">
                You own printings that aren&apos;t mapped to any set in the catalog
                yet. Browse the catalog to confirm the set list is in sync.
              </Text>
            </YStack>
          ) : (
            <YStack gap="$3">
              {sortedRows.map(({ set, row }) => (
                <CollectionSetRow
                  key={set.id}
                  set={set}
                  ownedNumbered={row.ownedNumbered}
                  totalNumbered={row.totalNumbered}
                  setPct={row.setPct}
                  masterPct={row.masterPct}
                  ownedMaster={row.ownedMaster}
                  totalMaster={row.totalMaster}
                  allPokemonPct={global.allPokemonPct}
                />
              ))}
            </YStack>
          )}
        </YStack>
      )}
    </YStack>
  );
}

interface CollectionSetRowProps {
  set: SetDto;
  ownedNumbered: number;
  totalNumbered: number;
  setPct: number;
  masterPct: number;
  ownedMaster: number;
  totalMaster: number;
  /**
   * Global All-Pokémon % rendered on every row per the brief. It
   * is the same value for every row — a tiny redundancy in the
   * markup, but it answers "what fraction of all Pokémon I'm
   * tracking does this set move?" at a glance.
   */
  allPokemonPct: number;
}

function CollectionSetRow(props: CollectionSetRowProps): React.ReactNode {
  const { set, ownedNumbered, totalNumbered, setPct, masterPct, ownedMaster, totalMaster, allPokemonPct } = props;
  return (
    <Link
      href={`/collection/sets/${encodeURIComponent(set.id)}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      data-testid="collection-set-row-link"
    >
      <Card
        variant="outlined"
        padding="$4"
        gap="$3"
        hoverStyle={{ borderColor: '$primary' }}
        focusStyle={{ borderColor: '$primary' }}
        data-testid="collection-set-row"
      >
        <XStack
          justifyContent="space-between"
          alignItems="baseline"
          gap="$3"
          flexWrap="wrap"
        >
          <YStack gap="$1">
            <Text variant="subtitle" data-testid="collection-set-row-name">
              {set.name}
            </Text>
            <Text variant="caption" tone="muted" data-testid="collection-set-row-meta">
              {formatReleaseDate(set.releaseDate)}
            </Text>
          </YStack>
        </XStack>
        <YStack gap="$2">
          <ProgressBar
            label="Set"
            value={setPct}
            countLabel={formatOwnedCount(ownedNumbered, totalNumbered)}
            tone="set"
            testId="collection-set-row-set"
          />
          <ProgressBar
            label="Master"
            value={masterPct}
            countLabel={formatOwnedCount(ownedMaster, totalMaster)}
            tone="master"
            testId="collection-set-row-master"
          />
          <ProgressBar
            label="All Pokémon"
            value={allPokemonPct}
            tone="global"
            testId="collection-set-row-all-pokemon"
          />
        </YStack>
      </Card>
    </Link>
  );
}
