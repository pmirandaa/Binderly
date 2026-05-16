'use client';

// "Delete custom collection" confirmation modal. Two-step
// destructive action gating per `rules/04-web.md` accessibility +
// destructive UX guidance: the user must press a destructive
// button explicitly; backdrop / escape close without delete.

import { useState } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { Modal } from './Modal';

import type { CustomCollectionApi } from '../../../lib/collections/custom/api';

export interface DeleteCustomCollectionModalProps {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  api: CustomCollectionApi;
  collection: { id: string; name: string } | null;
}

export function DeleteCustomCollectionModal({
  open,
  onClose,
  onDeleted,
  api,
  collection,
}: DeleteCustomCollectionModalProps): React.ReactNode {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose(): void {
    if (submitting) return;
    setError(null);
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    if (collection === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.deleteCustomCollection(collection.id);
      setSubmitting(false);
      onDeleted();
      onClose();
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Failed to delete this collection.';
      setError(message);
    }
  }

  return (
    <Modal
      open={open && collection !== null}
      onClose={handleClose}
      title="Delete custom collection?"
      testId="delete-custom-collection-modal"
    >
      <Text variant="body">
        This will permanently delete{' '}
        <strong data-testid="delete-custom-collection-name">{collection?.name ?? ''}</strong>. The
        cards in your collection are not affected.
      </Text>
      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          data-testid="delete-custom-collection-error"
          role="alert"
        >
          <Text variant="bodySmall" tone="muted">
            {error}
          </Text>
        </YStack>
      ) : null}
      <XStack gap="$2" justifyContent="flex-end">
        <Button
          label="Cancel"
          variant="ghost"
          onPress={handleClose}
          disabled={submitting}
          data-testid="delete-custom-collection-cancel"
        />
        <Button
          label={submitting ? 'Deleting…' : 'Delete'}
          variant="destructive"
          onPress={() => {
            void handleConfirm();
          }}
          disabled={submitting}
          loading={submitting}
          data-testid="delete-custom-collection-confirm"
        />
      </XStack>
    </Modal>
  );
}
