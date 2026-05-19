'use client';

// `/collections/smart/new` editor — the public face of the
// smart-collection DSL.
//
// Layout:
//   - Header: title + cancel back-link.
//   - DSL textarea: free-form JSON; we re-parse on every change
//     and surface the result inline (parsed → human explainer;
//     malformed JSON → JSON error; well-formed but bad DSL → DSL
//     error message + the first zod issue).
//   - Run button (free for everyone; gated only on a parseable
//     expression).
//   - Save button:
//       - Free user: disabled with an upsell tooltip + helper text.
//       - Pro user: enabled when there's a parseable expression;
//         opens a save modal collecting name + description; on
//         submit, creates a `custom_collection` with `kind:
//         'smart'` and redirects to `/collections/smart/[id]`.
//   - Result panel: matched count, capped notice, and the
//     `<MatchGrid>`.

import { useEffect, useMemo, useState } from 'react';

import { ApiValidationError } from '@binderly/api-client';
import type { SubscriptionDto } from '@binderly/api-contracts';
import { Button, Card, Input, Text, XStack, YStack } from '@binderly/ui';

import { MatchGrid } from './MatchGrid';
import { prettyPrintJson, slugify } from '../../../lib/collections/smart/format';
import {
  mapSmartPreviewResponse,
  parseSmartExpressionInput,
  runExpression,
  runMatchToView,
  type SmartMatchView,
} from '../../../lib/collections/smart/run';
import { PageLoading } from '../../loading/PageLoading';

import type {
  CatalogPreview,
  CreateSmartCollectionInput,
  SmartCollectionsApi,
} from '../../../lib/collections/smart/api';

const DEFAULT_TEMPLATE = prettyPrintJson({
  type: 'and',
  children: [
    { type: 'eq', field: 'card.name', value: 'Charizard' },
    { type: 'eq', field: 'card.language', value: 'en' },
  ],
});

const SAVE_TOOLTIP_FREE = 'Smart-collection save requires a paid plan';

export interface SmartEditorViewProps {
  api: SmartCollectionsApi;
  /**
   * Called with the new collection's id once a save flow
   * succeeds. The Route wires this to `router.push()`.
   */
  onSaved?: (id: string) => void;
  /**
   * Optional default text — tests can pin a deterministic
   * starting value. Defaults to the DEFAULT_TEMPLATE constant
   * (parses cleanly so the editor is "live" on load).
   */
  initialText?: string;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      preview: CatalogPreview;
      ownedItemsCount: number;
      subscription: SubscriptionDto;
    }
  | { kind: 'error'; message: string };

/**
 * Result of a Run click. `kind` distinguishes the canonical
 * server preview from the local-eval fallback used when the
 * server rejects a `collection.*` predicate with 400.
 */
type RunResultView =
  | {
      kind: 'server';
      matches: SmartMatchView[];
      totalCount: number;
      truncated: boolean;
    }
  | {
      kind: 'local-fallback';
      matches: SmartMatchView[];
      scanned: number;
      capped: boolean;
      reason: string;
    };

export function SmartEditorView({
  api,
  onSaved,
  initialText = DEFAULT_TEMPLATE,
}: SmartEditorViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [text, setText] = useState(initialText);
  const [runResult, setRunResult] = useState<RunResultView | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void Promise.all([
      api.previewCatalog({ signal: controller.signal }),
      api.listOwnedItems(controller.signal),
      api.getSubscription(controller.signal),
    ])
      .then(([preview, ownedItems, subscription]) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'ready',
          preview,
          ownedItemsCount: ownedItems.length,
          subscription,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message =
          err instanceof Error && err.message.length > 0
            ? err.message
            : 'Failed to load the editor.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      controller.abort();
    };
  }, [api]);

  const parseResult = useMemo(() => parseSmartExpressionInput(text), [text]);

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        gap="$5"
        maxWidth={1100}
        marginHorizontal="auto"
        data-testid="smart-editor-page"
      >
        <PageLoading label="Loading editor…" />
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
        data-testid="smart-editor-page"
      >
        <Text variant="title">New smart collection</Text>
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="smart-editor-error"
        >
          <Text variant="subtitle">Could not load the editor</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { preview, subscription } = state;
  const isPro = subscription.tier === 'pro';
  const canRun = parseResult.kind === 'parsed' && !running;
  const canSave = isPro && parseResult.kind === 'parsed';

  const handleRun = async (): Promise<void> => {
    if (parseResult.kind !== 'parsed') return;
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const response = await api.runServerPreview({
        expression: parseResult.expression,
      });
      const mapped = mapSmartPreviewResponse(response);
      setRunResult({
        kind: 'server',
        matches: mapped.matches,
        totalCount: mapped.totalCount,
        truncated: mapped.nextOffset !== null,
      });
    } catch (err: unknown) {
      const fallback = tryLocalFallback(err, parseResult.expression, preview);
      if (fallback !== null) {
        setRunResult(fallback);
      } else {
        const message = err instanceof Error ? err.message : 'Run failed.';
        setRunError(message);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (parseResult.kind !== 'parsed') return;
    if (name.trim().length === 0) {
      setSaveError('Name is required.');
      return;
    }
    const slug = slugify(name);
    if (slug.length === 0) {
      setSaveError('Name must contain at least one letter or number.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const input: CreateSmartCollectionInput = {
      kind: 'smart',
      name: name.trim(),
      slug,
      ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      expression: parseResult.expression,
    };
    try {
      const created = await api.createSmartCollection(input);
      setSaving(false);
      setSaveOpen(false);
      if (onSaved !== undefined) onSaved(created.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed.';
      setSaveError(message);
      setSaving(false);
    }
  };

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="smart-editor-page"
    >
      <YStack gap="$2">
        <Text variant="title" data-testid="smart-editor-title">
          New smart collection
        </Text>
        <Text variant="body" tone="muted">
          Write a JSON expression and click Run to preview the matches.
          Saving is part of Pro.
        </Text>
      </YStack>

      <Card variant="outlined" padding="$4" gap="$3" data-testid="smart-editor-card">
        <YStack gap="$2">
          <Text variant="label">Expression (JSON)</Text>
          <textarea
            value={text}
            onChange={(e): void => setText(e.target.value)}
            data-testid="smart-editor-textarea"
            aria-label="Smart-collection DSL expression"
            spellCheck={false}
            rows={12}
            style={{
              width: '100%',
              minHeight: 220,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text)',
              resize: 'vertical',
            }}
          />
        </YStack>

        <ParseFeedback parseResult={parseResult} />

        <XStack gap="$3" flexWrap="wrap" alignItems="center" data-testid="smart-editor-actions">
          <Button
            label={running ? 'Running…' : 'Run'}
            disabled={!canRun}
            loading={running}
            onPress={handleRun}
            data-testid="smart-editor-run"
            aria-label="Run expression"
          />
          <span
            title={canSave ? '' : SAVE_TOOLTIP_FREE}
            data-testid="smart-editor-save-tooltip"
          >
            <Button
              label="Save"
              disabled={!canSave}
              variant="secondary"
              onPress={(): void => {
                setSaveError(null);
                setSaveOpen(true);
              }}
              data-testid="smart-editor-save"
              aria-label={canSave ? 'Save smart collection' : SAVE_TOOLTIP_FREE}
            />
          </span>
          {!isPro ? (
            <Text variant="caption" tone="muted" data-testid="smart-editor-save-helper">
              {SAVE_TOOLTIP_FREE}
            </Text>
          ) : null}
        </XStack>
      </Card>

      {runError !== null ? (
        <YStack
          padding="$4"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="smart-editor-run-error"
        >
          <Text variant="subtitle">Run failed</Text>
          <Text variant="body" tone="muted">
            {runError}
          </Text>
        </YStack>
      ) : null}

      {runResult !== null ? (
        <YStack gap="$3" data-testid="smart-editor-results">
          <YStack gap="$1">
            {runResult.kind === 'server' ? (
              <>
                <Text variant="subtitle" data-testid="smart-editor-results-summary">
                  {runResult.matches.length} match
                  {runResult.matches.length === 1 ? '' : 'es'} of {runResult.totalCount}{' '}
                  total
                </Text>
                {runResult.truncated ? (
                  <Text
                    variant="caption"
                    tone="muted"
                    data-testid="smart-editor-results-truncated"
                  >
                    Showing the first page — refine the expression or open the
                    saved collection to scroll the remaining matches.
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text variant="subtitle" data-testid="smart-editor-results-summary">
                  {runResult.matches.length} match
                  {runResult.matches.length === 1 ? '' : 'es'} of {runResult.scanned}{' '}
                  scanned printing{runResult.scanned === 1 ? '' : 's'}
                </Text>
                <Text
                  variant="caption"
                  tone="muted"
                  data-testid="smart-editor-results-local-fallback"
                >
                  Using local preview — {runResult.reason}
                </Text>
                {runResult.capped ? (
                  <Text variant="caption" tone="muted" data-testid="smart-editor-results-capped">
                    Local preview capped at {state.preview.printings.length} printings.
                  </Text>
                ) : null}
              </>
            )}
          </YStack>
          <MatchGrid matches={runResult.matches} testId="smart-editor-grid" />
        </YStack>
      ) : null}

      {saveOpen ? (
        <SaveModal
          name={name}
          description={description}
          saving={saving}
          error={saveError}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onSubmit={handleSave}
          onCancel={(): void => setSaveOpen(false)}
        />
      ) : null}
    </YStack>
  );
}

/**
 * Decide whether a Run server-preview error should fall back to
 * the local in-browser evaluator. The V2 worker rejects
 * `collection.*` predicates with `400 VALIDATION` (Q-013); we
 * detect by either the typed error class or a substring match on
 * the message and re-run locally so power users can still preview
 * those rules. Other errors propagate to the run-error state.
 */
function tryLocalFallback(
  err: unknown,
  expression: Parameters<typeof runExpression>[0],
  preview: CatalogPreview,
): { kind: 'local-fallback'; matches: SmartMatchView[]; scanned: number; capped: boolean; reason: string } | null {
  const isValidationError = err instanceof ApiValidationError;
  const message = err instanceof Error ? err.message : '';
  const mentionsCollection = /collection\./i.test(message);
  if (!isValidationError && !mentionsCollection) return null;
  try {
    const local = runExpression(expression, preview, []);
    return {
      kind: 'local-fallback',
      matches: local.matches.map(runMatchToView),
      scanned: local.scanned,
      capped: local.capped,
      reason: isValidationError
        ? 'the server cannot evaluate this expression yet (likely a `collection.*` predicate).'
        : message,
    };
  } catch {
    return null;
  }
}

interface ParseFeedbackProps {
  parseResult: ReturnType<typeof parseSmartExpressionInput>;
}

function ParseFeedback({ parseResult }: ParseFeedbackProps): React.ReactNode {
  if (parseResult.kind === 'empty') {
    return (
      <Text variant="caption" tone="muted" data-testid="smart-editor-parse-empty">
        Paste a JSON expression to get started.
      </Text>
    );
  }
  if (parseResult.kind === 'json-error') {
    return (
      <YStack
        padding="$3"
        gap="$1"
        backgroundColor="$surfaceMuted"
        borderRadius={8}
        role="alert"
        data-testid="smart-editor-parse-json-error"
      >
        <Text variant="bodySmall">JSON parse error</Text>
        <Text variant="caption" tone="muted" data-testid="smart-editor-parse-json-error-detail">
          {parseResult.message}
        </Text>
      </YStack>
    );
  }
  if (parseResult.kind === 'dsl-error') {
    return (
      <YStack
        padding="$3"
        gap="$1"
        backgroundColor="$surfaceMuted"
        borderRadius={8}
        role="alert"
        data-testid="smart-editor-parse-dsl-error"
      >
        <Text variant="bodySmall">Smart-collection schema rejected this expression</Text>
        <Text variant="caption" tone="muted" data-testid="smart-editor-parse-dsl-error-detail">
          {parseResult.message}
        </Text>
      </YStack>
    );
  }
  return (
    <YStack gap="$1" data-testid="smart-editor-parse-ok">
      <Text variant="bodySmall" tone="muted">
        Translation
      </Text>
      <Text variant="body" data-testid="smart-editor-parse-explanation">
        {parseResult.explanation}
      </Text>
    </YStack>
  );
}

interface SaveModalProps {
  name: string;
  description: string;
  saving: boolean;
  error: string | null;
  onNameChange: (next: string) => void;
  onDescriptionChange: (next: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
}

function SaveModal(props: SaveModalProps): React.ReactNode {
  const { name, description, saving, error, onNameChange, onDescriptionChange, onSubmit, onCancel } =
    props;
  return (
    <YStack
      padding="$5"
      gap="$3"
      backgroundColor="$surface"
      borderRadius={12}
      borderWidth={1}
      borderColor="$border"
      data-testid="smart-editor-save-modal"
      role="dialog"
      aria-label="Save smart collection"
    >
      <Text variant="subtitle">Save smart collection</Text>
      <Input
        label="Name"
        value={name}
        onChangeText={onNameChange}
        placeholder="All English Charizards"
        testID="smart-editor-save-name"
        aria-label="Smart-collection name"
        disabled={saving}
      />
      <Input
        label="Description (optional)"
        value={description}
        onChangeText={onDescriptionChange}
        placeholder="Every Charizard in any English set"
        testID="smart-editor-save-description"
        aria-label="Smart-collection description"
        disabled={saving}
      />
      {error !== null ? (
        <Text variant="caption" tone="muted" data-testid="smart-editor-save-error">
          {error}
        </Text>
      ) : null}
      <XStack gap="$3" justifyContent="flex-end">
        <Button
          variant="ghost"
          label="Cancel"
          onPress={onCancel}
          disabled={saving}
          data-testid="smart-editor-save-cancel"
        />
        <Button
          label={saving ? 'Saving…' : 'Save'}
          onPress={onSubmit}
          loading={saving}
          data-testid="smart-editor-save-submit"
          aria-label="Submit save"
        />
      </XStack>
    </YStack>
  );
}
