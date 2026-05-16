// `<CollectionSetScreen>` — per-set drill-down for the user's
// collection. Auth-gated. Resolves the slug to a `SetDto` via the
// shared `useSetBySlugQuery()` (same path the BrowseScreen-side
// `<SetScreen>` uses), then loads the full per-set roster
// (`useSetDrillDownQuery`) and intersects it with the user's
// owned printingIds to drive both halves of the segmented
// control:
//
//   - **Owned** (default): every printing of this set the user
//     already has, with variant chips.
//   - **Missing**: every printing of this set the user does NOT
//     have. Tapping a tile pushes `/cards/{cardId}` so the
//     existing card detail surface handles it.
//
// Set / Master percentages come from `computeCompletionForSet`
// (which delegates to `@binderly/set-completion`) — accurate,
// because we have the full per-set printing roster here.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import type { PrintingDto } from '@binderly/api-contracts';
import { Button, Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { PrintingTile } from '../../components/collection/PrintingTile.js';
import { ProgressBar } from '../../components/collection/ProgressBar.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import { formatReleaseDate, languageLabel, useSetBySlugQuery } from '../../lib/browse/index.js';
import {
  computeCompletionForSet,
  formatCount,
  formatPercent,
  partitionPrintingsForDrillDown,
  useCollectionItemsQuery,
  useSetDrillDownQuery,
} from '../../lib/collection/index.js';


const GRID_COLUMNS = 2;

const styles = StyleSheet.create({
  gridContent: { padding: 12, gap: 12 },
  gridColumn: { gap: 12 },
});

type DrillDownTab = 'owned' | 'missing';

export function CollectionSetScreen(): ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeParam(params.slug);

  const { session, loading: authLoading } = useAuth();
  const signedIn = session !== null;

  const setQuery = useSetBySlugQuery(slug);
  const drillDownQuery = useSetDrillDownQuery(setQuery.data?.id);
  const itemsQuery = useCollectionItemsQuery({ enabled: signedIn });

  const [activeTab, setActiveTab] = useState<DrillDownTab>('owned');

  const ownedPrintingIds = useMemo(
    () => new Set((itemsQuery.data ?? []).map((item) => item.printingId)),
    [itemsQuery.data],
  );

  const partition = useMemo(
    () =>
      partitionPrintingsForDrillDown(
        drillDownQuery.data?.printings ?? [],
        Array.from(ownedPrintingIds),
      ),
    [drillDownQuery.data, ownedPrintingIds],
  );

  const completion = useMemo(() => {
    const setId = setQuery.data?.id;
    const drillData = drillDownQuery.data;
    if (setId === undefined || drillData === null) return null;
    return computeCompletionForSet({
      setId,
      cards: drillData.cards,
      printings: drillData.printings,
      ownedPrintingIds: Array.from(ownedPrintingIds),
    }).perSet[0];
  }, [setQuery.data, drillDownQuery.data, ownedPrintingIds]);

  const handleSelectPrinting = useCallback(
    (printing: PrintingDto) => {
      router.push(`/cards/${encodeURIComponent(printing.cardId)}`);
    },
    [router],
  );

  const handleSignIn = useCallback(() => {
    router.push('/auth/sign-in');
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: PrintingDto }) => (
      <PrintingTile
        printing={item}
        owned={ownedPrintingIds.has(item.id)}
        onPress={handleSelectPrinting}
      />
    ),
    [ownedPrintingIds, handleSelectPrinting],
  );

  // ---- Auth gate -----------------------------------------------
  if (authLoading) {
    return <DrillDownLoadingState />;
  }
  if (!signedIn) {
    return <DrillDownSignInPrompt onSignIn={handleSignIn} />;
  }

  if (slug === undefined) {
    return <DrillDownNotFoundState reason="missing-slug" />;
  }

  if (setQuery.isLoading) {
    return <DrillDownLoadingState />;
  }

  if (setQuery.isError) {
    return (
      <DrillDownErrorState
        message={setQuery.error?.message ?? 'Failed to load this set.'}
      />
    );
  }

  const set = setQuery.data;
  if (set === null || set === undefined) {
    return <DrillDownNotFoundState reason="unknown-slug" slug={slug} />;
  }

  if (drillDownQuery.isLoading || itemsQuery.isLoading) {
    return <DrillDownLoadingState />;
  }

  if (drillDownQuery.isError || itemsQuery.isError) {
    const message =
      drillDownQuery.error?.message ??
      itemsQuery.error?.message ??
      'Failed to load this set.';
    return <DrillDownErrorState message={message} />;
  }

  const visiblePrintings = activeTab === 'owned' ? partition.owned : partition.missing;
  const setPct = completion?.setPct ?? 0;
  const masterPct = completion?.masterPct ?? 0;
  const ownedNumbered = completion?.ownedNumbered ?? 0;
  const totalNumbered = completion?.totalNumbered ?? 0;
  const ownedMaster = completion?.ownedMaster ?? 0;
  const totalMaster = completion?.totalMaster ?? 0;

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop="$6"
      testID="collection-set-screen"
    >
      <YStack
        gap="$3"
        paddingHorizontal="$4"
        paddingBottom="$3"
        testID="collection-set-header"
      >
        <YStack gap="$1">
          <Text variant="title" tone="default">
            {set.name}
          </Text>
          <Text variant="caption" tone="muted">
            {formatReleaseDate(set.releaseDate)} · {languageLabel(set.language)}
          </Text>
        </YStack>

        <YStack gap="$1" testID="collection-set-set-progress">
          <XStack justifyContent="space-between">
            <Text variant="caption" tone="muted">
              Set
            </Text>
            <Text variant="caption" tone="default">
              {formatPercent(setPct)} · {formatCount(ownedNumbered, totalNumbered)}
            </Text>
          </XStack>
          <ProgressBar
            value={setPct}
            tone="set"
            height={10}
            accessibilityLabel={`Set progress ${formatPercent(setPct)}`}
            testID="collection-set-set-bar"
          />
        </YStack>

        <YStack gap="$1" testID="collection-set-master-progress">
          <XStack justifyContent="space-between">
            <Text variant="caption" tone="muted">
              Master
            </Text>
            <Text variant="caption" tone="default">
              {formatPercent(masterPct)} · {formatCount(ownedMaster, totalMaster)}
            </Text>
          </XStack>
          <ProgressBar
            value={masterPct}
            tone="master"
            height={10}
            accessibilityLabel={`Master progress ${formatPercent(masterPct)}`}
            testID="collection-set-master-bar"
          />
        </YStack>
      </YStack>

      <DrillDownTabBar activeTab={activeTab} onChange={setActiveTab} partition={partition} />

      <FlatList
        data={visiblePrintings}
        keyExtractor={(item: PrintingDto) => item.id}
        renderItem={renderItem}
        numColumns={GRID_COLUMNS}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridColumn}
        ListEmptyComponent={<DrillDownEmptyState tab={activeTab} />}
        testID={`collection-set-${activeTab}-list`}
      />
    </YStack>
  );
}

// ============================================================
// Tab bar
// ============================================================

interface DrillDownTabBarProps {
  readonly activeTab: DrillDownTab;
  readonly onChange: (tab: DrillDownTab) => void;
  readonly partition: { readonly owned: PrintingDto[]; readonly missing: PrintingDto[] };
}

function DrillDownTabBar(props: DrillDownTabBarProps): ReactNode {
  const { activeTab, onChange, partition } = props;
  return (
    <XStack
      paddingHorizontal="$4"
      paddingBottom="$3"
      gap="$2"
      testID="collection-set-tabs"
    >
      <TabButton
        label={`Owned (${partition.owned.length})`}
        active={activeTab === 'owned'}
        onPress={() => onChange('owned')}
        testID="collection-set-tab-owned"
      />
      <TabButton
        label={`Missing (${partition.missing.length})`}
        active={activeTab === 'missing'}
        onPress={() => onChange('missing')}
        testID="collection-set-tab-missing"
      />
    </XStack>
  );
}

interface TabButtonProps {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}

function TabButton(props: TabButtonProps): ReactNode {
  return (
    <XStack
      role="button"
      aria-pressed={props.active}
      accessibilityRole="button"
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      flex={1}
      paddingVertical="$2"
      paddingHorizontal="$3"
      borderRadius={999}
      borderWidth={1}
      borderColor={props.active ? '$primary' : '$border'}
      backgroundColor={props.active ? '$primary' : 'transparent'}
      cursor="pointer"
      justifyContent="center"
      alignItems="center"
      testID={props.testID}
    >
      <Text variant="label" tone={props.active ? 'inverse' : 'default'}>
        {props.label}
      </Text>
    </XStack>
  );
}

// ============================================================
// Helpers + sub-states
// ============================================================

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function DrillDownLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="collection-set-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading…
      </Text>
    </YStack>
  );
}

interface DrillDownErrorStateProps {
  readonly message: string;
}

function DrillDownErrorState(props: DrillDownErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="collection-set-error"
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

interface DrillDownNotFoundStateProps {
  readonly reason: 'unknown-slug' | 'missing-slug';
  readonly slug?: string;
}

function DrillDownNotFoundState(props: DrillDownNotFoundStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      backgroundColor="$background"
      testID="collection-set-not-found"
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

interface DrillDownEmptyStateProps {
  readonly tab: DrillDownTab;
}

function DrillDownEmptyState(props: DrillDownEmptyStateProps): ReactNode {
  return (
    <YStack
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID={`collection-set-${props.tab}-empty`}
    >
      <Text variant="subtitle" tone="default">
        {props.tab === 'owned' ? 'No owned printings yet' : 'You own every printing'}
      </Text>
      <Text variant="body" tone="muted">
        {props.tab === 'owned'
          ? 'Add a card from this set and it will appear here.'
          : 'Master Set complete for this set.'}
      </Text>
    </YStack>
  );
}

interface DrillDownSignInPromptProps {
  readonly onSignIn: () => void;
}

function DrillDownSignInPrompt(props: DrillDownSignInPromptProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="collection-set-sign-in-prompt"
    >
      <Card variant="outlined" gap="$2" padding="$4" alignItems="center">
        <Text variant="title" tone="default">
          Sign in to view your progress
        </Text>
        <Text variant="body" tone="muted">
          Sign in to see what you own and what you’re missing in this set.
        </Text>
      </Card>
      <Button
        label="Sign in"
        variant="primary"
        size="lg"
        onPress={props.onSignIn}
        accessibilityLabel="Sign in"
        testID="collection-set-sign-in-button"
      />
    </YStack>
  );
}
