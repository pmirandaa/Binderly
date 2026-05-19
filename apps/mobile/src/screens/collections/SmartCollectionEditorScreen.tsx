// `<SmartCollectionEditorScreen>` — Smart Collection DSL editor.
//
// v2 preview (T-M-API-V2-WIRING): the Run preview shells out to the
// server-side `/v1/smart-collections/preview` endpoint (PR #68 /
// T-BE-EDGE-FUNCTIONS-V2) via
// `client.smartCollections.preview(...)`. Catalog-wide evaluation;
// the iter-19 "owned printings only" quirk (#FU-22) goes away as
// a side effect because the server walks the full catalog.
//
// Surface:
//
//   - Auth-gated.
//   - DSL text input (multiline-ish; TamaguiInput is single-line on
//     web but mobile native renders multiline; v1 keeps the input
//     compact and points at JSON examples).
//   - Live parse status: error message, or human explanation, below
//     the input as the user types.
//   - "Run" button: parses + posts the AST to the server preview +
//     renders the matching grid + match count. The total-matches
//     line surfaces `totalCount` (may exceed the page) so the user
//     knows the preview is the first page.
//   - "Save" button: paid-only. Free users see the button disabled
//     with the upsell banner above it. Paid users tap → submit a
//     create-smart request → navigate to /collections/smart/{id}.
//   - "Cancel" pops back.

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import type { SmartPreviewItemDto, SmartPreviewResponseDto } from '@binderly/api-contracts';
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { UpgradeBanner } from '../../components/collections/index.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import {
  isPaidTier,
  parseDslText,
  slugify,
  useCreateCustomCollectionMutation,
  useSmartPreviewMutation,
  useSubscriptionQuery,
  type ParseDslResult,
} from '../../lib/collections/index.js';

const PREVIEW_LIMIT = 200;

const styles = StyleSheet.create({
  gridContent: { padding: 12, gap: 12 },
  gridColumn: { gap: 12 },
});

const PLACEHOLDER_DSL = '{"type":"eq","field":"card.name","value":"Charizard"}';

export function SmartCollectionEditorScreen(): ReactNode {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const signedIn = session !== null;

  const subscriptionQuery = useSubscriptionQuery({ enabled: signedIn });
  const createMutation = useCreateCustomCollectionMutation();
  const previewMutation = useSmartPreviewMutation();

  const [text, setText] = useState('');
  const [matches, setMatches] = useState<SmartPreviewResponseDto | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const parseResult = useMemo<ParseDslResult>(() => parseDslText(text), [text]);
  const paid = isPaidTier(subscriptionQuery);

  const handleSignIn = useCallback(() => router.push('/auth/sign-in'), [router]);
  const handleCancel = useCallback(() => router.back(), [router]);

  const handleRun = useCallback(() => {
    if (parseResult.status !== 'ok') {
      setRunError('Fix the parse error before running.');
      setMatches(null);
      return;
    }
    setRunError(null);
    previewMutation.mutate(
      { expression: parseResult.expression, limit: PREVIEW_LIMIT },
      {
        onSuccess: (response) => {
          setMatches(response);
        },
        onError: (cause) => {
          const message = cause instanceof Error ? cause.message : 'Failed to evaluate rule.';
          setRunError(message);
          setMatches(null);
        },
      },
    );
  }, [parseResult, previewMutation]);

  const handleOpenSave = useCallback(() => {
    if (parseResult.status !== 'ok') return;
    setSaveOpen(true);
    setSaveError(null);
  }, [parseResult]);

  const handleSubmitSave = useCallback(async () => {
    if (parseResult.status !== 'ok') return;
    const trimmedName = saveName.trim();
    if (trimmedName.length === 0) {
      setSaveError('Name is required.');
      return;
    }
    const slug = slugify(trimmedName);
    if (slug.length === 0) {
      setSaveError('Name must contain at least one letter or number.');
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        kind: 'smart',
        name: trimmedName,
        slug,
        description: saveDescription.trim().length > 0 ? saveDescription.trim() : null,
        expression: parseResult.expression,
      });
      setSaveOpen(false);
      router.replace(`/collections/smart/${encodeURIComponent(created.id)}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to save.';
      setSaveError(message);
    }
  }, [parseResult, saveName, saveDescription, createMutation, router]);

  const renderItem = useCallback(
    ({ item }: { item: SmartPreviewItemDto }) => (
      <SmartPreviewTile item={item} />
    ),
    [],
  );

  // ---- Auth gate -----------------------------------------------
  if (authLoading) {
    return <EditorLoadingState />;
  }
  if (!signedIn) {
    return <EditorSignInPrompt onSignIn={handleSignIn} />;
  }

  const runDisabled = parseResult.status !== 'ok' || previewMutation.isPending;
  const saveDisabled = !paid || parseResult.status !== 'ok';

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop="$6"
      testID="smart-editor-screen"
    >
      <YStack gap="$3" paddingHorizontal="$4" paddingBottom="$3">
        <Text variant="title" tone="default">
          Try a smart query
        </Text>
        <Text variant="caption" tone="muted">
          Type a JSON DSL expression. Free users can run it; saving requires Pro.
        </Text>
        <Input
          aria-label="Smart Collection DSL"
          accessibilityLabel="Smart Collection DSL"
          placeholder={PLACEHOLDER_DSL}
          value={text}
          onChangeText={setText}
          testID="smart-editor-input"
        />
        <DslStatusLine result={parseResult} />
        {runError !== null ? (
          <Text variant="caption" tone="error" testID="smart-editor-run-error">
            {runError}
          </Text>
        ) : null}
        <XStack gap="$2" flexWrap="wrap">
          <Button
            label={previewMutation.isPending ? 'Running…' : 'Run'}
            variant="primary"
            size="md"
            disabled={runDisabled}
            loading={previewMutation.isPending}
            onPress={handleRun}
            accessibilityLabel="Run query"
            testID="smart-editor-run"
          />
          <Button
            label={paid ? 'Save' : 'Save (Pro only)'}
            variant="secondary"
            size="md"
            disabled={saveDisabled}
            onPress={handleOpenSave}
            accessibilityLabel="Save smart collection"
            testID="smart-editor-save"
          />
          <Button
            label="Cancel"
            variant="ghost"
            size="md"
            onPress={handleCancel}
            accessibilityLabel="Cancel"
            testID="smart-editor-cancel"
          />
        </XStack>
        {!paid ? (
          <Text variant="caption" tone="muted" testID="smart-editor-save-hint">
            Saving smart collections is part of the Pro plan.
          </Text>
        ) : null}
      </YStack>
      {!paid && saveDisabled ? (
        <UpgradeBanner testID="smart-editor-upgrade-banner" />
      ) : null}
      {saveOpen ? (
        <SaveModal
          name={saveName}
          description={saveDescription}
          onChangeName={setSaveName}
          onChangeDescription={setSaveDescription}
          onSubmit={() => void handleSubmitSave()}
          onCancel={() => setSaveOpen(false)}
          pending={createMutation.isPending}
          error={saveError}
        />
      ) : null}
      {matches !== null ? (
        <YStack flex={1}>
          <YStack paddingHorizontal="$4" paddingBottom="$2">
            <Text variant="caption" tone="muted" testID="smart-editor-match-count">
              {formatMatchCount(matches, PREVIEW_LIMIT)}
            </Text>
          </YStack>
          <FlatList
            data={matches.items}
            keyExtractor={(item) => item.printingId}
            renderItem={renderItem}
            numColumns={2}
            contentContainerStyle={styles.gridContent}
            columnWrapperStyle={styles.gridColumn}
            ListEmptyComponent={<EmptyMatchesState />}
            testID="smart-editor-matches"
          />
        </YStack>
      ) : null}
    </YStack>
  );
}

// ============================================================
// Sub-components
// ============================================================

interface DslStatusLineProps {
  readonly result: ParseDslResult;
}

function DslStatusLine(props: DslStatusLineProps): ReactNode {
  const { result } = props;
  if (result.status === 'empty') {
    return (
      <Text variant="caption" tone="muted" testID="smart-editor-status-empty">
        Type a DSL expression to evaluate.
      </Text>
    );
  }
  if (result.status === 'json-error') {
    return (
      <Text variant="caption" tone="error" testID="smart-editor-status-json-error">
        JSON error: {result.message}
      </Text>
    );
  }
  if (result.status === 'dsl-error') {
    return (
      <Text variant="caption" tone="error" testID="smart-editor-status-dsl-error">
        DSL error: {result.message}
      </Text>
    );
  }
  return (
    <Text variant="caption" tone="default" testID="smart-editor-status-ok">
      Parsed: {result.explanation}
    </Text>
  );
}

interface SmartPreviewTileProps {
  readonly item: SmartPreviewItemDto;
}

function SmartPreviewTile(props: SmartPreviewTileProps): ReactNode {
  const { item } = props;
  return (
    <YStack
      flex={1}
      gap="$1"
      padding="$2"
      borderRadius={8}
      backgroundColor="$surfaceMuted"
      testID={`smart-editor-match-${item.printingId}`}
    >
      <Text variant="label" tone="default" numberOfLines={1}>
        {item.cardName}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {item.setName} #{item.cardNumber}
      </Text>
      {item.variantLabel.length > 0 ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {item.variantLabel}
        </Text>
      ) : null}
    </YStack>
  );
}

/**
 * Render the "N matches" caption for the preview header.
 *
 * - Single page (`nextOffset === null`) ⇒ exact match count.
 * - Server reports a higher `totalCount` than the page returned
 *   ⇒ surface "Showing M of N matches" so the user knows the
 *   preview is paginated.
 * - The server caps `totalCount` at 100k for the count query
 *   per the V2 handler docstring; if we're at the cap and there
 *   are still more rows, append a `+` suffix.
 */
function formatMatchCount(response: SmartPreviewResponseDto, pageLimit: number): string {
  const shown = response.items.length;
  const total = response.totalCount;
  const noun = total === 1 ? 'match' : 'matches';
  if (response.nextOffset === null && total === shown) {
    return `${shown} ${noun}`;
  }
  const totalLabel = total >= 100_000 ? '100,000+' : String(total);
  return `Showing ${shown} of ${totalLabel} ${noun} (page size ${pageLimit})`;
}

interface SaveModalProps {
  readonly name: string;
  readonly description: string;
  readonly onChangeName: (next: string) => void;
  readonly onChangeDescription: (next: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly pending: boolean;
  readonly error: string | null;
}

function SaveModal(props: SaveModalProps): ReactNode {
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$4"
      margin="$4"
      role="dialog"
      aria-label="Save smart collection"
      accessibilityLabel="Save smart collection"
      testID="smart-editor-save-modal"
    >
      <Text variant="subtitle" tone="default">
        Save smart collection
      </Text>
      <Input
        label="Name"
        placeholder="e.g. All Charizards"
        value={props.name}
        onChangeText={props.onChangeName}
        accessibilityLabel="Smart collection name"
        aria-label="Smart collection name"
        testID="smart-editor-save-name"
      />
      <Input
        label="Description (optional)"
        placeholder="Notes about this query"
        value={props.description}
        onChangeText={props.onChangeDescription}
        accessibilityLabel="Smart collection description"
        aria-label="Smart collection description"
        testID="smart-editor-save-description"
      />
      {props.error !== null ? (
        <Text variant="caption" tone="error" testID="smart-editor-save-error">
          {props.error}
        </Text>
      ) : null}
      <XStack gap="$2">
        <Button
          label={props.pending ? 'Saving…' : 'Save'}
          variant="primary"
          size="md"
          loading={props.pending}
          disabled={props.pending}
          onPress={props.onSubmit}
          accessibilityLabel="Save"
          testID="smart-editor-save-submit"
        />
        <Button
          label="Cancel"
          variant="ghost"
          size="md"
          disabled={props.pending}
          onPress={props.onCancel}
          accessibilityLabel="Cancel"
          testID="smart-editor-save-cancel"
        />
      </XStack>
    </Card>
  );
}

function EmptyMatchesState(): ReactNode {
  return (
    <YStack
      alignItems="center"
      justifyContent="center"
      padding="$6"
      gap="$2"
      testID="smart-editor-no-matches"
    >
      <Text variant="subtitle" tone="default">
        No matches
      </Text>
      <Text variant="body" tone="muted">
        No cards in your collection matched that query.
      </Text>
    </YStack>
  );
}

function EditorLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="smart-editor-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading…
      </Text>
    </YStack>
  );
}

interface EditorSignInPromptProps {
  readonly onSignIn: () => void;
}

function EditorSignInPrompt(props: EditorSignInPromptProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="smart-editor-sign-in-prompt"
    >
      <Text variant="title" tone="default">
        Sign in to try smart queries
      </Text>
      <Button
        label="Sign in"
        variant="primary"
        size="lg"
        onPress={props.onSignIn}
        accessibilityLabel="Sign in"
        testID="smart-editor-sign-in-button"
      />
    </YStack>
  );
}
