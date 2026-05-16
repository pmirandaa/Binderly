// `<SetScreen>` — per-set card grid.
//
// Surface:
//
//   - Header: set name, release date, card count, language
//     footnote. The expo-router root layout already wires a
//     back button; we don't re-render one here.
//   - Grid of card tiles (FlatList, two columns).
//   - Loading / error / not-found states.
//
// Routing:
//
//   - Mounted by `app/sets/[slug].tsx`. The slug is
//     `set.canonical_key` (URL-friendly).
//   - Tapping a card pushes `/cards/{card.id}`.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { Spinner, Text, XStack, YStack } from '@binderly/ui';

import { CardTile } from '../../components/browse/CardTile.js';
import {
  formatReleaseDate,
  languageLabel,
  useCardsInSetQuery,
  useSetBySlugQuery,
  type CardInSetDto,
} from '../../lib/browse/index.js';

const GRID_COLUMNS = 2;

const styles = StyleSheet.create({
  gridContent: { padding: 12, gap: 12 },
  gridColumn: { gap: 12 },
});

export function SetScreen(): ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeParam(params.slug);

  const setQuery = useSetBySlugQuery(slug);
  const cardsQuery = useCardsInSetQuery(setQuery.data?.id);

  const handleSelectCard = useCallback(
    (card: CardInSetDto) => {
      router.push(`/cards/${encodeURIComponent(card.id)}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: CardInSetDto }) => (
      <CardTile card={item} onPress={handleSelectCard} />
    ),
    [handleSelectCard],
  );

  if (slug === undefined) {
    return <SetNotFoundState reason="missing-slug" />;
  }

  if (setQuery.isLoading) {
    return <SetLoadingState />;
  }

  if (setQuery.isError) {
    return (
      <SetErrorState
        message={setQuery.error?.message ?? 'Failed to load this set.'}
      />
    );
  }

  const set = setQuery.data;
  if (set === null || set === undefined) {
    return <SetNotFoundState reason="unknown-slug" slug={slug} />;
  }

  const cards = cardsQuery.data?.items ?? [];
  const totalCards = cardsQuery.data?.items.length ?? set.total ?? set.printedTotal ?? 0;

  return (
    <YStack flex={1} backgroundColor="$background" testID="set-screen" paddingTop="$6">
      <YStack
        gap="$1"
        paddingHorizontal="$4"
        paddingBottom="$3"
        testID="set-header"
      >
        <Text variant="title" tone="default">
          {set.name}
        </Text>
        <XStack gap="$2" alignItems="center">
          <Text variant="caption" tone="muted">
            {formatReleaseDate(set.releaseDate)}
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="muted">
            {totalCards} cards
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="muted">
            {languageLabel(set.language)}
          </Text>
        </XStack>
      </YStack>
      {cardsQuery.isLoading ? (
        <SetLoadingState />
      ) : cardsQuery.isError ? (
        <SetErrorState
          message={cardsQuery.error?.message ?? 'Failed to load cards.'}
        />
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item: CardInSetDto) => item.id}
          renderItem={renderItem}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridColumn}
          ListEmptyComponent={<SetEmptyState />}
          testID="set-cards-list"
        />
      )}
    </YStack>
  );
}

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function SetLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="set-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading…
      </Text>
    </YStack>
  );
}

interface SetErrorStateProps {
  readonly message: string;
}

function SetErrorState(props: SetErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="set-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load this set
      </Text>
      <Text variant="body" tone="muted">
        {props.message}
      </Text>
    </YStack>
  );
}

interface SetNotFoundStateProps {
  readonly reason: 'unknown-slug' | 'missing-slug';
  readonly slug?: string;
}

function SetNotFoundState(props: SetNotFoundStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      backgroundColor="$background"
      testID="set-not-found"
    >
      <Text variant="title" tone="default">
        Set not found
      </Text>
      <Text variant="body" tone="muted">
        {props.reason === 'unknown-slug' && props.slug !== undefined
          ? `We couldn’t find a set with the id “${props.slug}”.`
          : 'No set was specified.'}
      </Text>
    </YStack>
  );
}

function SetEmptyState(): ReactNode {
  return (
    <YStack
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="set-empty"
    >
      <Text variant="subtitle" tone="default">
        No cards in this set yet
      </Text>
      <Text variant="body" tone="muted">
        Card data for this set is still being ingested.
      </Text>
    </YStack>
  );
}
