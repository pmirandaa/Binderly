'use client';

// `/collections/custom` — manual custom collections list with the
// free-tier 3-cap gate, create modal, and delete confirmation.
//
// The view receives a narrow `CustomCollectionApi` (the read-/
// write-side surface from `lib/collections/custom/api.ts`) so
// tests render this view directly with a fake api-client and
// skip the `getApiClient()` singleton entirely. The route
// component (`CustomCollectionsRoute`) is responsible for wiring
// the real api-client at runtime.
//
// Free-tier 3-cap (PROJECT.md § 9 + § 16): "Manual custom
// collections — 3 max on free, unlimited on Pro." We render a
// "X / 3 used" header, and disable the "New custom collection"
// button at the cap with an upsell tooltip pointing at
// `/billing` (the billing surface itself ships in Phase 10 —
// linking to a placeholder is the brief's pragmatic shim).

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { CustomCollectionDto } from '@binderly/api-contracts';
import { Button, Card, Text, XStack, YStack } from '@binderly/ui';

import { DeleteCustomCollectionModal } from './DeleteCustomCollectionModal';
import { NewCustomCollectionModal } from './NewCustomCollectionModal';
import {
  FREE_TIER_CUSTOM_COLLECTION_CAP,
  manualOnly,
  type CustomCollectionApi,
} from '../../../lib/collections/custom/api';
import {
  computeCapStatus,
  formatUpdatedAt,
  memberCountLabel,
} from '../../../lib/collections/custom/format';
import { useLimitGate } from '../../../lib/gating';
import { PageLoading } from '../../loading/PageLoading';

export interface CustomCollectionsViewProps {
  api: CustomCollectionApi;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      collections: CustomCollectionDto[];
      memberCounts: Record<string, number>;
    }
  | { kind: 'error'; message: string };

const UPGRADE_TOOLTIP = 'Free plan limit. Upgrade for unlimited custom collections.';

export function CustomCollectionsView({ api }: CustomCollectionsViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api
      .listCustomCollections(controller.signal)
      .then(async (rows) => {
        if (controller.signal.aborted) return;
        const manualRows = manualOnly(rows);
        // Member counts drive the row meta. We fan out a cheap
        // listCustomCollectionItems per row; with the free-tier
        // cap of 3 this is bounded at 3 calls. Pro users with
        // hundreds of collections would want a `?counts=true`
        // server param — out of scope for this task.
        const counts: Record<string, number> = {};
        await Promise.all(
          manualRows.map(async (row) => {
            try {
              const items = await api.listCustomCollectionItems(row.id, controller.signal);
              counts[row.id] = items.length;
            } catch {
              counts[row.id] = 0;
            }
          }),
        );
        if (controller.signal.aborted) return;
        setState({
          kind: 'ready',
          collections: manualRows,
          memberCounts: counts,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to load your custom collections.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, reloadKey]);

  function reloadList(): void {
    setReloadKey((n) => n + 1);
  }

  // Entitlement-aware create gate (T-PB-GATING). Free is capped at 3
  // manual custom collections; Pro is unlimited. Fail-closed: while the
  // tier read is pending the user is treated as free, so the "New" button
  // only unlocks past the cap once Pro is confirmed (under the cap the
  // verdict is identical for both tiers, so there's no flash). The hook is
  // called unconditionally before the loading/error early returns to obey
  // the rules of hooks.
  const manualCount = state.kind === 'ready' ? state.collections.length : 0;
  const createGate = useLimitGate('customCollections', manualCount);

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="custom-collections-page"
      >
        <PageLoading label="Loading your custom collections…" />
      </YStack>
    );
  }

  if (state.kind === 'error') {
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="custom-collections-page"
      >
        <Text variant="title">Custom collections</Text>
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="custom-collections-error"
        >
          <Text variant="subtitle">Could not load your custom collections</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { collections, memberCounts } = state;
  const cap = computeCapStatus(collections.length, FREE_TIER_CUSTOM_COLLECTION_CAP);
  const newButtonDisabled = !createGate.result.allowed;

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="custom-collections-page"
    >
      <YStack gap="$2">
        <XStack alignItems="baseline" justifyContent="space-between" flexWrap="wrap" gap="$3">
          <Text variant="title" data-testid="custom-collections-title">
            Custom collections
          </Text>
          <Text variant="bodySmall" tone="muted" data-testid="custom-collections-cap">
            {cap.used} / {cap.cap} used
          </Text>
        </XStack>
        <Text variant="body" tone="muted">
          Hand-picked groupings of cards. Free plan supports up to {cap.cap}.
        </Text>
      </YStack>

      <XStack gap="$3" alignItems="center" flexWrap="wrap">
        {newButtonDisabled ? (
          <span title={UPGRADE_TOOLTIP} data-testid="custom-collections-new-tooltip">
            <Button
              label="New custom collection"
              disabled
              data-testid="custom-collections-new-button"
              aria-label={UPGRADE_TOOLTIP}
            />
          </span>
        ) : (
          <Button
            label="New custom collection"
            onPress={() => setCreateOpen(true)}
            data-testid="custom-collections-new-button"
            aria-label="Create a new custom collection"
          />
        )}
        {newButtonDisabled ? (
          <Link
            href="/billing"
            style={{ textDecoration: 'none' }}
            data-testid="custom-collections-upgrade-link"
          >
            <Text variant="bodySmall" tone="primary">
              Upgrade for unlimited →
            </Text>
          </Link>
        ) : null}
      </XStack>

      {collections.length === 0 ? (
        <YStack padding="$6" gap="$3" alignItems="center" data-testid="custom-collections-empty">
          <Text variant="subtitle">You don&apos;t have any custom collections yet.</Text>
          <Text variant="body" tone="muted">
            Create one to group hand-picked cards however you like.
          </Text>
          <Button
            label="Create one →"
            onPress={() => setCreateOpen(true)}
            data-testid="custom-collections-empty-create"
          />
        </YStack>
      ) : (
        <YStack gap="$3" data-testid="custom-collections-list">
          {collections.map((row) => (
            <CustomCollectionRow
              key={row.id}
              collection={row}
              memberCount={memberCounts[row.id] ?? 0}
              onDelete={() => setPendingDelete({ id: row.id, name: row.name })}
            />
          ))}
        </YStack>
      )}

      <NewCustomCollectionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          reloadList();
        }}
        api={api}
      />
      <DeleteCustomCollectionModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onDeleted={() => {
          reloadList();
        }}
        api={api}
        collection={pendingDelete}
      />
    </YStack>
  );
}

interface CustomCollectionRowProps {
  collection: CustomCollectionDto;
  memberCount: number;
  onDelete: () => void;
}

function CustomCollectionRow({
  collection,
  memberCount,
  onDelete,
}: CustomCollectionRowProps): React.ReactNode {
  return (
    <Card
      variant="outlined"
      padding="$4"
      gap="$3"
      data-testid="custom-collection-row"
      data-collection-id={collection.id}
    >
      <XStack gap="$3" alignItems="flex-start" justifyContent="space-between" flexWrap="wrap">
        <YStack flex={1} minWidth={240} gap="$1">
          <Link
            href={`/collections/custom/${encodeURIComponent(collection.id)}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
            data-testid="custom-collection-row-link"
          >
            <Text variant="subtitle">{collection.name}</Text>
          </Link>
          {collection.description !== null && collection.description.length > 0 ? (
            <Text variant="body" tone="muted" data-testid="custom-collection-row-description">
              {collection.description}
            </Text>
          ) : null}
          <XStack gap="$3" flexWrap="wrap">
            <Text variant="caption" tone="muted" data-testid="custom-collection-row-count">
              {memberCountLabel(memberCount)}
            </Text>
            <Text variant="caption" tone="muted" data-testid="custom-collection-row-updated">
              {formatUpdatedAt(collection.updatedAt)}
            </Text>
          </XStack>
        </YStack>
        <XStack gap="$2" alignItems="center">
          <Link
            href={`/collections/custom/${encodeURIComponent(collection.id)}`}
            style={{ textDecoration: 'none' }}
            data-testid="custom-collection-row-edit"
          >
            <Button label="Edit" variant="ghost" size="sm" />
          </Link>
          <Button
            label="Delete"
            variant="ghost"
            size="sm"
            onPress={onDelete}
            data-testid="custom-collection-row-delete"
            aria-label={`Delete ${collection.name}`}
          />
        </XStack>
      </XStack>
    </Card>
  );
}
