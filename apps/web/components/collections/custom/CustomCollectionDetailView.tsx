'use client';

// `/collections/custom/[id]` — single custom collection detail.
//
// Sections:
//   - Header: inline-editable name + description (saves on blur,
//     optimistic update); member count; Delete button → reuses
//     the list view's `<DeleteCustomCollectionModal>`.
//   - Add cards CTA → opens `<AddCardsModal>`.
//   - Member grid: each member = printing tile with a Remove
//     button. Tap a member → `/cards/[printingId]`.
//   - Loading / error / 404 states.
//
// Optimistic updates: we maintain a local `members` list and
// adjust it before the server confirms. On failure we surface a
// non-blocking error banner and the next list refetch reconciles.
//
// The brief left drag-to-reorder optional. We leave members in
// `addedAt` insertion order — users can still see the most recent
// adds at the bottom; reordering is a future micro-task, easier to
// add atop a stable foundation than to rip out and rebuild later.

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiNotFoundError } from '@binderly/api-client';
import type {
  CustomCollectionDto,
  CustomCollectionItemDto,
  PrintingWithContextDto,
} from '@binderly/api-contracts';
import { Button, Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { AddCardsModal } from './AddCardsModal';
import { DeleteCustomCollectionModal } from './DeleteCustomCollectionModal';
import { formatReleaseDate } from '../../../lib/browse/format';
import { memberCountLabel } from '../../../lib/collections/custom/format';
import { PageLoading } from '../../loading/PageLoading';

import type { CustomCollectionApi } from '../../../lib/collections/custom/api';

export interface CustomCollectionDetailViewProps {
  api: CustomCollectionApi;
  collectionId: string;
  /** Fired when the underlying row is gone (for `notFound()` wiring). */
  onNotFound?: () => void;
  /** Fired after a successful delete (e.g. router.replace('/collections/custom')). */
  onDeleted?: () => void;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      collection: CustomCollectionDto;
      items: CustomCollectionItemDto[];
      printings: PrintingWithContextDto[];
    }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export function CustomCollectionDetailView({
  api,
  collectionId,
  onNotFound,
  onDeleted,
}: CustomCollectionDetailViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [deletingOpen, setDeletingOpen] = useState(false);
  const [addCardsOpen, setAddCardsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    Promise.all([
      api.getCustomCollection(collectionId, controller.signal),
      api.listCustomCollectionItems(collectionId, controller.signal),
    ])
      .then(async ([collection, items]) => {
        if (controller.signal.aborted) return;
        if (collection.kind !== 'manual') {
          // Smart-collection rows live at the same URL; T-W-SMART
          // owns that surface. From the manual page's POV, this
          // looks like 404 (the manual collection with that id
          // doesn't exist).
          setState({ kind: 'not-found' });
          return;
        }
        setName(collection.name);
        setDescription(collection.description ?? '');
        const printings =
          items.length === 0
            ? []
            : await api.getPrintingsByIds(
                items.map((it) => it.printingId),
                controller.signal,
              );
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', collection, items, printings });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiNotFoundError) {
          setState({ kind: 'not-found' });
          return;
        }
        const message =
          err instanceof Error && err.message.length > 0
            ? err.message
            : 'Failed to load this custom collection.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, collectionId]);

  if (state.kind === 'not-found') {
    if (onNotFound !== undefined) onNotFound();
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="custom-collection-detail-page"
      >
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="custom-collection-detail-not-found"
        >
          <Text variant="subtitle">Collection not found</Text>
          <Text variant="body" tone="muted">
            We couldn&apos;t find that custom collection. It may have been deleted.
          </Text>
          <Link
            href="/collections/custom"
            style={{ textDecoration: 'none' }}
            data-testid="custom-collection-detail-back-link"
          >
            <Text variant="bodySmall" tone="primary">
              ← Back to custom collections
            </Text>
          </Link>
        </YStack>
      </YStack>
    );
  }

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="custom-collection-detail-page"
      >
        <PageLoading label="Loading custom collection…" />
      </YStack>
    );
  }

  if (state.kind === 'error') {
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="custom-collection-detail-page"
      >
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="custom-collection-detail-error"
        >
          <Text variant="subtitle">Could not load this collection</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { collection, items, printings } = state;
  const printingMap = new Map(printings.map((p) => [p.id, p]));

  async function persistMeta(patch: { name?: string; description?: string | null }): Promise<void> {
    if (state.kind !== 'ready') return;
    setSavingMeta(true);
    setMetaError(null);
    try {
      const updated = await api.updateCustomCollection({
        id: state.collection.id,
        patch,
      });
      setState((prev) => (prev.kind === 'ready' ? { ...prev, collection: updated } : prev));
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0 ? err.message : 'Failed to save changes.';
      setMetaError(message);
    } finally {
      setSavingMeta(false);
    }
  }

  function handleNameBlur(): void {
    if (state.kind !== 'ready') return;
    const next = name.trim();
    if (next.length === 0 || next === state.collection.name) {
      setName(state.collection.name);
      return;
    }
    void persistMeta({ name: next });
  }

  function handleDescriptionBlur(): void {
    if (state.kind !== 'ready') return;
    const next = description.trim();
    const current = state.collection.description ?? '';
    if (next === current) return;
    void persistMeta({ description: next.length === 0 ? null : next });
  }

  async function handleRemoveMember(printingId: string): Promise<void> {
    if (state.kind !== 'ready') return;
    setMemberError(null);
    const previousItems = state.items;
    const previousPrintings = state.printings;
    setState((prev) =>
      prev.kind === 'ready'
        ? {
            ...prev,
            items: prev.items.filter((it) => it.printingId !== printingId),
            printings: prev.printings.filter((p) => p.id !== printingId),
          }
        : prev,
    );
    try {
      await api.removePrintingFromCustomCollection({
        customCollectionId: state.collection.id,
        printingId,
      });
    } catch (err) {
      setState((prev) =>
        prev.kind === 'ready'
          ? { ...prev, items: previousItems, printings: previousPrintings }
          : prev,
      );
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Could not remove that card.';
      setMemberError(message);
    }
  }

  function handleAdded(printingId: string): void {
    setMemberError(null);
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      if (prev.items.some((it) => it.printingId === printingId)) return prev;
      const newItem: CustomCollectionItemDto = {
        customCollectionId: prev.collection.id,
        printingId,
        addedAt: new Date().toISOString(),
      };
      return {
        ...prev,
        items: [...prev.items, newItem],
      };
    });
    // The new printing's full context isn't loaded yet — fetch it
    // so the tile renders without a re-fetch of the whole list.
    void api.getPrintingsByIds([printingId]).then((rows) => {
      const fetched = rows[0];
      if (fetched === undefined) return;
      setState((prev) =>
        prev.kind === 'ready' ? { ...prev, printings: [...prev.printings, fetched] } : prev,
      );
    });
  }

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="custom-collection-detail-page"
      data-collection-id={collection.id}
    >
      <Link
        href="/collections/custom"
        style={{ textDecoration: 'none' }}
        data-testid="custom-collection-detail-back"
      >
        <Text variant="bodySmall" tone="primary">
          ← Back to custom collections
        </Text>
      </Link>

      <YStack gap="$3">
        <XStack gap="$3" flexWrap="wrap" justifyContent="space-between" alignItems="flex-start">
          <YStack flex={1} minWidth={280} gap="$2">
            <YStack gap="$1">
              <Text variant="label" tone="muted">
                Name
              </Text>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleNameBlur}
                aria-label="Custom collection name"
                data-testid="custom-collection-detail-name-input"
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  fontSize: 18,
                  fontWeight: 600,
                  background: 'transparent',
                  color: 'inherit',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </YStack>
            <YStack gap="$1">
              <Text variant="label" tone="muted">
                Description
              </Text>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                aria-label="Custom collection description"
                data-testid="custom-collection-detail-description-input"
                rows={2}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  fontSize: 15,
                  background: 'transparent',
                  color: 'inherit',
                  width: '100%',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
              <Text variant="caption" tone="muted">
                Saved when you click out of the field.
              </Text>
            </YStack>
            {savingMeta ? (
              <Text variant="caption" tone="muted" data-testid="custom-collection-detail-saving">
                Saving…
              </Text>
            ) : null}
            {metaError !== null ? (
              <Text
                variant="caption"
                tone="error"
                role="alert"
                data-testid="custom-collection-detail-meta-error"
              >
                {metaError}
              </Text>
            ) : null}
          </YStack>
          <YStack gap="$2" minWidth={180}>
            <Text variant="bodySmall" tone="muted" data-testid="custom-collection-detail-count">
              {memberCountLabel(items.length)}
            </Text>
            <Button
              label="Add cards"
              onPress={() => setAddCardsOpen(true)}
              data-testid="custom-collection-detail-add-cards"
            />
            <Button
              label="Delete collection"
              variant="destructive"
              onPress={() => setDeletingOpen(true)}
              data-testid="custom-collection-detail-delete"
            />
          </YStack>
        </XStack>
      </YStack>

      {memberError !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          data-testid="custom-collection-detail-member-error"
        >
          <Text variant="bodySmall" tone="muted">
            {memberError}
          </Text>
        </YStack>
      ) : null}

      {items.length === 0 ? (
        <YStack
          padding="$6"
          gap="$3"
          alignItems="center"
          data-testid="custom-collection-detail-empty"
        >
          <Text variant="subtitle">No cards yet</Text>
          <Text variant="body" tone="muted">
            Click <strong>Add cards</strong> above to pick printings from any set.
          </Text>
        </YStack>
      ) : (
        <YStack gap="$3" data-testid="custom-collection-detail-members">
          <Text variant="subtitle">Members</Text>
          <XStack flexWrap="wrap" gap="$3" data-testid="custom-collection-detail-grid">
            {items.map((item) => {
              const printing = printingMap.get(item.printingId);
              if (printing === undefined) {
                return (
                  <MemberFallback
                    key={item.printingId}
                    printingId={item.printingId}
                    onRemove={() => {
                      void handleRemoveMember(item.printingId);
                    }}
                  />
                );
              }
              return (
                <MemberTile
                  key={item.printingId}
                  printing={printing}
                  onRemove={() => {
                    void handleRemoveMember(item.printingId);
                  }}
                />
              );
            })}
          </XStack>
        </YStack>
      )}

      <AddCardsModal
        open={addCardsOpen}
        onClose={() => setAddCardsOpen(false)}
        onAdded={handleAdded}
        api={api}
        collectionId={collection.id}
        existingPrintingIds={items.map((it) => it.printingId)}
      />
      <DeleteCustomCollectionModal
        open={deletingOpen}
        onClose={() => setDeletingOpen(false)}
        onDeleted={() => {
          if (onDeleted !== undefined) onDeleted();
        }}
        api={api}
        collection={{ id: collection.id, name: collection.name }}
      />
    </YStack>
  );
}

function MemberTile({
  printing,
  onRemove,
}: {
  printing: PrintingWithContextDto;
  onRemove: () => void;
}): React.ReactNode {
  const variantLabel = printing.variantClass.replace(/_/g, ' ').toLowerCase();
  return (
    <Card
      variant="outlined"
      padding="$3"
      gap="$2"
      width={220}
      flexBasis={220}
      data-testid="custom-collection-detail-member"
      data-printing-id={printing.id}
    >
      <Link
        href={`/cards/${encodeURIComponent(printing.id)}`}
        style={{ textDecoration: 'none', color: 'inherit' }}
        data-testid="custom-collection-detail-member-link"
      >
        <YStack gap="$2">
          {printing.imageSmallUrl !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={printing.imageSmallUrl}
              alt={`${printing.card.name} #${printing.card.number}`}
              style={{ width: '100%', height: 'auto', borderRadius: 6 }}
              data-testid="custom-collection-detail-member-image"
            />
          ) : (
            <YStack
              padding="$3"
              backgroundColor="$surfaceMuted"
              borderRadius={6}
              alignItems="center"
            >
              <Text variant="caption" tone="muted">
                No image
              </Text>
            </YStack>
          )}
          <Text variant="bodySmall">
            #{printing.card.number} · {printing.card.name}
          </Text>
          <Text variant="caption" tone="muted">
            {printing.set.name} · {variantLabel}
          </Text>
          <Text variant="caption" tone="muted">
            {formatReleaseDate(printing.set.releaseDate)}
          </Text>
        </YStack>
      </Link>
      <Button
        label="Remove"
        variant="ghost"
        size="sm"
        onPress={onRemove}
        data-testid="custom-collection-detail-member-remove"
        aria-label={`Remove ${printing.card.name} from this collection`}
      />
    </Card>
  );
}

function MemberFallback({
  printingId,
  onRemove,
}: {
  printingId: string;
  onRemove: () => void;
}): React.ReactNode {
  return (
    <Card
      variant="outlined"
      padding="$3"
      gap="$2"
      width={220}
      flexBasis={220}
      data-testid="custom-collection-detail-member-fallback"
      data-printing-id={printingId}
    >
      <YStack gap="$2" alignItems="center">
        <Spinner size="sm" />
        <Text variant="caption" tone="muted">
          Loading card…
        </Text>
        <Button
          label="Remove"
          variant="ghost"
          size="sm"
          onPress={onRemove}
          aria-label="Remove this card"
        />
      </YStack>
    </Card>
  );
}
