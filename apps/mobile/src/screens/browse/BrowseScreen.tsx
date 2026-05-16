// `<BrowseScreen>` — the mobile "browse the catalog" surface.
//
// Surface:
//
//   - Sticky-ish header: title + search input + filter chip row.
//   - Virtualized list of set rows (FlatList) sorted by
//     `release_date` descending.
//   - Pull-to-refresh wired to TanStack Query's `refetch`.
//   - Loading skeleton, error banner, and empty state for
//     filters that match nothing.
//
// Data flow:
//
//   - `useSetsQuery()` from `lib/browse` owns the network call
//     and cache.
//   - Local component state owns the three filter knobs
//     (language / series / search) and is purely client-side.
//   - `filterAndSortSets()` from `lib/browse/filters` collapses
//     the two halves into the renderable list. Memoized on
//     [data, filters] so the FlatList sees referentially stable
//     items across unrelated re-renders.
//
// Navigation:
//
//   - Tapping a set pushes `/sets/{set.canonicalKey}` via
//     expo-router's typed `router.push`. The route file at
//     `apps/mobile/app/sets/[slug].tsx` resolves to
//     `<SetScreen>`.

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import type { SetDto } from '@binderly/api-contracts';
import { Input, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { FilterChips } from '../../components/browse/FilterChips.js';
import { SetRow } from '../../components/browse/SetRow.js';
import {
  collectSeriesChips,
  EMPTY_FILTERS,
  filterAndSortSets,
  toggleSeries,
  useSetsQuery,
  type LanguageFilter,
} from '../../lib/browse/index.js';


export function BrowseScreen(): ReactNode {
  const router = useRouter();
  const query = useSetsQuery();
  const [language, setLanguage] = useState<LanguageFilter>(EMPTY_FILTERS.language);
  const [series, setSeries] = useState<ReadonlySet<string>>(EMPTY_FILTERS.series);
  const [search, setSearch] = useState(EMPTY_FILTERS.search);

  // Memoize the fallback so the empty-array identity is stable
  // across re-renders. Without this useMemo the `?? []` produces a
  // fresh array reference every render, busting downstream
  // useMemo dependencies (react-hooks/exhaustive-deps).
  const sets = useMemo(() => query.data?.items ?? [], [query.data]);

  const seriesOptions = useMemo(() => collectSeriesChips(sets), [sets]);
  const visibleSets = useMemo(
    () => filterAndSortSets(sets, { language, series, search }),
    [sets, language, series, search],
  );

  const handleRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const handleToggleSeries = useCallback((token: string) => {
    setSeries((current) => toggleSeries(current, token));
  }, []);

  const handleSelectSet = useCallback(
    (set: SetDto) => {
      router.push(`/sets/${encodeURIComponent(set.canonicalKey)}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: SetDto }) => <SetRow set={item} onPress={handleSelectSet} />,
    [handleSelectSet],
  );

  const isInitialLoad = query.isLoading;
  const hasError = query.isError;

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      testID="browse-screen"
      paddingTop="$6"
    >
      <YStack gap="$3" paddingHorizontal="$4" paddingBottom="$2">
        <Text variant="title" tone="default">
          Browse
        </Text>
        <Input
          aria-label="Search sets"
          accessibilityLabel="Search sets"
          placeholder="Search sets by name or code"
          value={search}
          onChangeText={setSearch}
          testID="browse-search"
        />
      </YStack>
      <FilterChips
        language={language}
        onLanguageChange={setLanguage}
        seriesOptions={seriesOptions}
        selectedSeries={series}
        onToggleSeries={handleToggleSeries}
      />
      {isInitialLoad ? (
        <BrowseLoadingState />
      ) : hasError ? (
        <BrowseErrorState
          message={query.error?.message ?? 'Failed to load sets.'}
          onRetry={handleRefresh}
        />
      ) : (
        <FlatList
          data={visibleSets}
          keyExtractor={(item: SetDto) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={query.isFetching && !query.isLoading}
              onRefresh={handleRefresh}
              testID="browse-refresh"
            />
          }
          ListEmptyComponent={
            <BrowseEmptyState
              hasFilters={
                language !== 'ALL' || series.size > 0 || search.trim().length > 0
              }
            />
          }
          ListFooterComponent={<BrowseFooterNote />}
          testID="browse-list"
        />
      )}
    </YStack>
  );
}

function BrowseLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="browse-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading sets…
      </Text>
    </YStack>
  );
}

interface BrowseErrorStateProps {
  readonly message: string;
  readonly onRetry: () => void;
}

function BrowseErrorState(props: BrowseErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$6"
      testID="browse-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load sets
      </Text>
      <Text variant="body" tone="muted">
        {props.message}
      </Text>
      <XStack
        role="button"
        aria-label="Retry"
        accessibilityLabel="Retry"
        testID="browse-error-retry"
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

interface BrowseEmptyStateProps {
  readonly hasFilters: boolean;
}

function BrowseEmptyState(props: BrowseEmptyStateProps): ReactNode {
  return (
    <YStack
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="browse-empty"
    >
      <Text variant="subtitle" tone="default">
        {props.hasFilters ? 'No sets match your filters' : 'No sets to browse yet'}
      </Text>
      <Text variant="body" tone="muted">
        {props.hasFilters
          ? 'Try clearing a filter or widening your search.'
          : 'Once the catalog finishes loading you’ll see sets here.'}
      </Text>
    </YStack>
  );
}

function BrowseFooterNote(): ReactNode {
  return (
    <YStack padding="$4" alignItems="center" testID="browse-footer-note">
      <Text variant="caption" tone="muted">
        Showing the first 200 sets · More results coming soon
      </Text>
    </YStack>
  );
}
