// `<CustomCollectionDetailScreen>` — manual custom-collection
// detail.
//
// Surface:
//
//   - Auth-gated. Signed-out users see a sign-in prompt.
//   - 404 surface when the id is missing or unknown.
//   - Header: editable name + description (inline rename via
//     `<InlineEditor>`), member count, delete button (with a
//     confirmation step).
//   - "Add cards" CTA → opens the inline `<PrintingPicker>` sourced
//     from the user's owned printings.
//   - 2-column FlatList of member rows. Tap → push
//     `/cards/{cardId}` (we resolve cardId via `getPrinting` per
//     row's printingId — same posture as the drill-down).
//   - Per-row Remove button to drop a member.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { ApiNotFoundError } from '@binderly/api-client';
import type { CustomCollectionItemDto } from '@binderly/api-contracts';
import { Button, Card, Pressable, Spinner, Text, XStack, YStack } from '@binderly/ui';

import {
  InlineEditor,
  PrintingPicker,
} from '../../components/collections/index.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import { useCollectionItemsQuery } from '../../lib/collection/index.js';
import {
  useAddPrintingToCustomCollectionMutation,
  useCustomCollectionItemsQuery,
  useCustomCollectionQuery,
  useDeleteCustomCollectionMutation,
  useRemovePrintingFromCustomCollectionMutation,
  useUpdateCustomCollectionMutation,
} from '../../lib/collections/index.js';

const styles = StyleSheet.create({
  gridContent: { padding: 12, gap: 12 },
  gridColumn: { gap: 12 },
});

const GRID_COLUMNS = 2;

export function CustomCollectionDetailScreen(): ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = normalizeParam(params.id);

  const { session, loading: authLoading } = useAuth();
  const signedIn = session !== null;

  const collectionQuery = useCustomCollectionQuery(id, { enabled: signedIn });
  const itemsQuery = useCustomCollectionItemsQuery(id, { enabled: signedIn });
  const ownedQuery = useCollectionItemsQuery({ enabled: signedIn });

  const updateMutation = useUpdateCustomCollectionMutation();
  const deleteMutation = useDeleteCustomCollectionMutation();
  const addMutation = useAddPrintingToCustomCollectionMutation();
  const removeMutation = useRemovePrintingFromCustomCollectionMutation();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const existingPrintingIds = useMemo(
    () => items.map((item) => item.printingId),
    [items],
  );

  const handleSignIn = useCallback(() => router.push('/auth/sign-in'), [router]);

  const handleRename = useCallback(
    (next: string) => {
      if (id === undefined) return;
      updateMutation.mutate({ id, patch: { name: next } });
    },
    [id, updateMutation],
  );

  const handleDescriptionChange = useCallback(
    (next: string) => {
      if (id === undefined) return;
      updateMutation.mutate({
        id,
        patch: { description: next.length > 0 ? next : null },
      });
    },
    [id, updateMutation],
  );

  const handleDelete = useCallback(async () => {
    if (id === undefined) return;
    try {
      await deleteMutation.mutateAsync({ id });
      router.replace('/collections');
    } catch {
      // Mutation surfaces error in `deleteMutation.error`; the
      // header row reads it back below.
    }
  }, [id, deleteMutation, router]);

  const handleAddPrinting = useCallback(
    (printingId: string) => {
      if (id === undefined) return;
      addMutation.mutate({ customCollectionId: id, printingId });
    },
    [id, addMutation],
  );

  const handleRemovePrinting = useCallback(
    (printingId: string) => {
      if (id === undefined) return;
      removeMutation.mutate({ customCollectionId: id, printingId });
    },
    [id, removeMutation],
  );

  const handleSelectPrinting = useCallback(
    async (printingId: string) => {
      router.push(`/cards/${encodeURIComponent(printingId)}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: CustomCollectionItemDto }) => (
      <CustomMemberTile
        item={item}
        onPress={handleSelectPrinting}
        onRemove={handleRemovePrinting}
      />
    ),
    [handleSelectPrinting, handleRemovePrinting],
  );

  // ---- Auth gate -----------------------------------------------
  if (authLoading) {
    return <DetailLoadingState />;
  }
  if (!signedIn) {
    return <DetailSignInPrompt onSignIn={handleSignIn} />;
  }

  if (id === undefined) {
    return <DetailNotFoundState reason="missing-id" />;
  }

  if (collectionQuery.isLoading) {
    return <DetailLoadingState />;
  }

  if (collectionQuery.isError) {
    if (collectionQuery.error instanceof ApiNotFoundError) {
      return <DetailNotFoundState reason="unknown-id" id={id} />;
    }
    return (
      <DetailErrorState
        message={collectionQuery.error?.message ?? 'Failed to load this collection.'}
      />
    );
  }

  const collection = collectionQuery.data;
  if (collection === undefined) {
    return <DetailNotFoundState reason="unknown-id" id={id} />;
  }
  if (collection.kind !== 'manual') {
    // Defensive — the manual route shouldn't be reached for smart
    // collections, but if it is we redirect via a hint rather than
    // mis-render the smart UX inside the manual surface.
    return <DetailErrorState message="This is a smart collection. Open it from the smart collections screen." />;
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop="$6"
      testID="custom-collection-detail"
    >
      <YStack
        gap="$3"
        paddingHorizontal="$4"
        paddingBottom="$3"
        testID="custom-collection-header"
      >
        <InlineEditor
          label="Collection name"
          value={collection.name}
          onSave={handleRename}
          testID="custom-collection-name-editor"
        />
        <InlineEditor
          label="Collection description"
          value={collection.description ?? ''}
          placeholder="Add a description"
          multiline
          onSave={handleDescriptionChange}
          testID="custom-collection-description-editor"
        />
        <XStack gap="$3" alignItems="center" justifyContent="space-between">
          <Text variant="caption" tone="muted" testID="custom-collection-member-count">
            {items.length} {items.length === 1 ? 'card' : 'cards'}
          </Text>
          {confirmDelete ? (
            <XStack gap="$2">
              <Button
                label="Confirm delete"
                variant="destructive"
                size="sm"
                loading={deleteMutation.isPending}
                disabled={deleteMutation.isPending}
                onPress={() => void handleDelete()}
                accessibilityLabel="Confirm delete"
                testID="custom-collection-delete-confirm"
              />
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                disabled={deleteMutation.isPending}
                onPress={() => setConfirmDelete(false)}
                accessibilityLabel="Cancel delete"
                testID="custom-collection-delete-cancel"
              />
            </XStack>
          ) : (
            <Button
              label="Delete"
              variant="ghost"
              size="sm"
              onPress={() => setConfirmDelete(true)}
              accessibilityLabel="Delete collection"
              testID="custom-collection-delete"
            />
          )}
        </XStack>
        {deleteMutation.error !== null ? (
          <Text variant="caption" tone="error" testID="custom-collection-delete-error">
            {deleteMutation.error.message}
          </Text>
        ) : null}
        {pickerOpen ? null : (
          <Button
            label="Add cards"
            variant="primary"
            size="md"
            onPress={() => setPickerOpen(true)}
            accessibilityLabel="Add cards"
            testID="custom-collection-add-cards"
          />
        )}
      </YStack>
      {pickerOpen ? (
        <PrintingPicker
          ownedItems={ownedQuery.data ?? []}
          existingPrintingIds={existingPrintingIds}
          onAdd={handleAddPrinting}
          onClose={() => setPickerOpen(false)}
          testID="custom-collection-picker"
        />
      ) : null}
      {addMutation.error !== null ? (
        <Text
          variant="caption"
          tone="error"
          paddingHorizontal="$4"
          testID="custom-collection-add-error"
        >
          {addMutation.error.message}
        </Text>
      ) : null}
      {removeMutation.error !== null ? (
        <Text
          variant="caption"
          tone="error"
          paddingHorizontal="$4"
          testID="custom-collection-remove-error"
        >
          {removeMutation.error.message}
        </Text>
      ) : null}
      {itemsQuery.isLoading ? (
        <DetailLoadingState />
      ) : itemsQuery.isError ? (
        <DetailErrorState
          message={itemsQuery.error?.message ?? 'Failed to load members.'}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item: CustomCollectionItemDto) => item.printingId}
          renderItem={renderItem}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridColumn}
          ListEmptyComponent={
            <DetailEmptyState onAdd={() => setPickerOpen(true)} />
          }
          testID="custom-collection-members"
        />
      )}
    </YStack>
  );
}

// ============================================================
// Sub-components
// ============================================================

interface CustomMemberTileProps {
  readonly item: CustomCollectionItemDto;
  readonly onPress: (printingId: string) => Promise<void> | void;
  readonly onRemove: (printingId: string) => void;
}

function CustomMemberTile(props: CustomMemberTileProps): ReactNode {
  const { item, onPress, onRemove } = props;
  const testID = `custom-collection-member-${item.printingId}`;
  return (
    <YStack
      flex={1}
      gap="$2"
      padding="$2"
      borderRadius={8}
      backgroundColor="$surfaceMuted"
      testID={testID}
    >
      <Pressable
        onPress={() => {
          void onPress(item.printingId);
        }}
        variant="ghost"
        aria-label={`Open card ${item.printingId}`}
        accessibilityLabel={`Open card ${item.printingId}`}
        testID={`${testID}-open`}
      >
        <YStack
          aspectRatio={5 / 7}
          backgroundColor="$surface"
          borderRadius={6}
          alignItems="center"
          justifyContent="center"
          padding="$2"
        >
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {item.printingId}
          </Text>
        </YStack>
      </Pressable>
      <Button
        label="Remove"
        variant="ghost"
        size="sm"
        onPress={() => onRemove(item.printingId)}
        accessibilityLabel={`Remove ${item.printingId}`}
        testID={`${testID}-remove`}
      />
    </YStack>
  );
}

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function DetailLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="custom-collection-detail-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading…
      </Text>
    </YStack>
  );
}

interface DetailErrorStateProps {
  readonly message: string;
}

function DetailErrorState(props: DetailErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="custom-collection-detail-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load this collection
      </Text>
      <Text variant="body" tone="muted">
        {props.message}
      </Text>
    </YStack>
  );
}

interface DetailNotFoundStateProps {
  readonly reason: 'unknown-id' | 'missing-id';
  readonly id?: string;
}

function DetailNotFoundState(props: DetailNotFoundStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      backgroundColor="$background"
      testID="custom-collection-detail-not-found"
    >
      <Text variant="title" tone="default">
        Collection not found
      </Text>
      <Text variant="body" tone="muted">
        {props.reason === 'unknown-id' && props.id !== undefined
          ? `We couldn’t find a collection with the id “${props.id}”.`
          : 'No collection was specified.'}
      </Text>
    </YStack>
  );
}

interface DetailEmptyStateProps {
  readonly onAdd: () => void;
}

function DetailEmptyState(props: DetailEmptyStateProps): ReactNode {
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$5"
      margin="$4"
      alignItems="center"
      testID="custom-collection-detail-empty"
    >
      <Text variant="subtitle" tone="default">
        No cards yet
      </Text>
      <Text variant="body" tone="muted">
        Add cards from your owned collection to get started.
      </Text>
      <Button
        label="Add cards"
        variant="primary"
        size="md"
        onPress={props.onAdd}
        accessibilityLabel="Add cards"
        testID="custom-collection-detail-empty-add"
      />
    </Card>
  );
}

interface DetailSignInPromptProps {
  readonly onSignIn: () => void;
}

function DetailSignInPrompt(props: DetailSignInPromptProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="custom-collection-detail-sign-in-prompt"
    >
      <Text variant="title" tone="default">
        Sign in to manage this collection
      </Text>
      <Button
        label="Sign in"
        variant="primary"
        size="lg"
        onPress={props.onSignIn}
        accessibilityLabel="Sign in"
        testID="custom-collection-detail-sign-in-button"
      />
    </YStack>
  );
}
