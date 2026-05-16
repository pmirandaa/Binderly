'use client';

// `/collections/smart` home — header, "Try a smart query" button
// (free for everyone), and either:
//   - the user's saved smart-collection list (paid users only); or
//   - an upgrade-CTA card pinned next to the editor link (free
//     users).
//
// Plan-gating reads `tier` off `getMySubscription()`. Free users
// see a `Saved: 0 / 0` header, the upgrade prompt, and the "Try"
// button — exactly the funnel PROJECT.md § 9 prescribes
// ("button visible but disabled with upgrade prompt"; here the
// list is hidden because there's nothing to list when the cap
// is 0).

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { CustomCollectionDto, SubscriptionDto } from '@binderly/api-contracts';
import { Button, Card, Text, XStack, YStack } from '@binderly/ui';

import { UpgradePrompt } from './UpgradePrompt';
import {
  formatSavedCount,
  formatTimestamp,
  truncateExpression,
} from '../../../lib/collections/smart/format';
import { PageLoading } from '../../loading/PageLoading';

import type { SmartCollectionsApi } from '../../../lib/collections/smart/api';

export interface SmartListViewProps {
  api: SmartCollectionsApi;
  /**
   * Optional callback fired when the user clicks the action menu's
   * Delete affordance. The Route wires this to a confirmation
   * + `api.deleteSmartCollection()` flow; tests pass a `vi.fn()`
   * to assert the click.
   */
  onDelete?: (collection: CustomCollectionDto) => void;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      collections: CustomCollectionDto[];
      rulesByCollectionId: Record<string, unknown>;
      subscription: SubscriptionDto;
    }
  | { kind: 'error'; message: string };

export function SmartListView({ api, onDelete }: SmartListViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void Promise.all([
      api.getSubscription(controller.signal),
      api.listSmartCollections(controller.signal),
    ])
      .then(async ([subscription, collections]) => {
        if (controller.signal.aborted) return;
        // Pull each rule in parallel so the row's expression
        // preview shows the actual saved DSL, not a placeholder.
        // We swallow per-row failures: a missing rule shouldn't
        // hide the whole list (it implies a bad backend state, but
        // we want the user to be able to delete the broken row).
        const ruleEntries = await Promise.all(
          collections.map(async (c) => {
            try {
              const rule = await api.getSmartRule(c.id, controller.signal);
              return [c.id, rule.expression] as const;
            } catch {
              return [c.id, null] as const;
            }
          }),
        );
        if (controller.signal.aborted) return;
        const rulesByCollectionId: Record<string, unknown> = {};
        for (const [id, expression] of ruleEntries) {
          rulesByCollectionId[id] = expression;
        }
        setState({ kind: 'ready', collections, rulesByCollectionId, subscription });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to load your smart collections.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, refreshTick]);

  const handleDelete = (collection: CustomCollectionDto): void => {
    if (onDelete !== undefined) {
      onDelete(collection);
    }
    // Trigger a refetch so the row disappears even when the parent
    // doesn't manage state externally. The Route's `onDelete` is
    // the one that actually issues the DELETE; we wait for it to
    // resolve via the parent re-rendering with a new `api`.
    setRefreshTick((t) => t + 1);
  };

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="smart-list-page"
      >
        <PageLoading label="Loading smart collections…" />
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
        data-testid="smart-list-page"
      >
        <Text variant="title">Smart collections</Text>
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="smart-list-error"
        >
          <Text variant="subtitle">Could not load your smart collections</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { collections, rulesByCollectionId, subscription } = state;
  const isPro = subscription.tier === 'pro';
  const visibleCollections = isPro ? collections : [];

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="smart-list-page"
    >
      <YStack gap="$2">
        <Text variant="title" data-testid="smart-list-title">
          Smart collections
        </Text>
        <Text variant="body" tone="muted" data-testid="smart-list-subtitle">
          {formatSavedCount({
            count: visibleCollections.length,
            tier: subscription.tier,
          })}
          {' · '}
          Search runs free; saving requires Pro.
        </Text>
      </YStack>

      <XStack gap="$3" flexWrap="wrap" data-testid="smart-list-actions">
        <Link
          href="/collections/smart/new"
          style={{ textDecoration: 'none' }}
          data-testid="smart-list-try-link"
        >
          <Button label="Try a smart query" aria-label="Open the smart-collection editor" />
        </Link>
      </XStack>

      {!isPro ? (
        <UpgradePrompt testId="smart-list-upgrade" />
      ) : visibleCollections.length === 0 ? (
        <YStack
          padding="$6"
          gap="$3"
          alignItems="center"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="smart-list-empty"
        >
          <Text variant="subtitle">No saved smart collections yet</Text>
          <Text variant="body" tone="muted">
            Use the editor to write your first rule and save it for later.
          </Text>
        </YStack>
      ) : (
        <YStack gap="$3" data-testid="smart-list">
          {visibleCollections.map((collection) => (
            <SmartCollectionRow
              key={collection.id}
              collection={collection}
              expression={rulesByCollectionId[collection.id]}
              onDelete={handleDelete}
            />
          ))}
        </YStack>
      )}
    </YStack>
  );
}

interface SmartCollectionRowProps {
  collection: CustomCollectionDto;
  expression: unknown;
  onDelete: (c: CustomCollectionDto) => void;
}

function SmartCollectionRow({
  collection,
  expression,
  onDelete,
}: SmartCollectionRowProps): React.ReactNode {
  const summary =
    expression !== null
      ? truncateExpression(expression)
      : '(unable to load expression)';
  return (
    <Card
      variant="outlined"
      padding="$4"
      gap="$3"
      hoverStyle={{ borderColor: '$primary' }}
      focusStyle={{ borderColor: '$primary' }}
      data-testid="smart-list-row"
    >
      <XStack
        justifyContent="space-between"
        alignItems="flex-start"
        gap="$3"
        flexWrap="wrap"
      >
        <YStack gap="$1" flex={1} minWidth={240}>
          <Link
            href={`/collections/smart/${encodeURIComponent(collection.id)}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
            data-testid="smart-list-row-link"
          >
            <Text variant="subtitle" data-testid="smart-list-row-name">
              {collection.name}
            </Text>
          </Link>
          {collection.description !== null ? (
            <Text variant="bodySmall" tone="muted" data-testid="smart-list-row-description">
              {collection.description}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" data-testid="smart-list-row-summary">
            {summary}
          </Text>
          <Text variant="caption" tone="muted" data-testid="smart-list-row-meta">
            Created {formatTimestamp(collection.createdAt)}
          </Text>
        </YStack>
        <XStack gap="$2" data-testid="smart-list-row-actions">
          <Link
            href={`/collections/smart/${encodeURIComponent(collection.id)}`}
            style={{ textDecoration: 'none' }}
            data-testid="smart-list-row-view"
          >
            <Button
              variant="ghost"
              size="sm"
              label="View"
              aria-label={`View ${collection.name}`}
            />
          </Link>
          <Button
            variant="destructive"
            size="sm"
            label="Delete"
            data-testid="smart-list-row-delete"
            aria-label={`Delete ${collection.name}`}
            onPress={(): void => onDelete(collection)}
          />
        </XStack>
      </XStack>
    </Card>
  );
}
