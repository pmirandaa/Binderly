'use client';

// Printing-picker modal — pick a set, multi-select printings, hit
// "Add N cards". Mirrors the browse stage's set + cards-in-set
// fetch shape (`listAllSets` then `listSetCardsWithPrintings`)
// rather than building a full search index for v1; the brief
// explicitly endorses reusing browse filter patterns.
//
// Already-included printings are surfaced as disabled rows with
// "Already added" text so the user doesn't re-pick them.

import { useEffect, useMemo, useState } from 'react';

import type { CardWithPrintingsDto, PrintingDto, SetDto } from '@binderly/api-contracts';
import { Button, Card, Input, Modal, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { sortSetsByReleaseDateDesc } from '../../../lib/browse/format';

import type { CustomCollectionApi } from '../../../lib/collections/custom/api';

export interface AddCardsModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called once per accepted printing as the bulk-add resolves on
   * the server. The parent uses the callback to optimistically
   * update its member list.
   */
  onAdded: (printingId: string) => void;
  api: CustomCollectionApi;
  collectionId: string;
  existingPrintingIds: ReadonlyArray<string>;
}

type SetsState =
  | { kind: 'loading' }
  | { kind: 'ready'; sets: SetDto[] }
  | { kind: 'error'; message: string };

type CardsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; cards: CardWithPrintingsDto[] }
  | { kind: 'error'; message: string };

export function AddCardsModal({
  open,
  onClose,
  onAdded,
  api,
  collectionId,
  existingPrintingIds,
}: AddCardsModalProps): React.ReactNode {
  const [setsState, setSetsState] = useState<SetsState>({ kind: 'loading' });
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [cardsState, setCardsState] = useState<CardsState>({ kind: 'idle' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingSet = useMemo(() => new Set(existingPrintingIds), [existingPrintingIds]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSetsState({ kind: 'loading' });
    api
      .listAllSets(controller.signal)
      .then((sets) => {
        if (controller.signal.aborted) return;
        const sorted = sortSetsByReleaseDateDesc(sets);
        setSetsState({ kind: 'ready', sets: sorted });
        if (sorted.length > 0 && activeSetId === null) {
          setActiveSetId(sorted[0]!.id);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message =
          err instanceof Error && err.message.length > 0 ? err.message : 'Failed to load sets.';
        setSetsState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, open, activeSetId]);

  useEffect(() => {
    if (!open || activeSetId === null) return;
    const controller = new AbortController();
    setCardsState({ kind: 'loading' });
    api
      .listSetCardsWithPrintings(activeSetId, controller.signal)
      .then((cards) => {
        if (controller.signal.aborted) return;
        setCardsState({ kind: 'ready', cards });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message =
          err instanceof Error && err.message.length > 0 ? err.message : 'Failed to load cards.';
        setCardsState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, open, activeSetId]);

  function toggleSelected(printingId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(printingId)) next.delete(printingId);
      else next.add(printingId);
      return next;
    });
  }

  function reset(): void {
    setSelected(new Set());
    setSearch('');
    setSubmitting(false);
    setError(null);
  }

  function handleClose(): void {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (submitting || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    const ids = Array.from(selected);
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (const printingId of ids) {
      try {
        await api.addPrintingToCustomCollection({
          customCollectionId: collectionId,
          printingId,
        });
        succeeded.push(printingId);
      } catch {
        failed.push(printingId);
      }
    }
    for (const id of succeeded) onAdded(id);
    setSubmitting(false);
    if (failed.length > 0) {
      setError(
        `Added ${succeeded.length} of ${ids.length} cards. ${failed.length} could not be added; please try again.`,
      );
      // Keep the modal open so the user can retry the failed ones;
      // de-select the ones we already added.
      setSelected(new Set(failed));
      return;
    }
    reset();
    onClose();
  }

  const filteredCards = useMemo(() => {
    if (cardsState.kind !== 'ready') return [];
    const q = search.trim().toLowerCase();
    if (q.length === 0) return cardsState.cards;
    return cardsState.cards.filter((card) => card.name.toLowerCase().includes(q));
  }, [cardsState, search]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add cards"
      maxWidth={780}
      testID="add-cards-modal"
    >
      <Text variant="body" tone="muted">
        Pick a set, then choose the printings you want to add to this collection.
      </Text>

      {setsState.kind === 'loading' ? (
        <YStack padding="$4" alignItems="center" data-testid="add-cards-sets-loading">
          <Spinner size="md" />
        </YStack>
      ) : null}

      {setsState.kind === 'error' ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          data-testid="add-cards-sets-error"
        >
          <Text variant="bodySmall" tone="muted">
            {setsState.message}
          </Text>
        </YStack>
      ) : null}

      {setsState.kind === 'ready' ? (
        <YStack gap="$3">
          <YStack gap="$2">
            <Text variant="label">Set</Text>
            <select
              value={activeSetId ?? ''}
              onChange={(e) => {
                setActiveSetId(e.target.value);
                setSelected(new Set());
              }}
              data-testid="add-cards-set-select"
              aria-label="Pick a set"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #ddd',
                fontSize: 15,
                background: 'transparent',
                color: 'inherit',
              }}
            >
              {setsState.sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>
          </YStack>
          <Input
            label="Search by card name"
            placeholder="e.g. Charizard"
            value={search}
            onChangeText={setSearch}
            aria-label="Search cards by name"
            testID="add-cards-search"
          />
        </YStack>
      ) : null}

      {cardsState.kind === 'loading' ? (
        <YStack padding="$4" alignItems="center" data-testid="add-cards-loading">
          <Spinner size="md" />
        </YStack>
      ) : null}

      {cardsState.kind === 'error' ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          data-testid="add-cards-error"
        >
          <Text variant="bodySmall" tone="muted">
            {cardsState.message}
          </Text>
        </YStack>
      ) : null}

      {cardsState.kind === 'ready' ? (
        filteredCards.length === 0 ? (
          <YStack padding="$4" alignItems="center" data-testid="add-cards-empty">
            <Text variant="body" tone="muted">
              No cards match.
            </Text>
          </YStack>
        ) : (
          <YStack gap="$2" data-testid="add-cards-results">
            {filteredCards.map((card) =>
              card.printings.map((printing) => (
                <PickerRow
                  key={printing.id}
                  card={card}
                  printing={printing}
                  alreadyAdded={existingSet.has(printing.id)}
                  selected={selected.has(printing.id)}
                  onToggle={() => toggleSelected(printing.id)}
                />
              )),
            )}
          </YStack>
        )
      ) : null}

      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          data-testid="add-cards-submit-error"
          role="alert"
        >
          <Text variant="bodySmall" tone="muted">
            {error}
          </Text>
        </YStack>
      ) : null}

      <XStack gap="$2" justifyContent="flex-end" alignItems="center">
        <Text variant="bodySmall" tone="muted" data-testid="add-cards-selection-count">
          {selected.size === 0 ? 'Pick at least one card' : `${selected.size} selected`}
        </Text>
        <Button
          label="Cancel"
          variant="ghost"
          onPress={handleClose}
          disabled={submitting}
          data-testid="add-cards-cancel"
        />
        <Button
          label={submitting ? 'Adding…' : `Add ${selected.size} cards`}
          onPress={() => {
            void handleSubmit();
          }}
          disabled={selected.size === 0 || submitting}
          loading={submitting}
          data-testid="add-cards-submit"
        />
      </XStack>
    </Modal>
  );
}

interface PickerRowProps {
  card: CardWithPrintingsDto;
  printing: PrintingDto;
  alreadyAdded: boolean;
  selected: boolean;
  onToggle: () => void;
}

function PickerRow({
  card,
  printing,
  alreadyAdded,
  selected,
  onToggle,
}: PickerRowProps): React.ReactNode {
  const variantLabel = printing.variantClass.replace(/_/g, ' ').toLowerCase();
  const disabled = alreadyAdded;
  return (
    <Card
      variant="outlined"
      padding="$3"
      data-testid="add-cards-row"
      data-printing-id={printing.id}
      data-already-added={alreadyAdded ? 'true' : undefined}
    >
      <XStack gap="$3" alignItems="center" justifyContent="space-between">
        <XStack gap="$3" alignItems="center" flex={1}>
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={onToggle}
            aria-label={`Select ${card.name} (${variantLabel})`}
            data-testid="add-cards-row-checkbox"
          />
          <YStack gap="$1" flex={1}>
            <Text variant="body">
              #{card.number} · {card.name}
            </Text>
            <Text variant="caption" tone="muted">
              {variantLabel}
            </Text>
          </YStack>
        </XStack>
        {alreadyAdded ? (
          <Text variant="bodySmall" tone="muted" data-testid="add-cards-row-already-added">
            Already added
          </Text>
        ) : null}
      </XStack>
    </Card>
  );
}
