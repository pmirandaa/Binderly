'use client';

// Per-shareable row editor. Owns the local "draft" state for one
// shareable: slug, theme, show toggles. Save dispatches the
// optimistic update via the parent-supplied `onSave` callback;
// delete dispatches through `onDelete`. The theme selector is the
// pro-gated `<ThemePicker>` (T-SH-THEMES): free users can preview the
// full gallery, but only Pro can apply a non-default theme.

import { useMemo, useState } from 'react';

import { type ShareableDto, type ShareableTheme, type UpdateShareableRequest } from '@binderly/api-contracts';
import { Button, Card, Input, Text, XStack, YStack } from '@binderly/ui';

import { validateSlug } from './validation';
import { ThemePicker } from '../../c/themes/ThemePicker';

export interface ShareableRowEditorProps {
  shareable: ShareableDto;
  handle: string;
  /** Persist a patch. Returns the updated row from the server. */
  onSave: (id: string, patch: UpdateShareableRequest) => Promise<void>;
  /** Delete the shareable. Resolves after the row is removed. */
  onDelete: (id: string) => Promise<void>;
  /** Initial "pro tier" gate for the per-shareable "show value" toggle. */
  isPro?: boolean;
  /** Test seam — pre-set the confirmation state to skip the first click. */
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
}: ShareableRowEditorProps): React.ReactNode {
  const [draft, setDraft] = useState<RowState>(() => readInitial(shareable));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(defaultConfirmingDelete);
  const [deleting, setDeleting] = useState(false);

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
      data-testid={`shareable-row-${shareable.id}`}
    >
      <YStack gap="$1">
        <Text variant="caption" tone="muted" data-testid="shareable-row-url">
          {publicUrl}
        </Text>
      </YStack>

      <YStack gap="$2" data-testid="shareable-row-publish-block">
        <ToggleRow
          label="Published (visible to the public)"
          locked={false}
          value={draft.isActive}
          onChange={(next) => setDraft((cur) => ({ ...cur, isActive: next }))}
          testId="shareable-row-is-active"
        />
        {!draft.isActive ? (
          <Text variant="bodySmall" tone="muted" data-testid="shareable-row-unpublished-hint">
            Hidden — visitors get a 404 until you republish. Your collection data is untouched.
          </Text>
        ) : null}
      </YStack>

      <Input
        label="Slug"
        value={draft.slug}
        onChangeText={(next) => setDraft((cur) => ({ ...cur, slug: next.trim() }))}
        size="md"
        error={slugValidation.kind !== 'ok' && draft.slug.length > 0}
        helperText="Lowercase letters, numbers, and hyphens; 3\u201350 characters."
        {...(slugValidation.message !== null ? { errorText: slugValidation.message } : {})}
        testID="shareable-row-slug-input"
      />

      <YStack gap="$2" data-testid="shareable-row-theme-block">
        <ThemePicker
          value={draft.theme}
          onSelect={(next) => setDraft((cur) => ({ ...cur, theme: next }))}
          testId="shareable-row-theme-picker"
        />
      </YStack>

      <YStack gap="$2" data-testid="shareable-row-toggles">
        <ToggleRow
          label="Show collection value"
          locked={!isPro}
          value={draft.showValues}
          onChange={(next) => setDraft((cur) => ({ ...cur, showValues: next }))}
          testId="shareable-row-show-values"
        />
        <ToggleRow
          label="Show set completion"
          locked={false}
          value={draft.showMissing}
          onChange={(next) => setDraft((cur) => ({ ...cur, showMissing: next }))}
          testId="shareable-row-show-missing"
        />
        <ToggleRow
          label="Show your photos"
          locked={false}
          value={draft.showPhotos}
          onChange={(next) => setDraft((cur) => ({ ...cur, showPhotos: next }))}
          testId="shareable-row-show-photos"
        />
      </YStack>

      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          data-testid="shareable-row-error"
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
          data-testid="shareable-row-save"
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
          data-testid="shareable-row-delete"
        />
        {confirmingDelete && !deleting ? (
          <Text variant="bodySmall" tone="muted" data-testid="shareable-row-delete-confirm-copy">
            This frees the slug for re-use. Click again to confirm.
          </Text>
        ) : null}
      </XStack>
    </Card>
  );
}

interface ToggleRowProps {
  label: string;
  locked: boolean;
  value: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}

function ToggleRow({ label, locked, value, onChange, testId }: ToggleRowProps): React.ReactNode {
  return (
    <XStack
      gap="$3"
      alignItems="center"
      justifyContent="space-between"
      data-testid={`${testId}-row`}
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
