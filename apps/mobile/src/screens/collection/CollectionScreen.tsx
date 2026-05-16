// `<CollectionScreen>` — the mobile collection home.
//
// Surface:
//
//   - Sign-in gate: signed-out users see a friendly prompt + a
//     primary CTA that pushes `/auth/sign-in`. The screen never
//     dispatches an authenticated query without a session — the
//     hooks gate on `enabled` so we don't leak 401s.
//   - Above-the-fold: `<CompletionBadge>` showing the user's
//     global All Pokémon % + supporting counts.
//   - Below: virtualized FlatList of per-set rows, sorted by
//     completion % descending then release_date descending. Each
//     row is a `<CollectionSetRow>` with Set / Master progress
//     bars.
//   - Pull-to-refresh wired to TanStack Query's refetch (both the
//     items query and the catalog sets query).
//   - Empty state: "Your collection is empty. Browse the catalog →"
//     deep-links into `(tabs)/browse`.
//   - Error / loading skeleton states.
//
// Data flow:
//
//   - `useAuth()` for the gate.
//   - `useCollectionItemsQuery({ enabled: signedIn })` from
//     `lib/collection` — owned printingIds.
//   - `useOwnedPrintingsContextQuery(printingIds)` — fans out
//     `getPrinting(id)` to enrich with cardId / setId /
//     includeInMasterSet (the math needs that mapping).
//   - `useSetsQuery()` from `lib/browse` — the full set catalog
//     for denominators + display.
//   - `summarizeCollection({ sets, owned })` from `lib/collection`
//     produces per-set + global summary in a memoized pass.
//
// Navigation: tap a row → push
// `/collection/sets/{set.canonicalKey}` (slug-based, mirroring
// `/sets/{slug}` in T-M-BROWSE for symmetry).

import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import { Button, Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { CollectionSetRow } from '../../components/collection/CollectionSetRow.js';
import { CompletionBadge } from '../../components/collection/CompletionBadge.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import { useSetsQuery } from '../../lib/browse/index.js';
import {
  compareSummariesForHome,
  summarizeCollection,
  useCollectionItemsQuery,
  useOwnedPrintingsContextQuery,
  type CollectionSetSummary,
} from '../../lib/collection/index.js';

export function CollectionScreen(): ReactNode {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const signedIn = session !== null;

  const itemsQuery = useCollectionItemsQuery({ enabled: signedIn });
  const itemPrintingIds = useMemo(
    () => (itemsQuery.data ?? []).map((item) => item.printingId),
    [itemsQuery.data],
  );
  const contextQuery = useOwnedPrintingsContextQuery(itemPrintingIds);
  const setsQuery = useSetsQuery();

  const sets = useMemo(() => setsQuery.data?.items ?? [], [setsQuery.data]);
  const ownedContexts = useMemo(
    () =>
      contextQuery.data.map((ctx) => ({
        printingId: ctx.id,
        cardId: ctx.cardId,
        setId: ctx.set.id,
        includeInMasterSet: ctx.includeInMasterSet,
      })),
    [contextQuery.data],
  );
  const summary = useMemo(
    () => summarizeCollection({ sets, owned: ownedContexts }),
    [sets, ownedContexts],
  );
  const sortedRows = useMemo(
    () => [...summary.perSet].sort(compareSummariesForHome),
    [summary],
  );

  const handleRefresh = useCallback(() => {
    void itemsQuery.refetch();
    void setsQuery.refetch();
  }, [itemsQuery, setsQuery]);

  const handleSelectRow = useCallback(
    (row: CollectionSetSummary) => {
      router.push(`/collection/sets/${encodeURIComponent(row.set.canonicalKey)}`);
    },
    [router],
  );

  const handleSignIn = useCallback(() => {
    router.push('/auth/sign-in');
  }, [router]);

  const handleBrowse = useCallback(() => {
    router.push('/(tabs)/browse');
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: CollectionSetSummary }) => (
      <CollectionSetRow summary={item} onPress={handleSelectRow} />
    ),
    [handleSelectRow],
  );

  // ---- Auth gate -----------------------------------------------
  if (authLoading) {
    return <CollectionLoadingState message="Loading your collection…" />;
  }
  if (!signedIn) {
    return <CollectionSignInPrompt onSignIn={handleSignIn} />;
  }

  // ---- Loading / error states -----------------------------------
  const isInitialLoad =
    itemsQuery.isLoading || setsQuery.isLoading || (contextQuery.isLoading && itemPrintingIds.length > 0);
  const queryError = itemsQuery.error ?? setsQuery.error ?? contextQuery.error;
  const hasError = itemsQuery.isError || setsQuery.isError || contextQuery.isError;

  if (isInitialLoad) {
    return <CollectionLoadingState />;
  }

  if (hasError && queryError !== null) {
    return (
      <CollectionErrorState
        message={queryError.message ?? 'Failed to load your collection.'}
        onRetry={handleRefresh}
      />
    );
  }

  const ownedCount = itemsQuery.data?.length ?? 0;
  // When the user owns nothing, show the empty surface above the
  // catalog list. Showing both keeps the global-completion-badge
  // anchor stable AND surfaces the "browse the catalog" CTA the
  // task spec calls out.
  const visibleRows = ownedCount === 0 ? [] : sortedRows;

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop="$6"
      testID="collection-screen"
    >
      <YStack paddingHorizontal="$4" paddingBottom="$2">
        <Text variant="title" tone="default">
          Collection
        </Text>
      </YStack>
      <FlatList
        data={visibleRows}
        keyExtractor={(item: CollectionSetSummary) => item.set.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={
              (itemsQuery.isFetching && !itemsQuery.isLoading) ||
              (setsQuery.isFetching && !setsQuery.isLoading)
            }
            onRefresh={handleRefresh}
            testID="collection-refresh"
          />
        }
        ListHeaderComponent={
          <YStack gap="$3" paddingHorizontal="$4" paddingBottom="$2">
            <CompletionBadge summary={summary.global} />
          </YStack>
        }
        ListEmptyComponent={
          ownedCount === 0 ? (
            <CollectionEmptyState onBrowse={handleBrowse} />
          ) : (
            <CollectionNoSetsState />
          )
        }
        testID="collection-list"
      />
    </YStack>
  );
}

// ============================================================
// Sub-states
// ============================================================

interface CollectionSignInPromptProps {
  readonly onSignIn: () => void;
}

function CollectionSignInPrompt(props: CollectionSignInPromptProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="collection-sign-in-prompt"
    >
      <YStack gap="$2" alignItems="center">
        <Text variant="title" tone="default">
          Sign in to see your collection
        </Text>
        <Text variant="body" tone="muted">
          Track set completion, master sets, and Pokémon coverage.
        </Text>
      </YStack>
      <Button
        label="Sign in"
        variant="primary"
        size="lg"
        onPress={props.onSignIn}
        accessibilityLabel="Sign in"
        testID="collection-sign-in-button"
      />
    </YStack>
  );
}

interface CollectionLoadingStateProps {
  readonly message?: string;
}

function CollectionLoadingState(props: CollectionLoadingStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="collection-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        {props.message ?? 'Loading your collection…'}
      </Text>
    </YStack>
  );
}

interface CollectionErrorStateProps {
  readonly message: string;
  readonly onRetry: () => void;
}

function CollectionErrorState(props: CollectionErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$6"
      testID="collection-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load your collection
      </Text>
      <Text variant="body" tone="muted">
        {props.message}
      </Text>
      <XStack
        role="button"
        aria-label="Retry"
        accessibilityLabel="Retry"
        testID="collection-error-retry"
        onPress={props.onRetry}
        paddingHorizontal="$4"
        paddingVertical="$2"
        borderRadius={8}
        borderWidth={1}
        borderColor="$border"
        cursor="pointer"
      >
        <Text variant="label" tone="default">
          Retry
        </Text>
      </XStack>
    </YStack>
  );
}

interface CollectionEmptyStateProps {
  readonly onBrowse: () => void;
}

function CollectionEmptyState(props: CollectionEmptyStateProps): ReactNode {
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$5"
      margin="$4"
      alignItems="center"
      testID="collection-empty"
    >
      <Text variant="subtitle" tone="default">
        Your collection is empty
      </Text>
      <Text variant="body" tone="muted">
        Add cards from the catalog to track set progress.
      </Text>
      <Button
        label="Browse the catalog"
        variant="primary"
        size="md"
        onPress={props.onBrowse}
        accessibilityLabel="Browse the catalog"
        testID="collection-empty-browse"
      />
    </Card>
  );
}

function CollectionNoSetsState(): ReactNode {
  return (
    <YStack
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="collection-no-sets"
    >
      <Text variant="subtitle" tone="default">
        No sets in the catalog yet
      </Text>
      <Text variant="body" tone="muted">
        Once the catalog finishes loading you’ll see set progress here.
      </Text>
    </YStack>
  );
}
