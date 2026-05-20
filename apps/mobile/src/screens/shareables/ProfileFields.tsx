// `<ProfileFields>` — mobile profile editor inside the
// shareables settings screen. Mirrors the web sibling's
// debounced handle availability check + optimistic save.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import type {
  HandleAvailabilityResponse,
  ProfileDto,
  UpdateProfileRequest,
} from '@binderly/api-contracts';
import { Button, Card, Input, Text, YStack } from '@binderly/ui';

import {
  MAX_BIO_LENGTH,
  validateBio,
  validateDisplayName,
  validateHandle,
} from './validation.js';

const HANDLE_DEBOUNCE_MS = 400;

// Stable style constants for the native `<label>` + `<textarea>`
// pair we use for the bio editor. The lint rule
// (`react-native/no-inline-styles`) flags freshly-allocated
// literals at the JSX site — extracting them here keeps the
// callsite stable while still rendering the HTML controls we need
// for the `htmlFor` accessibility wiring under jsdom.
const BIO_STYLES = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600' as const },
  textarea: {
    width: '100%',
    fontFamily: 'inherit',
    fontSize: 15,
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--border, #d0d5dd)',
  } as unknown as Record<string, never>,
});

export interface ProfileFieldsProps {
  profile: ProfileDto;
  onSave: (patch: UpdateProfileRequest) => Promise<void>;
  onCheckHandle: (handle: string) => Promise<HandleAvailabilityResponse>;
  debounceMs?: number;
}

type AvailabilityStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: 'taken' | 'invalid' | 'rate_limited' | 'reserved' }
  | { kind: 'unknown' };

export function ProfileFields({
  profile,
  onSave,
  onCheckHandle,
  debounceMs = HANDLE_DEBOUNCE_MS,
}: ProfileFieldsProps): ReactNode {
  const [handle, setHandle] = useState<string>(profile.handle);
  const [displayName, setDisplayName] = useState<string>(profile.displayName ?? '');
  const [bio, setBio] = useState<string>(profile.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityStatus>({ kind: 'idle' });

  const handleValidation = useMemo(() => validateHandle(handle), [handle]);
  const displayNameValidation = useMemo(() => validateDisplayName(displayName), [displayName]);
  const bioValidation = useMemo(() => validateBio(bio), [bio]);

  const trimmedHandle = handle.trim();
  const handleChangedFromCurrent = trimmedHandle.toLowerCase() !== profile.handle.toLowerCase();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    if (!handleChangedFromCurrent) {
      setAvailability({ kind: 'idle' });
      return;
    }
    if (handleValidation.kind !== 'ok') {
      setAvailability({ kind: 'unavailable', reason: 'invalid' });
      return;
    }
    setAvailability({ kind: 'checking' });
    const ctrl = new AbortController();
    debounceRef.current = setTimeout(() => {
      onCheckHandle(trimmedHandle)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          if (res.available) {
            setAvailability({ kind: 'available' });
          } else if (res.reason !== undefined) {
            setAvailability({ kind: 'unavailable', reason: res.reason });
          } else {
            setAvailability({ kind: 'unknown' });
          }
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setAvailability({ kind: 'unknown' });
        });
    }, debounceMs);
    return (): void => {
      ctrl.abort();
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [trimmedHandle, handleChangedFromCurrent, handleValidation.kind, onCheckHandle, debounceMs]);

  const canSave = useMemo(() => {
    if (saving) return false;
    if (handleValidation.kind !== 'ok') return false;
    if (displayNameValidation.kind !== 'ok') return false;
    if (bioValidation.kind !== 'ok') return false;
    if (handleChangedFromCurrent && availability.kind === 'unavailable') return false;
    if (handleChangedFromCurrent && availability.kind === 'checking') return false;
    return true;
  }, [
    saving,
    handleValidation.kind,
    displayNameValidation.kind,
    bioValidation.kind,
    handleChangedFromCurrent,
    availability.kind,
  ]);

  const hasChanges =
    handleChangedFromCurrent ||
    displayName !== (profile.displayName ?? '') ||
    bio !== (profile.bio ?? '');

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    const patch: UpdateProfileRequest = {};
    if (handleChangedFromCurrent) {
      patch.handle = trimmedHandle;
    }
    if (displayName !== (profile.displayName ?? '')) {
      patch.displayName = displayName.trim().length === 0 ? null : displayName.trim();
    }
    if (bio !== (profile.bio ?? '')) {
      patch.bio = bio.trim().length === 0 ? null : bio.trim();
    }
    try {
      await onSave(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
      setHandle(profile.handle);
      setDisplayName(profile.displayName ?? '');
      setBio(profile.bio ?? '');
    } finally {
      setSaving(false);
    }
  }

  const availabilityCopy = useMemo(() => {
    if (!handleChangedFromCurrent) return null;
    switch (availability.kind) {
      case 'idle':
        return null;
      case 'checking':
        return 'Checking availability\u2026';
      case 'available':
        return `\u2713 @${trimmedHandle} is available.`;
      case 'unknown':
        return 'We\u2019ll verify this handle when you save.';
      case 'unavailable':
        if (availability.reason === 'taken') return 'That handle is already taken.';
        if (availability.reason === 'reserved') return 'That handle is reserved.';
        if (availability.reason === 'rate_limited')
          return 'Too many checks \u2014 try again in a moment.';
        return 'That handle isn\u2019t allowed.';
    }
  }, [availability, handleChangedFromCurrent, trimmedHandle]);

  return (
    <Card variant="outlined" padding="$5" gap="$4" testID="m-profile-fields-card">
      <YStack gap="$1">
        <Text variant="subtitle">Profile</Text>
        <Text variant="bodySmall" tone="muted">
          Shown at the top of every public shareable you publish.
        </Text>
      </YStack>

      <Input
        label="Public handle"
        value={handle}
        onChangeText={(next: string) => setHandle(next.toLowerCase())}
        size="md"
        error={handleValidation.kind !== 'ok' && handle.length > 0}
        helperText="3\u201330 lowercase letters, numbers, or hyphens."
        {...(handleValidation.message !== null ? { errorText: handleValidation.message } : {})}
        testID="m-profile-handle-input"
      />
      {availabilityCopy !== null ? (
        <Text
          variant="bodySmall"
          tone={availability.kind === 'available' ? undefined : 'muted'}
          testID="m-profile-handle-availability"
        >
          {availabilityCopy}
        </Text>
      ) : null}

      <Input
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        size="md"
        error={displayNameValidation.kind !== 'ok'}
        helperText="Optional. Defaults to your handle on public pages."
        {...(displayNameValidation.message !== null
          ? { errorText: displayNameValidation.message }
          : {})}
        testID="m-profile-display-name-input"
      />

      <YStack gap="$1" testID="m-profile-bio-block">
        <label
          htmlFor="m-profile-bio-input"
          style={BIO_STYLES.label as unknown as React.CSSProperties}
          data-testid="m-profile-bio-label"
        >
          Bio
        </label>
        <textarea
          id="m-profile-bio-input"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={MAX_BIO_LENGTH + 200}
          rows={3}
          data-testid="m-profile-bio-input"
          aria-label="Bio"
          style={BIO_STYLES.textarea as unknown as React.CSSProperties}
        />
        <Text
          variant="caption"
          tone={bioValidation.kind === 'too-long' ? undefined : 'muted'}
          testID="m-profile-bio-counter"
        >
          {bioValidation.message ?? `${bio.length}/${MAX_BIO_LENGTH} characters.`}
        </Text>
      </YStack>

      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          testID="m-profile-fields-error"
        >
          <Text variant="bodySmall" tone="muted">
            {error}
          </Text>
        </YStack>
      ) : null}

      <Button
        label={saving ? 'Saving\u2026' : 'Save profile'}
        variant="primary"
        size="md"
        disabled={!canSave || !hasChanges}
        loading={saving}
        onPress={handleSave}
        aria-label="Save profile"
        accessibilityLabel="Save profile"
        testID="m-profile-fields-save"
      />
    </Card>
  );
}
