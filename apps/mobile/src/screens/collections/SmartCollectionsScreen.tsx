// `<SmartCollectionsScreen>` — saved smart collections list.
//
// Free vs paid behaviour:
//
//   - Free users (the default): saved-list is intentionally empty
//     because saving is paid. The screen renders the
//     `<UpgradeBanner>` plus the "Try a smart query" CTA which is
//     free for everyone.
//   - Paid users: saved smart collections from
//     `useCustomCollectionsQuery()` filtered to `kind === 'smart'`.
//     Each row links to `/collections/smart/{id}`.
//
// Auth-gated. The screen is reachable from the custom-collections
// landing screen + via direct deep link.

import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import type { CustomCollectionDto } from '@binderly/api-contracts';
import { Button, Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import {
  CustomCollectionRow,
  UpgradeBanner,
} from '../../components/collections/index.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import {
  isPaidTier,
  useCustomCollectionsQuery,
  useSubscriptionQuery,
} from '../../lib/collections/index.js';

export function SmartCollectionsScreen(): ReactNode {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const signedIn = session !== null;

  const subscriptionQuery = useSubscriptionQuery({ enabled: signedIn });
  const collectionsQuery = useCustomCollectionsQuery({ enabled: signedIn });

  const paid = isPaidTier(subscriptionQuery);
  const smartCollections = useMemo(
    () =>
      (collectionsQuery.data ?? []).filter(
        (collection) => collection.kind === 'smart',
      ),
    [collectionsQuery.data],
  );

  const handleSignIn = useCallback(() => router.push('/auth/sign-in'), [router]);
  const handleEditor = useCallback(
    () => router.push('/collections/smart/new'),
    [router],
  );
  const handleSelect = useCallback(
    (collection: CustomCollectionDto) => {
      router.push(`/collections/smart/${encodeURIComponent(collection.id)}`);
    },
    [router],
  );
  const handleRefresh = useCallback(() => {
    void collectionsQuery.refetch();
    void subscriptionQuery.refetch();
  }, [collectionsQuery, subscriptionQuery]);

  const renderItem = useCallback(
    ({ item }: { item: CustomCollectionDto }) => (
      <CustomCollectionRow collection={item} onPress={handleSelect} />
    ),
    [handleSelect],
  );

  // ---- Auth gate -----------------------------------------------
  if (authLoading) {
    return <SmartLoadingState />;
  }
  if (!signedIn) {
    return <SmartSignInPrompt onSignIn={handleSignIn} />;
  }

  if (collectionsQuery.isLoading) {
    return <SmartLoadingState />;
  }
  if (collectionsQuery.isError) {
    return (
      <SmartErrorState
        message={collectionsQuery.error?.message ?? 'Failed to load smart collections.'}
        onRetry={handleRefresh}
      />
    );
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop="$6"
      testID="smart-collections-screen"
    >
      <YStack gap="$3" paddingHorizontal="$4" paddingBottom="$3">
        <Text variant="title" tone="default">
          Smart Collections
        </Text>
        <XStack gap="$2" alignItems="center">
          <Text variant="caption" tone="muted" testID="smart-collections-saved-count">
            Saved: {paid ? smartCollections.length : 0}
          </Text>
          {paid ? null : (
            <Text variant="caption" tone="muted" testID="smart-collections-plan-tag">
              · Free plan
            </Text>
          )}
        </XStack>
        <Button
          label="Try a smart query"
          variant="primary"
          size="md"
          onPress={handleEditor}
          accessibilityLabel="Try a smart query"
          testID="smart-collections-editor-cta"
        />
      </YStack>
      {paid ? (
        <FlatList
          data={smartCollections}
          keyExtractor={(item: CustomCollectionDto) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={collectionsQuery.isFetching && !collectionsQuery.isLoading}
              onRefresh={handleRefresh}
              testID="smart-collections-refresh"
            />
          }
          ListEmptyComponent={<SmartEmptyPaidState />}
          testID="smart-collections-list"
        />
      ) : (
        <YStack flex={1}>
          <UpgradeBanner
            title="Saving smart collections requires a paid plan"
            description="Free plan users can run smart queries — saving them and re-running on demand is part of Pro."
            testID="smart-collections-upgrade-banner"
          />
          <YStack alignItems="center" padding="$4">
            <Text variant="caption" tone="muted">
              You haven’t saved any smart collections yet.
            </Text>
          </YStack>
        </YStack>
      )}
    </YStack>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SmartEmptyPaidState(): ReactNode {
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$5"
      margin="$4"
      alignItems="center"
      testID="smart-collections-empty-paid"
    >
      <Text variant="subtitle" tone="default">
        No saved smart collections yet
      </Text>
      <Text variant="body" tone="muted">
        Build a query, hit Run, and save it for one-tap access later.
      </Text>
    </Card>
  );
}

function SmartLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="smart-collections-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading smart collections…
      </Text>
    </YStack>
  );
}

interface SmartErrorStateProps {
  readonly message: string;
  readonly onRetry: () => void;
}

function SmartErrorState(props: SmartErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$6"
      testID="smart-collections-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load smart collections
      </Text>
      <Text variant="body" tone="muted">
        {props.message}
      </Text>
      <Button
        label="Retry"
        variant="ghost"
        size="md"
        onPress={props.onRetry}
        accessibilityLabel="Retry"
        testID="smart-collections-error-retry"
      />
    </YStack>
  );
}

interface SmartSignInPromptProps {
  readonly onSignIn: () => void;
}

function SmartSignInPrompt(props: SmartSignInPromptProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="smart-collections-sign-in-prompt"
    >
      <Text variant="title" tone="default">
        Sign in to use smart collections
      </Text>
      <Text variant="body" tone="muted">
        Build, run, and (with Pro) save smart queries against your collection.
      </Text>
      <Button
        label="Sign in"
        variant="primary"
        size="lg"
        onPress={props.onSignIn}
        accessibilityLabel="Sign in"
        testID="smart-collections-sign-in-button"
      />
    </YStack>
  );
}
