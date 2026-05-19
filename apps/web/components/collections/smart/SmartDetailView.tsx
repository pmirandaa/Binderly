'use client';

// `/collections/smart/[id]` — saved smart-collection viewer.
//
// Auth-gated AND plan-gated. For free-tier users the page renders
// the upgrade CTA instead of the saved expression — the brief
// makes this explicit ("for v1, just check if user has the
// right `subscription.tier`; if not, show 'This smart collection
// is part of a paid plan' + upgrade CTA. Don't crash."). The
// underlying api-client call still happens — RLS gates server-side
// — but on the UI side we hide the result behind the upsell.
//
// The expression is re-run on page load against the same bounded
// catalog preview the editor uses. Match count and last-evaluated
// timestamp populate from the run result; the saved-rule's
// `lastEvaluatedAt` is preserved as the "last server run".

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiNotFoundError, ApiValidationError } from '@binderly/api-client';
import type {
  CollectionItemDto,
  CustomCollectionDto,
  SmartCollectionRuleDto,
  SubscriptionDto,
} from '@binderly/api-contracts';
import {
  isSmartDslParseError,
  safeParseExpression,
  type Expression,
} from '@binderly/smart-collection-dsl';
import { Button, Card, Text, XStack, YStack } from '@binderly/ui';

import { MatchGrid } from './MatchGrid';
import { UpgradePrompt } from './UpgradePrompt';
import {
  formatTimestamp,
  truncateExpression,
} from '../../../lib/collections/smart/format';
import {
  mapSmartPreviewResponse,
  runExpression,
  runMatchToView,
  type SmartMatchView,
} from '../../../lib/collections/smart/run';
import { PageLoading } from '../../loading/PageLoading';

import type {
  CatalogPreview,
  SmartCollectionsApi,
} from '../../../lib/collections/smart/api';

export interface SmartDetailViewProps {
  api: SmartCollectionsApi;
  collectionId: string;
  /** Forwarded to `notFound()` by the route; tests pass `vi.fn()`. */
  onNotFound?: () => void;
  /** Triggered by the Delete button. Route wires this to api delete. */
  onDelete?: (collection: CustomCollectionDto) => void;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      collection: CustomCollectionDto;
      rule: SmartCollectionRuleDto;
      preview: CatalogPreview;
      ownedItems: CollectionItemDto[];
      subscription: SubscriptionDto;
      expression: Expression | null;
      parseError: string | null;
    }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

type ServerRunResult =
  | { kind: 'pending' }
  | {
      kind: 'server';
      matches: SmartMatchView[];
      totalCount: number;
      truncated: boolean;
    }
  | {
      kind: 'local-fallback';
      matches: SmartMatchView[];
      reason: string;
    }
  | { kind: 'error'; message: string };

export function SmartDetailView({
  api,
  collectionId,
  onNotFound,
  onDelete,
}: SmartDetailViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [runResult, setRunResult] = useState<ServerRunResult>({ kind: 'pending' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    setRunResult({ kind: 'pending' });
    void Promise.all([
      api.getSmartCollection(collectionId, controller.signal),
      api.getSmartRule(collectionId, controller.signal),
      api.previewCatalog({ signal: controller.signal }),
      api.listOwnedItems(controller.signal),
      api.getSubscription(controller.signal),
    ])
      .then(([collection, rule, preview, ownedItems, subscription]) => {
        if (controller.signal.aborted) return;
        const parsed = safeParseExpression(rule.expression);
        const expression = parsed.success ? parsed.data : null;
        const parseError = parsed.success ? null : parsed.error.message;
        setState({
          kind: 'ready',
          collection,
          rule,
          preview,
          ownedItems,
          subscription,
          expression,
          parseError,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiNotFoundError) {
          setState({ kind: 'not-found' });
          return;
        }
        // The fixture's "not found" branch throws a normal Error
        // tagged with `name === 'NotFound'` — treat that as 404 too
        // so tests don't have to spin up a real ApiNotFoundError.
        if (err instanceof Error && err.name === 'NotFound') {
          setState({ kind: 'not-found' });
          return;
        }
        if (isSmartDslParseError(err)) {
          setState({
            kind: 'error',
            message: `Saved expression is invalid: ${err.message}`,
          });
          return;
        }
        const message =
          err instanceof Error && err.message.length > 0
            ? err.message
            : 'Failed to load this smart collection.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, collectionId]);

  // Once the data is ready, fire the canonical server preview.
  // Separate effect so a re-render that doesn't change collectionId
  // doesn't re-fetch the catalog. The V2 worker rejects
  // `collection.*` predicates with 400 — when that happens we
  // fall back to the local evaluator over the bounded preview
  // (D4 in T-W-API-V2-WIRING.md).
  useEffect(() => {
    if (state.kind !== 'ready') return;
    if (state.expression === null) return;
    if (state.subscription.tier !== 'pro') return;
    const controller = new AbortController();
    setRunResult({ kind: 'pending' });
    const expression = state.expression;
    const preview = state.preview;
    const ownedItems = state.ownedItems;
    void api
      .runServerPreview({ expression }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        const mapped = mapSmartPreviewResponse(response);
        setRunResult({
          kind: 'server',
          matches: mapped.matches,
          totalCount: mapped.totalCount,
          truncated: mapped.nextOffset !== null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const fallback = tryLocalFallback(err, expression, preview, ownedItems);
        if (fallback !== null) {
          setRunResult(fallback);
          return;
        }
        const message =
          err instanceof Error && err.message.length > 0
            ? err.message
            : 'Failed to evaluate this smart collection.';
        setRunResult({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api, state]);

  if (state.kind === 'not-found') {
    if (onNotFound !== undefined) onNotFound();
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="smart-detail-page"
      >
        <BackLink />
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="smart-detail-not-found"
        >
          <Text variant="subtitle">Smart collection not found</Text>
          <Text variant="body" tone="muted">
            We couldn&apos;t find that smart collection.
          </Text>
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
        data-testid="smart-detail-page"
      >
        <BackLink />
        <PageLoading label="Loading smart collection…" />
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
        data-testid="smart-detail-page"
      >
        <BackLink />
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="smart-detail-error"
        >
          <Text variant="subtitle">Could not load this smart collection</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { collection, rule, subscription, expression, parseError } = state;
  const isPro = subscription.tier === 'pro';

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="smart-detail-page"
    >
      <BackLink />

      <YStack gap="$2" data-testid="smart-detail-header">
        <Text variant="title" data-testid="smart-detail-name">
          {collection.name}
        </Text>
        {collection.description !== null ? (
          <Text variant="body" tone="muted" data-testid="smart-detail-description">
            {collection.description}
          </Text>
        ) : null}
        <XStack gap="$3" flexWrap="wrap">
          <Text variant="caption" tone="muted" data-testid="smart-detail-created">
            Created {formatTimestamp(collection.createdAt)}
          </Text>
          <Text variant="caption" tone="muted" data-testid="smart-detail-last-evaluated">
            Last server run {formatTimestamp(rule.lastEvaluatedAt)}
          </Text>
        </XStack>
      </YStack>

      {!isPro ? (
        <UpgradePrompt
          heading="This smart collection is part of a paid plan"
          body="Upgrade to Pro to view, re-run, and edit your saved smart collections."
          testId="smart-detail-upgrade"
        />
      ) : (
        <>
          <Card variant="outlined" padding="$4" gap="$2" data-testid="smart-detail-rule">
            <Text variant="subtitle">Rule</Text>
            <Text variant="bodySmall" tone="muted" data-testid="smart-detail-rule-summary">
              {truncateExpression(rule.expression, 200)}
            </Text>
            {parseError !== null ? (
              <Text variant="caption" tone="muted" data-testid="smart-detail-parse-error">
                {parseError}
              </Text>
            ) : null}
          </Card>

          {expression !== null ? (
            <YStack gap="$3" data-testid="smart-detail-results">
              {runResult.kind === 'pending' ? (
                <PageLoading label="Re-running smart rule…" />
              ) : runResult.kind === 'error' ? (
                <YStack
                  padding="$5"
                  gap="$2"
                  backgroundColor="$surfaceMuted"
                  borderRadius={12}
                  role="alert"
                  data-testid="smart-detail-run-error"
                >
                  <Text variant="subtitle">Could not re-run this smart collection</Text>
                  <Text variant="body" tone="muted">
                    {runResult.message}
                  </Text>
                </YStack>
              ) : (
                <>
                  <Text variant="subtitle" data-testid="smart-detail-match-count">
                    {runResult.matches.length} match
                    {runResult.matches.length === 1 ? '' : 'es'}
                    {runResult.kind === 'server' && runResult.totalCount > runResult.matches.length
                      ? ` of ${runResult.totalCount}`
                      : ''}
                  </Text>
                  {runResult.kind === 'server' && runResult.truncated ? (
                    <Text
                      variant="caption"
                      tone="muted"
                      data-testid="smart-detail-truncated"
                    >
                      Showing the first page of matches.
                    </Text>
                  ) : null}
                  {runResult.kind === 'local-fallback' ? (
                    <Text
                      variant="caption"
                      tone="muted"
                      data-testid="smart-detail-local-fallback"
                    >
                      Using local preview — {runResult.reason}
                    </Text>
                  ) : null}
                  <MatchGrid matches={runResult.matches} testId="smart-detail-grid" />
                </>
              )}
            </YStack>
          ) : null}
        </>
      )}

      <XStack gap="$3" data-testid="smart-detail-actions">
        <Button
          variant="destructive"
          label="Delete"
          onPress={(): void => onDelete?.(collection)}
          data-testid="smart-detail-delete"
          aria-label={`Delete ${collection.name}`}
        />
      </XStack>
    </YStack>
  );
}

/**
 * Server-preview error → local fallback decision. Mirrors the
 * editor's helper exactly: the V2 worker rejects `collection.*`
 * predicates with `400 VALIDATION` today (Q-013); we detect that
 * and re-run the saved expression against the bounded local
 * preview so paid users still see usable results.
 */
function tryLocalFallback(
  err: unknown,
  expression: Expression,
  preview: CatalogPreview,
  ownedItems: ReadonlyArray<CollectionItemDto>,
): { kind: 'local-fallback'; matches: SmartMatchView[]; reason: string } | null {
  const isValidationError = err instanceof ApiValidationError;
  const message = err instanceof Error ? err.message : '';
  const mentionsCollection = /collection\./i.test(message);
  if (!isValidationError && !mentionsCollection) return null;
  try {
    const local = runExpression(expression, preview, ownedItems);
    return {
      kind: 'local-fallback',
      matches: local.matches.map(runMatchToView),
      reason: isValidationError
        ? 'the server cannot evaluate this expression yet (likely a `collection.*` predicate).'
        : message,
    };
  } catch {
    return null;
  }
}

function BackLink(): React.ReactNode {
  return (
    <Link
      href="/collections/smart"
      style={{ textDecoration: 'none' }}
      data-testid="smart-detail-back-link"
    >
      <Text variant="bodySmall" tone="primary">
        ← Back to smart collections
      </Text>
    </Link>
  );
}
