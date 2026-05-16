// `<SmartCollectionDetailScreen>` — saved smart-collection detail.
//
// Surface:
//
//   - Auth-gated. Signed-out users see a sign-in prompt.
//   - Plan-gated. Non-paid users see the upgrade banner. The
//     server's RLS will reject reads against non-self rows, but
//     for self rows on a downgraded account we still want a
//     friendly surface (rather than silently surfacing a paid
//     row's data without the running it).
//   - Header: name + description + member count + Edit + Delete.
//   - Re-runs the rule on load against the user's owned printings
//     (same posture as the editor preview, see PR body for the
//     v1 trade-off documented under open-questions).
//   - 2-column FlatList of matches.
//   - 404 / loading / error.
//
// Edit currently navigates to the editor with a hint (full
// "load expression into editor" round-trip is a follow-up since
// the editor screen takes free-form text and we don't yet
// stringify the AST back into editor input — the JSON
// representation works but pre-populating the textarea cleanly
// requires plumbing not yet present).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { ApiNotFoundError } from '@binderly/api-client';
import {
  isSmartDslParseError,
  parseExpression,
  type Expression,
} from '@binderly/smart-collection-dsl';
import { Button, Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { UpgradeBanner } from '../../components/collections/index.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import {
  useCollectionItemsQuery,
  useOwnedPrintingsContextQuery,
} from '../../lib/collection/index.js';
import {
  evaluateAgainstCatalog,
  isPaidTier,
  useCustomCollectionQuery,
  useDeleteCustomCollectionMutation,
  useSmartCollectionRuleQuery,
  useSubscriptionQuery,
  type CatalogPrintingRow,
  type EvaluateMatch,
} from '../../lib/collections/index.js';

const PREVIEW_CAP = 200;

const styles = StyleSheet.create({
  gridContent: { padding: 12, gap: 12 },
  gridColumn: { gap: 12 },
});

export function SmartCollectionDetailScreen(): ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = normalizeParam(params.id);

  const { session, loading: authLoading } = useAuth();
  const signedIn = session !== null;

  const subscriptionQuery = useSubscriptionQuery({ enabled: signedIn });
  const collectionQuery = useCustomCollectionQuery(id, { enabled: signedIn });
  const ruleQuery = useSmartCollectionRuleQuery(id, { enabled: signedIn });
  const itemsQuery = useCollectionItemsQuery({ enabled: signedIn });
  const printingIds = useMemo(
    () => (itemsQuery.data ?? []).map((item) => item.printingId).slice(0, PREVIEW_CAP),
    [itemsQuery.data],
  );
  const contextQuery = useOwnedPrintingsContextQuery(printingIds);
  const deleteMutation = useDeleteCustomCollectionMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const paid = isPaidTier(subscriptionQuery);

  const expression = useMemo<Expression | null>(() => {
    if (ruleQuery.data === undefined) return null;
    try {
      return parseExpression(ruleQuery.data.expression);
    } catch (cause) {
      if (isSmartDslParseError(cause)) return null;
      return null;
    }
  }, [ruleQuery.data]);

  const catalog = useMemo<CatalogPrintingRow[]>(() => {
    return contextQuery.data.map((ctx) => {
      const { card, set, ...printing } = ctx;
      return { card, set, printing };
    });
  }, [contextQuery.data]);

  const ownedSet = useMemo(() => new Set(printingIds), [printingIds]);

  const matches = useMemo<EvaluateMatch[]>(() => {
    if (expression === null) return [];
    return evaluateAgainstCatalog(expression, catalog, ownedSet);
  }, [expression, catalog, ownedSet]);

  const handleSignIn = useCallback(() => router.push('/auth/sign-in'), [router]);
  const handleEdit = useCallback(
    () => router.push('/collections/smart/new'),
    [router],
  );
  const handleDelete = useCallback(async () => {
    if (id === undefined) return;
    try {
      await deleteMutation.mutateAsync({ id });
      router.replace('/collections/smart');
    } catch {
      // Surface error inline below.
    }
  }, [id, deleteMutation, router]);

  const renderItem = useCallback(
    ({ item }: { item: EvaluateMatch }) => (
      <SmartMemberTile match={item} />
    ),
    [],
  );

  // ---- Auth gate -----------------------------------------------
  if (authLoading) {
    return <SmartDetailLoadingState />;
  }
  if (!signedIn) {
    return <SmartDetailSignInPrompt onSignIn={handleSignIn} />;
  }
  if (id === undefined) {
    return <SmartDetailNotFoundState reason="missing-id" />;
  }
  if (collectionQuery.isLoading) {
    return <SmartDetailLoadingState />;
  }
  if (collectionQuery.isError) {
    if (collectionQuery.error instanceof ApiNotFoundError) {
      return <SmartDetailNotFoundState reason="unknown-id" id={id} />;
    }
    return (
      <SmartDetailErrorState
        message={collectionQuery.error?.message ?? 'Failed to load this smart collection.'}
      />
    );
  }
  const collection = collectionQuery.data;
  if (collection === undefined) {
    return <SmartDetailNotFoundState reason="unknown-id" id={id} />;
  }

  // ---- Plan gate ------------------------------------------------
  if (!paid) {
    return (
      <YStack
        flex={1}
        backgroundColor="$background"
        paddingTop="$6"
        gap="$3"
        testID="smart-collection-detail-plan-gate"
      >
        <YStack gap="$2" paddingHorizontal="$4">
          <Text variant="title" tone="default">
            {collection.name}
          </Text>
          <Text variant="body" tone="muted">
            This collection is part of a paid plan. Upgrade to re-run and view results.
          </Text>
        </YStack>
        <UpgradeBanner
          title="Upgrade to view this smart collection"
          description="Saved smart collections re-evaluate against your latest collection on every open. Pro unlocks both saving and viewing."
          testID="smart-collection-detail-upgrade-banner"
        />
      </YStack>
    );
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop="$6"
      testID="smart-collection-detail"
    >
      <YStack
        gap="$3"
        paddingHorizontal="$4"
        paddingBottom="$3"
        testID="smart-collection-detail-header"
      >
        <Text variant="title" tone="default">
          {collection.name}
        </Text>
        {collection.description !== null ? (
          <Text variant="body" tone="muted">
            {collection.description}
          </Text>
        ) : null}
        <XStack gap="$3" alignItems="center" justifyContent="space-between">
          <Text
            variant="caption"
            tone="muted"
            testID="smart-collection-detail-match-count"
          >
            {matches.length} {matches.length === 1 ? 'match' : 'matches'} · re-run on open
          </Text>
          <XStack gap="$2">
            <Button
              label="Edit"
              variant="ghost"
              size="sm"
              onPress={handleEdit}
              accessibilityLabel="Edit smart collection"
              testID="smart-collection-detail-edit"
            />
            {confirmDelete ? (
              <>
                <Button
                  label="Confirm"
                  variant="destructive"
                  size="sm"
                  loading={deleteMutation.isPending}
                  disabled={deleteMutation.isPending}
                  onPress={() => void handleDelete()}
                  accessibilityLabel="Confirm delete"
                  testID="smart-collection-detail-delete-confirm"
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onPress={() => setConfirmDelete(false)}
                  accessibilityLabel="Cancel delete"
                  testID="smart-collection-detail-delete-cancel"
                />
              </>
            ) : (
              <Button
                label="Delete"
                variant="ghost"
                size="sm"
                onPress={() => setConfirmDelete(true)}
                accessibilityLabel="Delete smart collection"
                testID="smart-collection-detail-delete"
              />
            )}
          </XStack>
        </XStack>
        {ruleQuery.isError ? (
          <Text
            variant="caption"
            tone="error"
            testID="smart-collection-detail-rule-error"
          >
            Failed to load rule: {ruleQuery.error?.message ?? 'unknown error'}
          </Text>
        ) : null}
        {ruleQuery.data !== undefined && expression === null ? (
          <Text
            variant="caption"
            tone="error"
            testID="smart-collection-detail-rule-parse-error"
          >
            This collection’s saved rule failed to parse. Edit it to fix.
          </Text>
        ) : null}
        {deleteMutation.error !== null ? (
          <Text
            variant="caption"
            tone="error"
            testID="smart-collection-detail-delete-error"
          >
            {deleteMutation.error.message}
          </Text>
        ) : null}
      </YStack>
      {ruleQuery.isLoading || itemsQuery.isLoading ? (
        <SmartDetailLoadingState />
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.printing.id}
          renderItem={renderItem}
          numColumns={2}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridColumn}
          ListEmptyComponent={<SmartDetailEmptyState />}
          testID="smart-collection-detail-members"
        />
      )}
    </YStack>
  );
}

// ============================================================
// Sub-components
// ============================================================

interface SmartMemberTileProps {
  readonly match: EvaluateMatch;
}

function SmartMemberTile(props: SmartMemberTileProps): ReactNode {
  const { match } = props;
  return (
    <YStack
      flex={1}
      gap="$1"
      padding="$2"
      borderRadius={8}
      backgroundColor="$surfaceMuted"
      testID={`smart-collection-detail-member-${match.printing.id}`}
    >
      <Text variant="label" tone="default" numberOfLines={1}>
        {match.card.name}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {match.set.name} #{match.card.number}
      </Text>
      <Text variant="caption" tone={match.owned ? 'default' : 'muted'}>
        {match.owned ? 'Owned' : 'Not owned'}
      </Text>
    </YStack>
  );
}

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function SmartDetailLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="smart-collection-detail-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading…
      </Text>
    </YStack>
  );
}

interface SmartDetailErrorStateProps {
  readonly message: string;
}

function SmartDetailErrorState(props: SmartDetailErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="smart-collection-detail-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load this smart collection
      </Text>
      <Text variant="body" tone="muted">
        {props.message}
      </Text>
    </YStack>
  );
}

interface SmartDetailNotFoundStateProps {
  readonly reason: 'unknown-id' | 'missing-id';
  readonly id?: string;
}

function SmartDetailNotFoundState(props: SmartDetailNotFoundStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      backgroundColor="$background"
      testID="smart-collection-detail-not-found"
    >
      <Text variant="title" tone="default">
        Smart collection not found
      </Text>
      <Text variant="body" tone="muted">
        {props.reason === 'unknown-id' && props.id !== undefined
          ? `We couldn’t find a smart collection with the id “${props.id}”.`
          : 'No smart collection was specified.'}
      </Text>
    </YStack>
  );
}

function SmartDetailEmptyState(): ReactNode {
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$5"
      margin="$4"
      alignItems="center"
      testID="smart-collection-detail-empty"
    >
      <Text variant="subtitle" tone="default">
        No matches in your collection yet
      </Text>
      <Text variant="body" tone="muted">
        Add cards from the catalog and they will appear here when they match.
      </Text>
    </Card>
  );
}

interface SmartDetailSignInPromptProps {
  readonly onSignIn: () => void;
}

function SmartDetailSignInPrompt(props: SmartDetailSignInPromptProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="smart-collection-detail-sign-in-prompt"
    >
      <Text variant="title" tone="default">
        Sign in to view this smart collection
      </Text>
      <Button
        label="Sign in"
        variant="primary"
        size="lg"
        onPress={props.onSignIn}
        accessibilityLabel="Sign in"
        testID="smart-collection-detail-sign-in-button"
      />
    </YStack>
  );
}
