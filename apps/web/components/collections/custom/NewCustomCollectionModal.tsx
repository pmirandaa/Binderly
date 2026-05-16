'use client';

// "New custom collection" modal — name (required) + description
// (optional). Submitting POSTs the manual-only create body via
// the injected `CustomCollectionApi`; on success we close the
// modal and let the parent re-fetch the list.
//
// The slug is derived from the name client-side so the user
// doesn't have to think about URL shape. The contract regex
// (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) is enforced on the server too;
// this is just a UX convenience.

import { useState } from 'react';

import type { CustomCollectionDto } from '@binderly/api-contracts';
import { Button, Input, Text, XStack, YStack } from '@binderly/ui';

import { Modal } from './Modal';
import { slugify } from '../../../lib/collections/custom/format';

import type { CustomCollectionApi } from '../../../lib/collections/custom/api';

export interface NewCustomCollectionModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CustomCollectionDto) => void;
  api: CustomCollectionApi;
}

const DESCRIPTION_MAX = 500;

export function NewCustomCollectionModal({
  open,
  onClose,
  onCreated,
  api,
}: NewCustomCollectionModalProps): React.ReactNode {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const submitDisabled = trimmedName.length === 0 || submitting;

  function reset(): void {
    setName('');
    setDescription('');
    setSubmitting(false);
    setError(null);
  }

  function handleClose(): void {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (submitDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createCustomCollection({
        name: trimmedName,
        slug: slugify(trimmedName),
        description: trimmedDescription.length === 0 ? null : trimmedDescription,
      });
      onCreated(created);
      reset();
      onClose();
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Failed to create custom collection.';
      setError(message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New custom collection"
      testId="new-custom-collection-modal"
    >
      <Text variant="body" tone="muted">
        Group a hand-picked set of cards. You can rename it or add cards anytime.
      </Text>
      <YStack gap="$3">
        <Input
          label="Name"
          placeholder="e.g. Charizards I love"
          value={name}
          onChangeText={setName}
          aria-label="Custom collection name"
          testID="new-custom-collection-name"
        />
        <Input
          label="Description (optional)"
          placeholder="Short note about this collection"
          value={description}
          onChangeText={(next) => setDescription(next.slice(0, DESCRIPTION_MAX))}
          aria-label="Custom collection description"
          testID="new-custom-collection-description"
          helperText={`${trimmedDescription.length}/${DESCRIPTION_MAX}`}
        />
      </YStack>
      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          data-testid="new-custom-collection-error"
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
          data-testid="new-custom-collection-cancel"
        />
        <Button
          label={submitting ? 'Creating…' : 'Create'}
          onPress={() => {
            void handleSubmit();
          }}
          disabled={submitDisabled}
          loading={submitting}
          data-testid="new-custom-collection-submit"
        />
      </XStack>
    </Modal>
  );
}
