// `<CustomCollectionsScreen>` — the mobile "Custom Collections"
// landing surface.
//
// Surface:
//
//   - Auth-gated. Signed-out users see a sign-in CTA.
//   - Header: "Custom Collections — X / 3 used" where X is the
//     number of MANUAL custom collections the user owns. The
//     denominator is always 3 (free-tier cap from PROJECT.md § 16).
//     Paid users hit the same header — the cap doesn't apply to
//     them but rendering one branch keeps copy stable.
//   - "New custom collection" CTA: enabled when `manualCount < 3`,
//     disabled when `manualCount >= 3` with an upsell hint
//     beneath. Tap → opens an inline create form (name +
//     description) and submits via
//     `useCreateCustomCollectionMutation`.
//   - "Try a smart query" secondary CTA: pushes
//     `/collections/smart`. Always available — smart collections
//     are visible to free users (only saving is paid).
//   - FlatList of MANUAL collections (smart collections live on
//     `/collections/smart`). Tap → push
//     `/collections/custom/{id}`.
//   - Empty state when the user has zero custom collections.
//   - Pull-to-refresh; loading; error.

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import type { CustomCollectionDto } from '@binderly/api-contracts';
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { CustomCollectionRow } from '../../components/collections/index.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import {
  FREE_TIER_CUSTOM_LIMIT,
  formatCustomUsage,
  slugify,
  useCreateCustomCollectionMutation,
  useCustomCollectionsQuery,
} from '../../lib/collections/index.js';

interface CreateFormState {
  readonly open: boolean;
  readonly name: string;
  readonly description: string;
  readonly status: 'idle' | 'pending' | 'error';
  readonly errorMessage?: string;
}

const INITIAL_CREATE_STATE: CreateFormState = {
  open: false,
  name: '',
  description: '',
  status: 'idle',
};

export function CustomCollectionsScreen(): ReactNode {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const signedIn = session !== null;

  const collectionsQuery = useCustomCollectionsQuery({ enabled: signedIn });
  const createMutation = useCreateCustomCollectionMutation();

  const [createState, setCreateState] = useState<CreateFormState>(INITIAL_CREATE_STATE);

  const manualCollections = useMemo(
    () =>
      (collectionsQuery.data ?? []).filter(
        (collection) => collection.kind === 'manual',
      ),
    [collectionsQuery.data],
  );
  const manualCount = manualCollections.length;
  const atCap = manualCount >= FREE_TIER_CUSTOM_LIMIT;

  const handleSelect = useCallback(
    (collection: CustomCollectionDto) => {
      router.push(`/collections/custom/${encodeURIComponent(collection.id)}`);
    },
    [router],
  );

  const handleSignIn = useCallback(() => {
    router.push('/auth/sign-in');
  }, [router]);

  const handleSmartLink = useCallback(() => {
    router.push('/collections/smart');
  }, [router]);

  const handleRefresh = useCallback(() => {
    void collectionsQuery.refetch();
  }, [collectionsQuery]);

  const handleOpenCreate = useCallback(() => {
    setCreateState({ ...INITIAL_CREATE_STATE, open: true });
  }, []);

  const handleCancelCreate = useCallback(() => {
    setCreateState(INITIAL_CREATE_STATE);
  }, []);

  const handleSubmitCreate = useCallback(async () => {
    const trimmedName = createState.name.trim();
    const trimmedDescription = createState.description.trim();
    if (trimmedName.length === 0) {
      setCreateState((current) => ({
        ...current,
        status: 'error',
        errorMessage: 'Name is required.',
      }));
      return;
    }
    const slug = slugify(trimmedName);
    if (slug.length === 0) {
      setCreateState((current) => ({
        ...current,
        status: 'error',
        errorMessage: 'Name must contain at least one letter or number.',
      }));
      return;
    }
    setCreateState((current) => ({ ...current, status: 'pending' }));
    try {
      const created = await createMutation.mutateAsync({
        kind: 'manual',
        name: trimmedName,
        slug,
        description: trimmedDescription.length > 0 ? trimmedDescription : null,
      });
      setCreateState(INITIAL_CREATE_STATE);
      router.push(`/collections/custom/${encodeURIComponent(created.id)}`);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to create collection.';
      setCreateState((current) => ({
        ...current,
        status: 'error',
        errorMessage: message,
      }));
    }
  }, [createMutation, createState.name, createState.description, router]);

  const renderItem = useCallback(
    ({ item }: { item: CustomCollectionDto }) => (
      <CustomCollectionRow collection={item} onPress={handleSelect} />
    ),
    [handleSelect],
  );

  // ---- Auth gate -----------------------------------------------
  if (authLoading) {
    return <CustomLoadingState />;
  }
  if (!signedIn) {
    return <CustomSignInPrompt onSignIn={handleSignIn} />;
  }

  // ---- Loading / error states -----------------------------------
  if (collectionsQuery.isLoading) {
    return <CustomLoadingState />;
  }
  if (collectionsQuery.isError) {
    return (
      <CustomErrorState
        message={collectionsQuery.error?.message ?? 'Failed to load custom collections.'}
        onRetry={handleRefresh}
      />
    );
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop="$6"
      testID="custom-collections-screen"
    >
      <YStack gap="$3" paddingHorizontal="$4" paddingBottom="$3">
        <Text variant="title" tone="default">
          Custom Collections
        </Text>
        <Text variant="caption" tone="muted" testID="custom-collections-usage">
          {formatCustomUsage(manualCount)}
        </Text>
        {createState.open ? null : (
          <YStack gap="$2">
            <Button
              label={atCap ? 'Free plan limit reached (3)' : 'New custom collection'}
              variant="primary"
              size="md"
              disabled={atCap}
              onPress={handleOpenCreate}
              accessibilityLabel="New custom collection"
              testID="custom-collections-create"
            />
            {atCap ? (
              <Text
                variant="caption"
                tone="muted"
                testID="custom-collections-cap-hint"
              >
                Upgrade to Pro to create more than {FREE_TIER_CUSTOM_LIMIT} custom collections.
              </Text>
            ) : null}
            <Button
              label="Try a smart query"
              variant="ghost"
              size="md"
              onPress={handleSmartLink}
              accessibilityLabel="Try a smart query"
              testID="custom-collections-smart-link"
            />
          </YStack>
        )}
        {createState.open ? (
          <CustomCollectionCreateForm
            state={createState}
            onChange={(next) => setCreateState((current) => ({ ...current, ...next }))}
            onSubmit={() => void handleSubmitCreate()}
            onCancel={handleCancelCreate}
          />
        ) : null}
      </YStack>
      <FlatList
        data={manualCollections}
        keyExtractor={(item: CustomCollectionDto) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={collectionsQuery.isFetching && !collectionsQuery.isLoading}
            onRefresh={handleRefresh}
            testID="custom-collections-refresh"
          />
        }
        ListEmptyComponent={
          <CustomEmptyState onCreate={handleOpenCreate} disabled={atCap} />
        }
        testID="custom-collections-list"
      />
    </YStack>
  );
}

// ============================================================
// Sub-components
// ============================================================

interface CustomCollectionCreateFormProps {
  readonly state: CreateFormState;
  readonly onChange: (patch: Partial<CreateFormState>) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

function CustomCollectionCreateForm(
  props: CustomCollectionCreateFormProps,
): ReactNode {
  const { state, onChange, onSubmit, onCancel } = props;
  const pending = state.status === 'pending';
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$4"
      testID="custom-collections-create-form"
    >
      <Input
        label="Name"
        placeholder="e.g. My Charizards"
        value={state.name}
        onChangeText={(next) => onChange({ name: next })}
        accessibilityLabel="Collection name"
        aria-label="Collection name"
        testID="custom-collections-create-name"
      />
      <Input
        label="Description (optional)"
        placeholder="What's in this collection?"
        value={state.description}
        onChangeText={(next) => onChange({ description: next })}
        accessibilityLabel="Collection description"
        aria-label="Collection description"
        testID="custom-collections-create-description"
      />
      {state.status === 'error' && state.errorMessage !== undefined ? (
        <Text variant="caption" tone="error" testID="custom-collections-create-error">
          {state.errorMessage}
        </Text>
      ) : null}
      <XStack gap="$2">
        <Button
          label={pending ? 'Creating…' : 'Create'}
          variant="primary"
          size="md"
          loading={pending}
          disabled={pending}
          onPress={onSubmit}
          accessibilityLabel="Create custom collection"
          testID="custom-collections-create-submit"
        />
        <Button
          label="Cancel"
          variant="ghost"
          size="md"
          disabled={pending}
          onPress={onCancel}
          accessibilityLabel="Cancel create"
          testID="custom-collections-create-cancel"
        />
      </XStack>
    </Card>
  );
}

interface CustomEmptyStateProps {
  readonly onCreate: () => void;
  readonly disabled: boolean;
}

function CustomEmptyState(props: CustomEmptyStateProps): ReactNode {
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$5"
      margin="$4"
      alignItems="center"
      testID="custom-collections-empty"
    >
      <Text variant="subtitle" tone="default">
        No custom collections yet
      </Text>
      <Text variant="body" tone="muted">
        Group your owned cards into themes — Charizards, your favourite
        sets, gifts to remember.
      </Text>
      <Button
        label="Create one"
        variant="primary"
        size="md"
        disabled={props.disabled}
        onPress={props.onCreate}
        accessibilityLabel="Create one"
        testID="custom-collections-empty-create"
      />
    </Card>
  );
}

interface CustomSignInPromptProps {
  readonly onSignIn: () => void;
}

function CustomSignInPrompt(props: CustomSignInPromptProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="custom-collections-sign-in-prompt"
    >
      <YStack gap="$2" alignItems="center">
        <Text variant="title" tone="default">
          Sign in to manage custom collections
        </Text>
        <Text variant="body" tone="muted">
          Group your owned cards into themed collections.
        </Text>
      </YStack>
      <Button
        label="Sign in"
        variant="primary"
        size="lg"
        onPress={props.onSignIn}
        accessibilityLabel="Sign in"
        testID="custom-collections-sign-in-button"
      />
    </YStack>
  );
}

function CustomLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="custom-collections-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading your custom collections…
      </Text>
    </YStack>
  );
}

interface CustomErrorStateProps {
  readonly message: string;
  readonly onRetry: () => void;
}

function CustomErrorState(props: CustomErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$6"
      testID="custom-collections-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load custom collections
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
        testID="custom-collections-error-retry"
      />
    </YStack>
  );
}
