// `<ShareableRowEditor>` — mobile per-shareable card. Mirrors the
// web component in shape and behaviour but renders via Tamagui
// primitives + a `Switch`-style toggle the @binderly/ui design
// system doesn't ship a primitive for (yet) so we use the
// HTML-equivalent under jsdom; production uses the same primitive
// via Tamagui's web fork. The non-default theme entries appear
// as disabled options with "(Pro)" tags — same upsell surface as
// the web sibling.

import { useMemo, useState, type ReactNode } from 'react';

import {
  SHAREABLE_THEMES,
  type ShareableDto,
  type ShareableTheme,
  type UpdateShareableRequest,
} from '@binderly/api-contracts';
import { Button, Card, Input, Text, XStack, YStack } from '@binderly/ui';

import { validateSlug } from './validation.js';

export interface ShareableRowEditorProps {
  shareable: ShareableDto;
  handle: string;
  onSave: (id: string, patch: UpdateShareableRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isPro?: boolean;
  defaultConfirmingDelete?: boolean;
}

interface RowState {
  slug: string;
  theme: ShareableTheme;
  isActive: boolean;
  showValues: boolean;
  showMissing: boolean;
  showPhotos: boolean;
}

function readInitial(s: ShareableDto): RowState {
  return {
    slug: s.slug,
    theme: s.theme,
    isActive: s.isActive,
    showValues: s.showValues,
    showMissing: s.showMissing,
    showPhotos: s.showPhotos,
  };
}

function diffPatch(initial: ShareableDto, current: RowState): UpdateShareableRequest | null {
  const patch: UpdateShareableRequest = {};
  if (current.slug !== initial.slug) patch.slug = current.slug;
  if (current.theme !== initial.theme) patch.theme = current.theme;
  if (current.isActive !== initial.isActive) patch.isActive = current.isActive;
  if (current.showValues !== initial.showValues) patch.showValues = current.showValues;
  if (current.showMissing !== initial.showMissing) patch.showMissing = current.showMissing;
  if (current.showPhotos !== initial.showPhotos) patch.showPhotos = current.showPhotos;
  return Object.keys(patch).length === 0 ? null : patch;
}

export function ShareableRowEditor({
  shareable,
  handle,
  onSave,
  onDelete,
  isPro = false,
  defaultConfirmingDelete = false,
}: ShareableRowEditorProps): ReactNode {
  const [draft, setDraft] = useState<RowState>(() => readInitial(shareable));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(defaultConfirmingDelete);
  const [error, setError] = useState<string | null>(null);

  const slugValidation = useMemo(() => validateSlug(draft.slug), [draft.slug]);
  const patch = useMemo(() => diffPatch(shareable, draft), [shareable, draft]);
  const canSave = patch !== null && slugValidation.kind === 'ok' && !saving;
  const publicUrl = `binderly.app/c/${handle}/${draft.slug}`;

  async function handleSave(): Promise<void> {
    if (patch === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(shareable.id, patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
      setDraft(readInitial(shareable));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await onDelete(shareable.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the shareable.');
      setDeleting(false);
    }
  }

  return (
    <Card
      variant="outlined"
      padding="$4"
      gap="$3"
      testID={`m-shareable-row-${shareable.id}`}
    >
      <Text variant="caption" tone="muted" testID="m-shareable-row-url">
        {publicUrl}
      </Text>

      <Input
        label="Slug"
        value={draft.slug}
        onChangeText={(next: string) => setDraft((cur) => ({ ...cur, slug: next.trim() }))}
        size="md"
        error={slugValidation.kind !== 'ok' && draft.slug.length > 0}
        helperText="3\u201350 lowercase letters, numbers, or hyphens."
        {...(slugValidation.message !== null ? { errorText: slugValidation.message } : {})}
        testID="m-shareable-row-slug-input"
      />

      <YStack gap="$2" testID="m-shareable-row-theme-block">
        <Text variant="caption">Theme</Text>
        <select
          value={draft.theme}
          onChange={(e) =>
            setDraft((cur) => ({ ...cur, theme: e.target.value as ShareableTheme }))
          }
          data-testid="m-shareable-row-theme-select"
          aria-label="Theme"
        >
          {SHAREABLE_THEMES.map((theme) => {
            const isLocked = theme !== 'default' && !isPro;
            return (
              <option
                key={theme}
                value={theme}
                disabled={isLocked}
                data-testid={`m-shareable-row-theme-option-${theme}`}
              >
                {theme}
                {isLocked ? ' (Pro)' : ''}
              </option>
            );
          })}
        </select>
      </YStack>

      <YStack gap="$2" testID="m-shareable-row-toggles">
        <MobileToggleRow
          label="Published (visible to the public)"
          locked={false}
          value={draft.isActive}
          onChange={(next: boolean) => setDraft((cur) => ({ ...cur, isActive: next }))}
          testId="m-shareable-row-is-active"
        />
        {!draft.isActive ? (
          <Text variant="bodySmall" tone="muted" testID="m-shareable-row-unpublished-hint">
            Unpublished links return a 404 to anyone who opens them.
          </Text>
        ) : null}
        <MobileToggleRow
          label="Show collection value"
          locked={!isPro}
          value={draft.showValues}
          onChange={(next: boolean) => setDraft((cur) => ({ ...cur, showValues: next }))}
          testId="m-shareable-row-show-values"
        />
        <MobileToggleRow
          label="Show set completion"
          locked={false}
          value={draft.showMissing}
          onChange={(next: boolean) => setDraft((cur) => ({ ...cur, showMissing: next }))}
          testId="m-shareable-row-show-missing"
        />
        <MobileToggleRow
          label="Show your photos"
          locked={false}
          value={draft.showPhotos}
          onChange={(next: boolean) => setDraft((cur) => ({ ...cur, showPhotos: next }))}
          testId="m-shareable-row-show-photos"
        />
      </YStack>

      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          testID="m-shareable-row-error"
        >
          <Text variant="bodySmall" tone="muted">
            {error}
          </Text>
        </YStack>
      ) : null}

      <XStack gap="$3" alignItems="center" flexWrap="wrap">
        <Button
          label={saving ? 'Saving\u2026' : 'Save changes'}
          variant="primary"
          size="md"
          disabled={!canSave}
          loading={saving}
          onPress={handleSave}
          aria-label="Save shareable changes"
          accessibilityLabel="Save shareable changes"
          testID="m-shareable-row-save"
        />
        <Button
          label={
            deleting
              ? 'Deleting\u2026'
              : confirmingDelete
                ? 'Confirm delete'
                : 'Delete'
          }
          variant="destructive"
          size="md"
          disabled={deleting}
          loading={deleting}
          onPress={handleDelete}
          aria-label={
            confirmingDelete
              ? 'Confirm permanent delete'
              : 'Delete this shareable'
          }
          accessibilityLabel={
            confirmingDelete
              ? 'Confirm permanent delete'
              : 'Delete this shareable'
          }
          testID="m-shareable-row-delete"
        />
        {confirmingDelete && !deleting ? (
          <Text variant="bodySmall" tone="muted" testID="m-shareable-row-delete-confirm-copy">
            This frees the slug for re-use. Tap again to confirm.
          </Text>
        ) : null}
      </XStack>
    </Card>
  );
}

interface MobileToggleRowProps {
  label: string;
  locked: boolean;
  value: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}

function MobileToggleRow({
  label,
  locked,
  value,
  onChange,
  testId,
}: MobileToggleRowProps): ReactNode {
  return (
    <XStack
      gap="$3"
      alignItems="center"
      justifyContent="space-between"
      testID={`${testId}-row`}
    >
      <Text variant="body" tone={locked ? 'muted' : undefined}>
        {label}
        {locked ? ' (Pro)' : ''}
      </Text>
      <input
        type="checkbox"
        checked={value}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        aria-label={label}
      />
    </XStack>
  );
}
