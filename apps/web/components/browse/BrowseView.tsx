'use client';

// Top-level browse surface — list of all sets with language /
// series / search filters. Takes a `BrowseApi` (the narrow read
// surface from `lib/browse/api.ts`) so tests can render this
// view directly with a fake api-client and skip the
// `getApiClient()` singleton entirely.
//
// Filters are client-side because the catalog is bounded (≤ 1000
// sets across English + Japanese in v1) and the filter UX wants
// instant feedback. When the catalog grows past a few thousand
// items we'll move filtering server-side via api-client query
// params.

import { useEffect, useMemo, useState } from 'react';

import type { Language, SetDto } from '@binderly/api-contracts';
import { Button, Input, Text, XStack, YStack } from '@binderly/ui';

import { SetCard } from './SetCard';
import {
  formatReleaseDate,
  languageLabel,
  sortSetsByReleaseDateDesc,
} from '../../lib/browse/format';
import { useDebouncedValue } from '../../lib/browse/use-debounce';
import { PageLoading } from '../loading/PageLoading';

import type { BrowseApi } from '../../lib/browse/api';

const LANGUAGE_OPTIONS: ReadonlyArray<{ value: 'all' | Language; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'en', label: 'English' },
  { value: 'jp', label: 'Japanese' },
];

const SEARCH_DEBOUNCE_MS = 200;
const NO_SERIES_LABEL = '(no series)';

export interface BrowseViewProps {
  api: BrowseApi;
  /** Test seam — disable the search debounce for deterministic assertions. */
  searchDebounceMs?: number;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; sets: SetDto[] }
  | { kind: 'error'; message: string };

export function BrowseView({
  api,
  searchDebounceMs = SEARCH_DEBOUNCE_MS,
}: BrowseViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [language, setLanguage] = useState<'all' | Language>('all');
  const [selectedSeries, setSelectedSeries] = useState<ReadonlySet<string>>(() => new Set());
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, searchDebounceMs);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api
      .listAllSets(controller.signal)
      .then((sets) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', sets });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to load sets.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api]);

  const allSeries = useMemo(() => {
    if (state.kind !== 'ready') return [] as string[];
    const labels = new Set<string>();
    for (const set of state.sets) {
      labels.add(set.series ?? NO_SERIES_LABEL);
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [state]);

  const filtered = useMemo(() => {
    if (state.kind !== 'ready') return [] as SetDto[];
    const search = debouncedSearch.trim().toLowerCase();
    const out: SetDto[] = [];
    for (const set of state.sets) {
      if (language !== 'all' && set.language !== language) continue;
      if (selectedSeries.size > 0) {
        const seriesKey = set.series ?? NO_SERIES_LABEL;
        if (!selectedSeries.has(seriesKey)) continue;
      }
      if (search.length > 0 && !set.name.toLowerCase().includes(search)) continue;
      out.push(set);
    }
    return sortSetsByReleaseDateDesc(out);
  }, [state, language, selectedSeries, debouncedSearch]);

  function toggleSeries(name: string): void {
    setSelectedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function clearFilters(): void {
    setLanguage('all');
    setSelectedSeries(new Set());
    setSearchInput('');
  }

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1200}
      marginHorizontal="auto"
      data-testid="browse-page"
    >
      <YStack gap="$2">
        <Text variant="title">Browse sets</Text>
        <Text variant="body" tone="muted">
          Every set in the catalog, newest first. Filter by language or series, or search by
          name.
        </Text>
      </YStack>

      <YStack gap="$4" data-testid="browse-filters">
        <XStack gap="$3" flexWrap="wrap" alignItems="center" data-testid="browse-language-filter">
          <Text variant="label">Language:</Text>
          {LANGUAGE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              label={option.label}
              variant={language === option.value ? 'primary' : 'ghost'}
              size="sm"
              onPress={() => setLanguage(option.value)}
              data-testid={`browse-language-${option.value}`}
              aria-label={`Filter by ${option.label} language`}
              aria-pressed={language === option.value}
            />
          ))}
        </XStack>

        {allSeries.length > 0 ? (
          <XStack gap="$2" flexWrap="wrap" alignItems="center" data-testid="browse-series-filter">
            <Text variant="label">Series:</Text>
            {allSeries.map((name) => {
              const active = selectedSeries.has(name);
              return (
                <Button
                  key={name}
                  label={name}
                  variant={active ? 'primary' : 'ghost'}
                  size="sm"
                  onPress={() => toggleSeries(name)}
                  data-testid={`browse-series-${slugify(name)}`}
                  aria-pressed={active}
                />
              );
            })}
          </XStack>
        ) : null}

        <XStack gap="$3" alignItems="flex-end" flexWrap="wrap">
          <YStack flexGrow={1} minWidth={240}>
            <Input
              label="Search by set name"
              placeholder="e.g. Brilliant Stars"
              value={searchInput}
              onChangeText={setSearchInput}
              aria-label="Search sets by name"
              testID="browse-search-input"
            />
          </YStack>
          <Button
            label="Clear filters"
            variant="ghost"
            onPress={clearFilters}
            data-testid="browse-clear-filters"
          />
        </XStack>
      </YStack>

      {state.kind === 'loading' ? (
        <PageLoading label="Loading sets…" />
      ) : null}

      {state.kind === 'error' ? (
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="browse-error"
          role="alert"
        >
          <Text variant="subtitle">Could not load sets</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          {filtered.length === 0 ? (
            <YStack
              padding="$6"
              gap="$2"
              alignItems="center"
              data-testid="browse-empty"
            >
              <Text variant="subtitle">No sets match your filters</Text>
              <Text variant="body" tone="muted">
                Try widening the language filter or clearing the search box.
              </Text>
            </YStack>
          ) : (
            <YStack gap="$3" data-testid="browse-results">
              <Text variant="caption" tone="muted" data-testid="browse-result-count">
                Showing {filtered.length} of {state.sets.length} sets
              </Text>
              <XStack flexWrap="wrap" gap="$4" data-testid="browse-grid">
                {filtered.map((set) => (
                  <YStack key={set.id} width={260} flexBasis={260}>
                    <SetCard
                      href={`/sets/${encodeURIComponent(set.canonicalKey)}`}
                      name={set.name}
                      releaseDateLabel={formatReleaseDate(set.releaseDate)}
                      cardCount={set.total ?? set.printedTotal}
                      coverImageUrl={set.logoUrl ?? set.symbolUrl}
                      language={languageLabel(set.language)}
                    />
                  </YStack>
                ))}
              </XStack>
            </YStack>
          )}
        </>
      ) : null}
    </YStack>
  );
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
