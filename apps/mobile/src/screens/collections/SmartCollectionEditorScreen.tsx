// `<SmartCollectionEditorScreen>` — Smart Collection DSL editor.
//
// v1 preview design choice (documented in the PR + open-questions):
// the Run preview evaluates the rule against the user's OWNED
// printings — `useCollectionItemsQuery` + `useOwnedPrintingsContextQuery`
// from `lib/collection`. This avoids fanning out hundreds of catalog
// fetches just to populate a preview, and it answers the question
// users actually ask first ("which of my cards match this rule?").
// The catalog-wide preview is a follow-up tracked in the PR body.
//
// Surface:
//
//   - Auth-gated.
//   - DSL text input (multiline-ish; TamaguiInput is single-line on
//     web but mobile native renders multiline; v1 keeps the input
//     compact and points at JSON examples).
//   - Live parse status: error message, or human explanation, below
//     the input as the user types.
//   - "Run" button: parses + evaluates + shows the matching grid +
//     match count.
//   - "Save" button: paid-only. Free users see the button disabled
//     with the upsell banner above it. Paid users tap → submit a
//     create-smart request → navigate to /collections/smart/{id}.
//   - "Cancel" pops back.

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { UpgradeBanner } from '../../components/collections/index.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import {
  useCollectionItemsQuery,
  useOwnedPrintingsContextQuery,
} from '../../lib/collection/index.js';
import {
  evaluateAgainstCatalog,
  isPaidTier,
  parseDslText,
  slugify,
  useCreateCustomCollectionMutation,
  useSubscriptionQuery,
  type CatalogPrintingRow,
  type EvaluateMatch,
  type ParseDslResult,
} from '../../lib/collections/index.js';

const PREVIEW_CAP = 200;

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
  const itemsQuery = useCollectionItemsQuery({ enabled: signedIn });
  const printingIds = useMemo(
    () => (itemsQuery.data ?? []).map((item) => item.printingId).slice(0, PREVIEW_CAP),
    [itemsQuery.data],
  );
  const contextQuery = useOwnedPrintingsContextQuery(printingIds);
  const createMutation = useCreateCustomCollectionMutation();

  const [text, setText] = useState('');
  const [matches, setMatches] = useState<EvaluateMatch[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const parseResult = useMemo<ParseDslResult>(() => parseDslText(text), [text]);
  const paid = isPaidTier(subscriptionQuery);

  const catalog = useMemo<CatalogPrintingRow[]>(() => {
    // `PrintingWithContextDto` extends `PrintingDto` with `card` and
    // `set`, so the printing portion is just the same row minus the
    // two embedded join fields. Spread + delete keeps the projection
    // honest without enumerating every printing field.
    return contextQuery.data.map((ctx) => {
      const { card, set, ...printing } = ctx;
      return { card, set, printing };
    });
  }, [contextQuery.data]);

  const ownedSet = useMemo(
    () => new Set(printingIds),
    [printingIds],
  );

  const handleSignIn = useCallback(() => router.push('/auth/sign-in'), [router]);
  const handleCancel = useCallback(() => router.back(), [router]);

  const handleRun = useCallback(() => {
    if (parseResult.status !== 'ok') {
      setRunError('Fix the parse error before running.');
      setMatches(null);
      return;
    }
    setRunError(null);
    try {
      const result = evaluateAgainstCatalog(parseResult.expression, catalog, ownedSet);
      setMatches(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to evaluate rule.';
      setRunError(message);
      setMatches(null);
    }
  }, [parseResult, catalog, ownedSet]);

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
    ({ item }: { item: EvaluateMatch }) => (
      <SmartPreviewTile match={item} />
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

  const runDisabled = parseResult.status !== 'ok';
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
            label="Run"
            variant="primary"
            size="md"
            disabled={runDisabled}
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
              {matches.length} {matches.length === 1 ? 'match' : 'matches'} (preview cap: {PREVIEW_CAP})
            </Text>
          </YStack>
          <FlatList
            data={matches}
            keyExtractor={(item) => item.printing.id}
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
  readonly match: EvaluateMatch;
}

function SmartPreviewTile(props: SmartPreviewTileProps): ReactNode {
  const { match } = props;
  return (
    <YStack
      flex={1}
      gap="$1"
      padding="$2"
      borderRadius={8}
      backgroundColor="$surfaceMuted"
      testID={`smart-editor-match-${match.printing.id}`}
    >
      <Text variant="label" tone="default" numberOfLines={1}>
        {match.card.name}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {match.set.name} #{match.card.number}
      </Text>
      <Text variant="caption" tone={match.owned ? 'default' : 'muted'}>
        {match.owned ? 'Owned' : 'Not owned'}
      </Text>
    </YStack>
  );
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
